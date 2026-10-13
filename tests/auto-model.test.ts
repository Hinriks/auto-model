import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Stands in for the engine: the classifier answers `answer`, and each
// `turn.step` records which model it was sent with.
function engine(on: On, answer: string) {
  mock.store(on)
  const sent: string[] = []
  let classified = 0

  on('model.complete', () => {
    classified += 1
    return { value: { isAnswered: true, text: answer, usage: USAGE } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    sent.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))

  return { sent, classified: () => classified }
}

async function turn($: Engine, turnId: string, text: string, agentId?: string) {
  await $.turn.start({ turnId, text })
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId })
  for await (const _ of stream) void _
  await stream.result
}

test('routes a hard prompt to opus', async ($, on) => {
  const e = engine(on, 'opus')
  await turn($, 't1', 'Design a sharded job queue with exactly-once delivery and a migration plan')
  expect(e.sent).toEqual(['claude-opus-5-5'])
})

test('a short follow-up keeps the last pick without classifying', async ($, on) => {
  const e = engine(on, 'haiku')
  await turn($, 't1', 'Rename the variable foo to bar in utils.ts please')
  await turn($, 't2', 'yes')
  expect(e.sent).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
  expect(e.classified()).toBe(1)
})

test('subagent steps are left alone', async ($, on) => {
  const e = engine(on, 'haiku')
  await turn($, 't1', 'Rename the variable foo to bar in utils.ts please', 'agent-1')
  expect(e.sent).toEqual(['claude-opus-5-5'])
})

test('an unparseable classifier answer leaves the session model', async ($, on) => {
  const e = engine(on, 'no idea')
  await turn($, 't1', 'Explain what this regular expression matches exactly')
  expect(e.sent).toEqual(['claude-opus-5-5'])
})

test('/auto-model pins and turns off', async ($, on) => {
  const e = engine(on, 'opus')
  on('command.run', () => ({ text: 'unhandled' }))
  const pinned = await $.command.run({ ...COMMAND, command: 'auto-model', args: 'sonnet' })
  expect(pinned.text).toContain('pinned to sonnet')
  await turn($, 't1', 'Design a sharded job queue with exactly-once delivery')
  await $.command.run({ ...COMMAND, command: 'auto-model', args: 'off' })
  await turn($, 't2', 'Design a sharded job queue with exactly-once delivery')
  expect(e.sent).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  expect(e.classified()).toBe(0)
})
