import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { cheapestTier } from '../hooks/models'

const SESSION_MODEL = 'claude-opus-5-5'
const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const HARD = 'Design a sharded job queue with exactly-once delivery and a migration plan'
const EASY = 'Rename the variable foo to bar in utils.ts please'

// Stands in for the engine: the classifier answers `answer`, and each
// `turn.step` records which model it was sent with and reports `context`
// tokens of usage, all read from that model's cache.
function engine(on: On, answer: string, context = 20_000) {
  mock.store(on)
  mock.clock(on)
  const sent: string[] = []
  let classified = 0

  on('model.complete', () => {
    classified += 1
    return { value: { isAnswered: true, text: answer, usage: usage(0) } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    sent.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage(context), model: e.model } }
  })
  on('turn.complete', () => ({ text: '' }))

  return { sent, classified: () => classified, setAnswer: (text: string) => (answer = text) }
}

const usage = (cached: number) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 })

async function turn($: Engine, turnId: string, text: string, agentId?: string) {
  await $.turn.start({ turnId, text })
  const stream = $.turn.step({ turnId, index: 0, model: SESSION_MODEL, messageCount: 1, agentId })
  for await (const _ of stream) void _
  await stream.result
}

test('a trivial prompt runs on haiku', async ($, on) => {
  const e = engine(on, 'haiku')
  await turn($, 't1', EASY)
  expect(e.sent).toEqual(['claude-haiku-5-5'])
})

test('a hard prompt keeps the session model', async ($, on) => {
  const e = engine(on, 'opus')
  await turn($, 't1', HARD)
  expect(e.sent).toEqual([SESSION_MODEL])
})

test('a short follow-up keeps the last pick without classifying', async ($, on) => {
  const e = engine(on, 'haiku')
  await turn($, 't1', EASY)
  await turn($, 't2', 'yes')
  expect(e.sent).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
  expect(e.classified()).toBe(1)
})

test('subagent steps are left alone and never classified', async ($, on) => {
  const e = engine(on, 'haiku')
  await turn($, 't1', EASY, 'agent-1')
  expect(e.sent).toEqual([SESSION_MODEL])
  expect(e.classified()).toBe(0)
})

test('an unparseable classifier answer leaves the session model', async ($, on) => {
  const e = engine(on, 'no idea')
  await turn($, 't1', EASY)
  expect(e.sent).toEqual([SESSION_MODEL])
})

test('with a warm Opus cache, a sonnet-level prompt stays on Opus', async ($, on) => {
  const e = engine(on, 'opus', 150_000)
  await turn($, 't1', HARD)
  e.setAnswer('sonnet')
  await turn($, 't2', 'Write unit tests for the parser module in src/parse.ts')
  expect(e.sent).toEqual([SESSION_MODEL, SESSION_MODEL])
})

test('/auto-model pins and turns off', async ($, on) => {
  const e = engine(on, 'opus')
  on('command.run', () => ({ text: 'unhandled' }))
  const pinned = await $.command.run({ ...COMMAND, command: 'auto-model', args: 'sonnet' })
  expect(pinned.text).toContain('pinned to sonnet')
  await turn($, 't1', HARD)
  await $.command.run({ ...COMMAND, command: 'auto-model', args: 'off' })
  await turn($, 't2', HARD)
  expect(e.sent).toEqual(['claude-sonnet-5-5', SESSION_MODEL])
  expect(e.classified()).toBe(0)
})

test('cost model: cold haiku beats warm opus; cold sonnet does not', () => {
  const warmOpus = (tier: string) => (tier === 'opus' ? 80_000 : 0)
  expect(cheapestTier('haiku', 80_000, warmOpus)).toBe('haiku')
  expect(cheapestTier('sonnet', 80_000, warmOpus)).toBe('opus')
  expect(cheapestTier('sonnet', 20_000, () => 0)).toBe('sonnet')
})
