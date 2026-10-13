import type { EngineInterface, Register } from 'claude-code'

import { CLASSIFIER, excerpt, parseTier } from './classify'
import { cheapestTier, MODEL_IDS, tierOf, TIERS, type Tier } from './models'

// `auto` lets the classifier pick per prompt; a tier name pins that model.
type Mode = 'auto' | 'off' | Tier

const MODE_KEY = 'mode'
const SAVINGS_KEY = 'savings'
// Prompts this short ("yes", "go on", "fix it") follow up on the last turn:
// they keep the last pick rather than being judged alone.
const FOLLOW_UP_CHARS = 25
// How long a model's prompt cache stays warm after its last use (Claude Code
// writes the 1-hour cache).
const CACHE_TTL_MS = 60 * 60 * 1000
// The context of a first turn before any usage is known: Claude Code's
// system prompt and tool definitions, measured at about 40K tokens.
const BASE_CONTEXT_TOKENS = 40_000

const isMode = (value: unknown): value is Mode =>
  value === 'auto' || value === 'off' || TIERS.includes(value as Tier)

function statusText(mode: Mode, sent: Tier | undefined, wanted: Tier | undefined): string | undefined {
  if (mode === 'off') return undefined
  if (mode !== 'auto') return `model: ${mode} (pinned)`
  if (!sent) return 'auto-model'

  return wanted && wanted !== sent ? `auto-model: ${sent} (asked ${wanted}, cheaper to stay)` : `auto-model: ${sent}`
}

async function classify($: EngineInterface, text: string): Promise<Tier | undefined> {
  const r = await $.model.complete({
    model: MODEL_IDS.haiku,
    system: CLASSIFIER,
    prompt: `<prompt>\n${excerpt(text)}\n</prompt>`,
    // Room for a short adaptive think before the one-word answer.
    maxTokens: 256,
    effort: 'low',
  })

  return r.isAnswered ? parseTier(r.text) : undefined
}

type State = {
  mode: Mode
  // Off by default: a prompt runs on the model its difficulty calls for. On, a
  // stronger model that is already cached may serve it when that is cheaper.
  savings: boolean
  lastWanted?: Tier
  contextTokens: number
  // Per model id: when it last ran on the main loop and how much context it cached.
  caches: Map<string, { at: number; tokens: number }>
  prompts: Map<string, string>
  decisions: Map<string, Promise<string | undefined>>
}

// Picks the model for a turn's steps, or undefined to keep the session's.
async function decide($: EngineInterface, s: State, turnId: string, sessionModel: string) {
  if (s.mode !== 'auto') return s.mode === 'off' ? undefined : MODEL_IDS[s.mode]

  const text = (s.prompts.get(turnId) ?? '').trim()
  s.prompts.delete(turnId)
  const wanted =
    text.length < FOLLOW_UP_CHARS
      ? s.lastWanted
      : ((await classify($, text).catch(() => undefined)) ?? s.lastWanted)
  if (!wanted) return undefined
  s.lastWanted = wanted

  const now = await $.clock.now()
  const idOf = (tier: Tier) => (tierOf(sessionModel) === tier ? sessionModel : MODEL_IDS[tier])
  const warm = (tier: Tier) => {
    const cache = s.caches.get(idOf(tier))
    return cache && now - cache.at < CACHE_TTL_MS ? cache.tokens : 0
  }
  const tier = s.savings ? cheapestTier(wanted, s.contextTokens || BASE_CONTEXT_TOKENS, warm) : wanted
  $.ui.status(statusText(s.mode, tier, wanted))

  return idOf(tier)
}

export const register: Register = on => {
  const s: State = { mode: 'auto', savings: false, contextTokens: 0, caches: new Map(), prompts: new Map(), decisions: new Map() }

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(MODE_KEY)
    s.mode = isMode(stored) ? stored : 'auto'
    s.savings = (await $.store.get(SAVINGS_KEY)) === true
    await $.command.register({
      name: 'auto-model',
      description: 'Pick the model per prompt: on | off | haiku | sonnet | opus | savings on|off | status',
    })
    $.ui.status(statusText(s.mode, undefined, undefined))

    return next(e)
  })

  on('command.run', { command: 'auto-model' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    if (arg === 'savings on' || arg === 'savings off') {
      s.savings = arg === 'savings on'
      await $.store.set(SAVINGS_KEY, s.savings)

      return { text: `auto-model savings mode is ${s.savings ? 'on' : 'off'}.` }
    }
    const wanted = arg === 'on' ? 'auto' : arg

    if (arg !== '' && arg !== 'status') {
      if (!isMode(wanted)) {
        return { text: `Unknown option "${arg}". Use on, off, haiku, sonnet, opus, savings on, savings off or status.` }
      }
      s.mode = wanted
      await $.store.set(MODE_KEY, s.mode)
      $.ui.status(statusText(s.mode, undefined, undefined))
    }

    const state =
      s.mode === 'auto'
        ? `on, choosing per prompt${s.lastWanted ? ` (last ask: ${s.lastWanted})` : ''}`
        : s.mode === 'off'
          ? 'off, the session model is used'
          : `pinned to ${s.mode}`

    return { text: `auto-model is ${state}; savings mode is ${s.savings ? 'on' : 'off'}.` }
  })

  // Only keeps the text: classifying waits for the turn's first main-loop
  // step, so turns that never reach the main loop cost nothing.
  on('turn.start', ($, e, next) => {
    if (s.mode === 'auto') s.prompts.set(e.turnId, e.text)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // Subagents keep the model their own definition or the Agent call chose.
    if (e.agentId !== undefined || s.mode === 'off') return yield* next(e)

    let decision = s.decisions.get(e.turnId)
    if (!decision) {
      decision = decide($, s, e.turnId, e.model).catch(() => undefined)
      s.decisions.set(e.turnId, decision)
    }
    const model = (await decision) ?? e.model

    const r = yield* next(model === e.model ? e : { ...e, model })
    if (r.usage) {
      const u = r.usage
      s.contextTokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      s.caches.set(u.model, { at: await $.clock.now(), tokens: s.contextTokens })
    }

    return r
  })

  on('turn.complete', ($, e, next) => {
    s.decisions.delete(e.turnId)
    s.prompts.delete(e.turnId)

    return next(e)
  })
}
