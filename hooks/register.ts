import type { EngineInterface, Register } from 'claude-code'

import { CLASSIFIER, MODEL_IDS, parseTier, TIERS, type Tier } from './classify'

// `auto` lets the classifier pick per prompt; a tier name pins that model.
type Mode = 'auto' | 'off' | Tier

const MODE_KEY = 'mode'
const MAX_PROMPT_CHARS = 6000
// Prompts this short ("yes", "go on", "fix it") follow up on the last turn:
// they keep the model that turn ran on rather than being judged alone.
const FOLLOW_UP_CHARS = 25

const isMode = (value: unknown): value is Mode =>
  value === 'auto' || value === 'off' || TIERS.includes(value as Tier)

function statusText(mode: Mode, last: Tier | undefined): string | undefined {
  if (mode === 'off') return undefined
  if (mode !== 'auto') return `model: ${mode} (pinned)`

  return last ? `auto-model: ${last}` : 'auto-model'
}

async function classify($: EngineInterface, text: string): Promise<Tier | undefined> {
  const r = await $.model.complete({
    model: MODEL_IDS.haiku,
    system: CLASSIFIER,
    prompt: `<prompt>\n${text.slice(0, MAX_PROMPT_CHARS)}\n</prompt>`,
    maxTokens: 8,
    effort: 'low',
  })

  return r.isAnswered ? parseTier(r.text) : undefined
}

export const register: Register = on => {
  let mode: Mode = 'auto'
  let last: Tier | undefined
  const picks = new Map<string, Promise<Tier | undefined>>()

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(MODE_KEY)
    mode = isMode(stored) ? stored : 'auto'
    await $.command.register({
      name: 'auto-model',
      description: 'Pick the model per prompt: on | off | haiku | sonnet | opus | status',
    })
    $.ui.status(statusText(mode, last))

    return next(e)
  })

  on('command.run', { command: 'auto-model' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wanted = arg === 'on' ? 'auto' : arg

    if (arg !== '' && arg !== 'status') {
      if (!isMode(wanted)) {
        return { text: `Unknown option "${arg}". Use on, off, haiku, sonnet, opus or status.` }
      }
      mode = wanted
      await $.store.set(MODE_KEY, mode)
      $.ui.status(statusText(mode, last))
    }

    const state =
      mode === 'auto'
        ? `on, choosing per prompt${last ? ` (last pick: ${last})` : ''}`
        : mode === 'off'
          ? 'off, the session model is used'
          : `pinned to ${mode}`

    return { text: `auto-model is ${state}.` }
  })

  on('turn.start', async ($, e, next) => {
    if (mode === 'auto') {
      const text = e.text.trim()
      const prev = last
      const tier =
        text.length < FOLLOW_UP_CHARS
          ? Promise.resolve(prev)
          : classify($, text).then(t => t ?? prev, () => prev)
      picks.set(e.turnId, tier)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // Subagents keep the model their own definition or the Agent call chose.
    if (e.agentId !== undefined || mode === 'off') return yield* next(e)

    const tier = mode === 'auto' ? await (picks.get(e.turnId) ?? last) : mode
    if (tier === undefined) return yield* next(e)

    if (e.index === 0 && tier !== last) {
      last = tier
      $.ui.status(statusText(mode, last))
    }

    return yield* next({ ...e, model: MODEL_IDS[tier] })
  })

  on('turn.complete', ($, e, next) => {
    picks.delete(e.turnId)

    return next(e)
  })
}
