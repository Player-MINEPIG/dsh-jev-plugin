import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { callNative } from '../lib/native.js'
import { DecisionModels, createDecisionCaller } from '../lib/index.js'

const input = {provider: 'offline', model: 'ordinary', state: 'fixture', questions: {q: {type: 'noul', instructions: '是否成功'}}}
const text = '{"answers":{"q":{"type":"noul","noul":1}}}'
const start = {type: 'block-start', index: 0, blockType: 'text'}
const end = {type: 'block-end', index: 0, block: {type: 'text', text}}
const finish = {type: 'finish', reason: {kind: 'stop'}}
function llm(chunks) {
  return {async prepareCall(config) {return {config, async *stream() {yield* chunks}}}}
}

test('native accepts text deltas and reasoning blocks but parses only completed text', async () => {
  const result = await callNative(llm([
    {type: 'block-start', index: 1, blockType: 'reasoning'},
    {type: 'reasoning-delta', index: 1, text: '不是 JSON，也不是答案'},
    {type: 'block-end', index: 1, block: {type: 'reasoning', text: '不是 JSON，也不是答案'}},
    start, {type: 'text-delta', index: 0, text}, end,
    {type: 'usage', usage: {inputTokens: 3, outputTokens: 1, cacheReadTokens: 2}}, finish,
  ]), input, undefined, {})
  assert.equal(result.answers.q.noul, 1)
  assert.deepEqual(result.usage, {input_tokens: 5, output_tokens: 1})
})

test('native rejects bad JSON, malformed stream events, truncation, tool calls and oversized output', async () => {
  for (const chunks of [
    [start, {...end, block: {type: 'text', text: 'plain text'}}, finish],
    [start, end], [start, finish], [start, end, {type: 'finish', reason: {kind: 'length'}}],
    [start, end, finish, finish], [{type: 'text-delta', index: 0, text}],
    [start, start], [{type: 'block-start', index: 0, blockType: 'tool-call'}],
    [start, {type: 'text-delta', index: 0, text: '{}'}, end, finish],
    [start, end, {type: 'usage', usage: {inputTokens: -1, outputTokens: 1}}, finish],
    [start, end, {type: 'unknown'}],
  ]) await assert.rejects(callNative(llm(chunks), input, undefined, {}), /JSON|协议|不完整/)
  await assert.rejects(callNative(llm([start, end, finish]), input, undefined, {maxOutputBytes: 10}), /响应过大/)
  await assert.rejects(callNative(undefined, input, undefined, {}), /服务不可用/)
  const failure = Object.assign(new Error('fixture provider failure'), {code: 'PROVIDER_ERROR'})
  await assert.rejects(callNative({prepareCall() {throw failure}}, input, undefined, {}), error => error === failure)
})

for (const phase of ['prepare', 'stream']) {
  test(`native cancellation and deadline work during ${phase} even when the provider ignores signals`, async t => {
    let reached
    const ready = new Promise(resolve => {reached = resolve})
    let returned = false
    const host = {async prepareCall(config) {
      if (phase === 'prepare') {reached(); return new Promise(() => {})}
      return {config, stream() {return {[Symbol.asyncIterator]() {return {
        next() {reached(); return new Promise(() => {})},
        return() {returned = true; return Promise.resolve({done: true})},
      }}}}}
    }}
    const ctx = new Context(); t.after(() => ctx.fiber.dispose())
    const config = {provider: 'native', nativeProvider: input.provider, model: input.model, timeoutMs: 20}
    const value = new DecisionModels(ctx, createDecisionCaller(null, () => config, undefined, () => host), () => config)
    const controller = new AbortController()
    const pending = value.ask({state: input.state, questions: input.questions}, {signal: controller.signal})
    await ready; controller.abort()
    await assert.rejects(pending, {name: 'AbortError'})
    assert.equal(value.activeCount, 0)
    if (phase === 'stream') {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(returned, true)
    }
    const timer = setInterval(() => {}, 1000); t.after(() => clearInterval(timer))
    await assert.rejects(value.ask({state: input.state, questions: input.questions}), {name: 'TimeoutError'})
    assert.equal(value.activeCount, 0)
    controller.abort()
    await assert.rejects(value.ask({state: input.state, questions: input.questions}, {signal: controller.signal}), {name: 'AbortError'})
  })
}
