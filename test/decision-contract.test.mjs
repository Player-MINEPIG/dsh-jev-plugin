import test from 'node:test'
import assert from 'node:assert/strict'
import { createDecisionCaller } from '../lib/index.js'

const request = {
  state: '待处理消息',
  questions: {reply: {type: 'choice', instructions: '选择处理方式', criteria: {ignore: '忽略', draft: '起草', human: '人工处理'}}},
}
const answer = {type: 'choice', choice: 'ignore', probabilities: {ignore: 0.8, draft: 0.15, human: 0.05}}
function nativeLlm(source, inspect = () => {}) {
  return {async prepareCall(config) {
    return {config, async *stream(payload) {
      inspect(payload)
      yield {type: 'block-start', index: 0, blockType: 'text'}
      yield {type: 'block-end', index: 0, block: {type: 'text', text: source}}
      yield {type: 'finish', reason: {kind: 'stop'}}
    }}
  }}
}
for (const provider of ['custom', 'native']) {
  test(`${provider} preserves complete choice probabilities and rejects malformed decisions`, async t => {
    let source, sent
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      sent = {url, ...init}
      return new Response(source)
    })
    const cfg = {provider, baseUrl: 'https://router.invalid/v1/systemone', nativeProvider: 'host', model: 'ordinary'}
    const ask = createDecisionCaller(() => ({resolve: async () => ({value: 'fixture-key'})}), () => cfg, undefined,
      () => nativeLlm(source, payload => {sent = payload}))
    source = JSON.stringify({answers: {reply: answer}})
    const result = await ask(request)
    assert.deepEqual(result.answers.reply, answer)
    if (provider === 'custom') {
      assert.equal(sent.url, cfg.baseUrl)
      assert.equal(sent.method, 'POST')
      assert.equal(sent.headers.authorization, 'Bearer fixture-key')
      assert.deepEqual(JSON.parse(sent.body), {model: cfg.model, ...request})
    } else {
      assert.match(sent.system, /probabilities/)
      assert.match(sent.system, /自报/)
      assert.deepEqual(sent.tools, [])
    }
    const invalid = [
      'not JSON', '```json\n{}\n```', '{"answers":{},"answers":{}}', '{}',
      {answers: {}}, {answers: {reply: answer, extra: answer}},
      {answers: {reply: {...answer, type: 'noul', noul: 0.8}}},
      ...[
        {...answer, choice: 'unknown'}, {...answer, probabilities: undefined},
        {...answer, probabilities: {ignore: 0.8, draft: 0.2}},
        {...answer, probabilities: {ignore: 0.8, draft: 0.1, human: 0.1, extra: 0}},
        {...answer, probabilities: {ignore: -0.1, draft: 0.6, human: 0.5}},
        {...answer, probabilities: {ignore: 1.1, draft: 0, human: 0}},
        {...answer, probabilities: {ignore: '0.8', draft: 0.15, human: 0.05}},
        {...answer, probabilities: {ignore: 0.5, draft: 0, human: 0}},
        {...answer, confidence: 'high'}, {...answer, confidence: 1.1},
      ].map(reply => ({answers: {reply}})),
    ]
    for (const value of invalid) {
      source = typeof value === 'string' ? value : JSON.stringify(value)
      await assert.rejects(ask(request), /JSON|协议/, source)
    }
    source = '{"answers":{"reply":{"type":"choice","choice":"ignore","probabilities":{"ignore":1e999,"draft":0,"human":0}}}}'
    await assert.rejects(ask(request), /协议/)
    source = JSON.stringify({answers: {reply: {...answer, probabilities: {ignore: 0.333, draft: 0.333, human: 0.333}}}})
    assert.deepEqual((await ask(request)).answers.reply.probabilities, {ignore: 0.333, draft: 0.333, human: 0.333})
  })

  test(`${provider} keeps noul and score answers, optional metadata and special question IDs`, async t => {
    const questions = JSON.parse('{"__proto__":{"type":"noul","instructions":"是否成功"},"rating":{"type":"score","instructions":"严重程度","criteria":["低","中","高"]}}')
    const answers = JSON.parse('{"__proto__":{"type":"noul","noul":0.8},"rating":{"type":"score","score":1.4,"probabilities":{"0":0,"1":0.6,"2":0.4},"legend":{"0":"低","1":"中","2":"高"}}}')
    let source = JSON.stringify({answers})
    t.mock.method(globalThis, 'fetch', async () => new Response(source))
    const ask = createDecisionCaller(() => ({resolve: async () => ({value: 'fixture-key'})}),
      () => ({provider, baseUrl: 'https://router.invalid/v1/systemone', nativeProvider: 'host', model: 'ordinary'}),
      undefined, () => nativeLlm(source))
    assert.deepEqual((await ask({state: 'fixture', questions})).answers, answers)
    source = JSON.stringify({answers: {...answers, rating: {type: 'score', score: 1.4}}})
    assert.deepEqual((await ask({state: 'fixture', questions})).answers.rating, {type: 'score', score: 1.4})
    for (const rating of [
      {type: 'score', score: '1.4'},
      {...answers.rating, probabilities: {'0': 0, '1': 1}},
      {...answers.rating, probabilities: {'0': 0, '1': 0, '2': 0}},
    ]) {
      source = JSON.stringify({answers: {...answers, rating}})
      await assert.rejects(ask({state: 'fixture', questions}), /协议/)
    }
    for (const noul of [-1, 2, '0.8']) {
      Object.defineProperty(answers, '__proto__', {value: {type: 'noul', noul}, enumerable: true, configurable: true})
      source = JSON.stringify({answers})
      await assert.rejects(ask({state: 'fixture', questions}), /协议/)
    }
  })
}
