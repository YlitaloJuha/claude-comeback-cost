import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionStartInput, TurnCompleteInput, TurnUsage } from 'claude-code'

import { coldLine, writeRate } from '../hooks/register'

const START = 1_000_000
const MIN = 60 * 1000
const CONTEXT = 200_000

const usage: TurnUsage = { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: CONTEXT, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
const session: SessionStartInput = { surface: 'desktop', isInteractive: true, cwd: '/work' }
const props: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 75, scroll: { offset: 0, bodyRows: 10 }, view: {} }

type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
let turns = 0
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' + ++turns, reason: 'answer', usage, ...over })

function world(on: On, live: { tokens?: number } = { tokens: CONTEXT }) {
  const blocked = { submits: 0, models: 0 }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 1000000, tokens: live.tokens }, rateLimits: [] } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('prompt.submit', ($, e) => { blocked.submits++; return { text: e.text } })
  on('model.fork', () => { blocked.models++; return { value: null as never } })
  on('model.complete', () => { blocked.models++; return { value: null as never } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))
  return blocked
}

const COLD = 'cache cold · next message about $1.60 (200k tokens)'

test('the rates follow the model table', () => {
  expect(writeRate('claude-opus-5-5', CONTEXT)).toBe(8)
  expect(writeRate('claude-opus-5', CONTEXT)).toBe(10)
  expect(writeRate('claude-opus-4-1-20250805', CONTEXT)).toBe(30)
  expect(writeRate('claude-opus-4-8', CONTEXT)).toBe(10)
  expect(writeRate('claude-fable-5-1', CONTEXT)).toBe(20)
  expect(writeRate('claude-sonnet-5-5', CONTEXT)).toBe(4)
  expect(writeRate('claude-sonnet-4-6', CONTEXT)).toBe(6)
  expect(writeRate('claude-haiku-5-5', 50_000)).toBe(0.2)
  expect(writeRate('claude-haiku-5-5', CONTEXT)).toBe(1)
  expect(writeRate('some-other-model', CONTEXT)).toBe(null)
  expect(writeRate(null, CONTEXT)).toBe(null)
})

test('an unknown model still names the tokens, without a price', () => {
  const c = { lastRequestAt: 1, context: CONTEXT, model: 'some-other-model', resumedAt: 0, resumeUsd: null }
  expect(coldLine(c, 1 + 60 * MIN)).toBe('cache cold · next message re-writes 200k tokens')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the row appears at the hour, by itself, on ${surface}`, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    world(on)
    await $.session.start({ ...session, surface })
    const ui = await $.ui.mount({ plugin: 'comeback-cost', surface, component: 'AbovePrompt', props })
    await $.turn.complete(turn())
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    await clock.advance(59 * MIN)
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    await clock.advance(MIN)
    expect((await ui.find({ type: 'Text', text: /cache/ }))?.text).toBe(COLD)
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
  })
}

test('the row goes when a request goes out, and it never stops a message or calls a model', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const calls = world(on)
  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props })
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect((await ui.find({ type: 'Text', text: /cache/ }))?.text).toBe(COLD)
  const sent = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect('drop' in sent).toBe(false)
  expect(calls.submits).toBe(1)
  for await (const c of $.turn.step({ turnId: 'next', index: 0, model: 'claude-opus-5-5', messageCount: 3 })) void c
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  await clock.advance(24 * 60 * MIN)
  expect(calls.models).toBe(0)
})

test('a small context stays quiet', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on, { tokens: 20_000 })
  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props })
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
})

test('compaction clears it until the next turn reports the new context', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props })
  await $.turn.complete(turn())
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
  await clock.advance(120 * MIN)
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
})

test('/clear forgets the conversation', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props })
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  expect((await ui.find({ type: 'Text', text: /cache/ }))?.text).toBe(COLD)
  await $.session.end({ reason: 'clear', sessionId: 'S1' })
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
})

test('a resumed session with no last-response time may be cold after an hour', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start(session)
  const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
  await clock.advance(60 * MIN)
  expect((await ui.find({ type: 'Text', text: /cache/ }))?.text).toBe('cache may be cold · next message up to $1.60 (200k tokens)')
})

test('a survey and a running turn hide the row', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start(session)
  await $.turn.complete(turn())
  await clock.advance(120 * MIN)
  for (const over of [{ hasSurvey: true }, { isWorking: true }]) {
    const ui = await $.ui.mount({ plugin: 'comeback-cost', surface: 'desktop', component: 'AbovePrompt', props: { ...props, ...over } })
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    await ui.unmount()
  }
})
