import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'

const root = process.env.JEV_DSH_HOST_ROOT

test('mounts on DSH 0.2.1-rc.2 and uses its real llm, catalog, stream and cancellation contracts', {skip: !root, timeout: 10000}, async t => {
  const require = createRequire(join(resolve(root), 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href)
  const {Context} = await load('cordis'), llm = await load('dsh-llm')
  const plugin = await import('../lib/index.js')
  const directory = await mkdtemp(join(tmpdir(), 'jev-host-'))
  const ctx = new Context(), requests = [], routes = []
  t.after(async () => {await ctx.fiber.dispose(); await rm(directory, {recursive: true, force: true})})
  await ctx.plugin(llm.default)
  let mode = 'ok'
  class Offline extends llm.LlmAdapter {
    async listModels(provider) {return [{provider, id: 'ordinary', name: '离线普通模型'}]}
    async resolveModel(provider, id) {return {provider, id, name: id, reasoning: {efforts: [{id: 'low', name: '低'}]}}}
    async *stream(request) {
      requests.push(request)
      if (mode === 'hang') {await new Promise(resolve => request.signal.addEventListener('abort', resolve, {once: true})); return}
      const text = mode === 'bad' ? '{"answers":{}}' : '{"answers":{"reply":{"type":"choice","choice":"ignore","probabilities":{"ignore":0.8,"draft":0.15,"human":0.05}}}}'
      yield {type: 'block-start', index: 0, blockType: 'text'}
      yield {type: 'block-end', index: 0, block: {type: 'text', text}}
      yield {type: 'finish', reason: {kind: 'stop'}}
    }
  }
  ctx.llm.registerAdapter(['offline'], new Offline())
  ctx.provide('settings', {installSection(_ctx, _ns, _schema, cfg, handlers) {handlers.setSource(() => cfg)}})
  ctx.provide('connection', {admit: () => ({peer: {principal: {kind: 'owner'}}})})
  ctx.provide('webServer', {register(route) {routes.push(route); return () => {}}})
  await ctx.plugin(plugin, {provider: 'ordinary-profile', dataDir: directory, profiles: [{id: 'ordinary-profile', provider: 'native', nativeProvider: 'offline', model: 'ordinary', reasoningEffort: 'low'}]})
  await new Promise(resolve => setImmediate(resolve))
  const request = {state: '离线集成验证', questions: {reply: {type: 'choice', instructions: '选择处理方式', criteria: {ignore: '忽略', draft: '草稿', human: '人工'}}}}
  const result = await ctx.decisionModels.ask(request)
  assert.equal(result.provider, 'ordinary-profile')
  assert.deepEqual(result.answers.reply.probabilities, {ignore: 0.8, draft: 0.15, human: 0.05})
  assert.equal(requests[0].provider, 'offline')
  assert.equal(requests[0].reasoningEffort, 'low')
  assert.deepEqual(requests[0].tools, [])
  assert.equal(ctx.get('tools'), undefined)
  assert.equal((await ctx.llm.listModels('offline'))[0].id, 'ordinary')
  assert.equal((await ctx.llm.resolveModelInfo('offline', 'ordinary')).id, 'ordinary')
  const route = routes.find(row => row.path.endsWith('/catalog'))
  const req = Readable.from([Buffer.from('{"provider":"offline"}')]); req.headers = {'content-type': 'application/json'}; req.method = 'POST'; req.socket = {remoteAddress: '127.0.0.1'}
  let catalog
  await route.handler(req, {writeHead() {}, end(body) {catalog = JSON.parse(body)}})
  assert.equal(catalog.ok, true)
  assert.equal(catalog.value.models[0].id, 'ordinary')
  assert.deepEqual(catalog.value.models[0].reasoningEfforts, [{id: 'low', name: '低'}])
  mode = 'bad'
  await assert.rejects(ctx.decisionModels.ask(request), /协议/)
  mode = 'hang'
  const controller = new AbortController(), pending = ctx.decisionModels.ask(request, {signal: controller.signal})
  await new Promise(resolve => setImmediate(resolve)); controller.abort()
  await assert.rejects(pending, {name: 'AbortError'})
  assert.equal(ctx.decisionModels.activeCount, 0)
})
