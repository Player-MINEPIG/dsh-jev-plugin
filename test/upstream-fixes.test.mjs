import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { resolveApiKey, createDecisionCaller, makeBridgeRoutes, callJev } from '../lib/index.js'

const credential = 'JEV_UPSTREAM_FIXTURE_KEY'
const request = {state: 'fixture', questions: {q: {type: 'noul', instructions: '是否成功'}}}
const reply = {answers: {q: {type: 'noul', noul: 1}}}

function fixtureEnvironment(t, value) {
  const previous = process.env[credential]
  t.after(() => {
    if (previous === undefined) delete process.env[credential]
    else process.env[credential] = previous
  })
  process.env[credential] = value
}

function dependencies(overrides = {}) {
  return {
    getConnection: () => ({admit: () => ({peer: {principal: {kind: 'owner'}}})}),
    getConfig: () => ({provider: 'custom', baseUrl: 'http://fixture/v1/systemone', credential}),
    getSettings: () => ({describe: () => [{ns: 'jev', revision: 1}], mutate: async () => {}}),
    getCredentials: () => ({describe: async () => ({configured: false}), set: async () => {}, unset: async () => {}}),
    getLedger: () => ({summary: () => ({calls: 0}), reset: () => {}}),
    getLlm: () => ({listProviders: () => []}),
    probe: async () => reply,
    ...overrides,
  }
}

async function bridge(path, deps, {address = '127.0.0.1', method = 'POST', body = {value: 'fixture-key', ops: []}, streamError = false} = {}) {
  const route = makeBridgeRoutes(deps).find(row => row.path.endsWith('/' + path))
  assert.ok(route)
  const req = streamError ? Readable.from((async function* () {throw Error('fixture request failure')})()) : Readable.from([Buffer.from(JSON.stringify(body))])
  req.headers = {'content-type': 'application/json'}; req.method = method; req.socket = {remoteAddress: address}
  let status, headers, result, writes = 0
  await route.handler(req, {writeHead(code, value) {status = code; headers = value}, end(value) {writes++; result = JSON.parse(value)}})
  assert.equal(writes, 1)
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(headers['referrer-policy'], 'no-referrer')
  return {status, ...result}
}

test('credential resolution trims each source and skips blank or non-string candidates in priority order', async t => {
  fixtureEnvironment(t, '  env-fixture\n')
  for (const [stored, legacy, expected] of [
    ['  store-fixture\n', 'legacy-fixture', 'store-fixture'],
    [' \n ', '  legacy-fixture\n', 'legacy-fixture'],
    [42, '  legacy-fixture\n', 'legacy-fixture'],
    [undefined, ' \n ', 'env-fixture'],
    [undefined, undefined, 'env-fixture'],
  ]) {
    assert.equal(await resolveApiKey({resolve: async () => ({value: stored})}, credential, legacy), expected)
  }
  process.env[credential] = ' \n '
  assert.equal(await resolveApiKey(undefined, credential, ' '), '')
})

test('shared custom calls send the trimmed key and refuse all-blank credentials before transport', async t => {
  fixtureEnvironment(t, ' ')
  let stored = '  fixture-key\n', calls = 0, authorization
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++
    assert.equal(url, 'http://fixture/v1/systemone')
    authorization = init.headers.authorization
    return new Response(JSON.stringify(reply))
  })
  const ask = createDecisionCaller(() => ({resolve: async () => ({value: stored})}), dependencies().getConfig)
  assert.deepEqual((await ask(request)).answers, reply.answers)
  assert.equal(authorization, 'Bearer fixture-key')
  stored = ' \n '
  await assert.rejects(ask(request), /未配置 API 密钥/)
  assert.equal(calls, 1)
})

test('bridge environment badges agree with credential resolution for blank environment values', async t => {
  fixtureEnvironment(t, ' \n ')
  for (const path of ['describe', 'key-describe']) {
    assert.equal((await bridge(path, dependencies())).value.envFallback, false)
  }
  process.env[credential] = ' env-fixture '
  for (const path of ['describe', 'key-describe']) {
    assert.equal((await bridge(path, dependencies())).value.envFallback, true)
  }
})

for (const [path, source] of [['describe', 'getConfig'], ['mutate', 'getSettings'], ['catalog', 'getLlm'], ['usage', 'getLedger']]) {
  test(`${path} returns a Chinese JSON internal-error when its dependency throws`, async () => {
    const result = await bridge(path, dependencies({[source]: () => {throw Error('fixture private dependency detail')}}))
    assert.equal(result.status, 500)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'internal-error')
    assert.match(result.message, /Jev|设置/)
    assert.doesNotMatch(result.message, /fixture private|Error:|\n\s+at /)
  })
}

test('all eight bridge routes preserve guard order and never touch dependencies for refused requests', async () => {
  const paths = ['catalog', 'describe', 'mutate', 'key-describe', 'key-set', 'key-unset', 'usage', 'test']
  const fail = () => {throw Error('guard touched a dependency')}
  const deps = Object.fromEntries(Object.keys(dependencies()).map(key => [key, fail]))
  for (const path of paths) {
    const remote = await bridge(path, {...deps, getConnection: () => ({admit: () => ({rejection: 403})})}, {address: '203.0.113.1', method: 'GET'})
    assert.equal(remote.status, 403); assert.equal(remote.code, 'forbidden')
    const get = await bridge(path, {...deps, getConnection: dependencies().getConnection}, {method: 'GET'})
    assert.equal(get.status, 405); assert.equal(get.code, 'method-not-allowed')
  }
})

test('bridge request-stream errors return JSON while existing handled error codes remain intact', async () => {
  for (const path of ['catalog', 'mutate', 'key-describe', 'key-set', 'key-unset', 'usage']) {
    const result = await bridge(path, dependencies(), {streamError: true})
    assert.equal(result.status, 500); assert.equal(result.code, 'internal-error')
  }
  const fail = () => {throw Error('fixture failure')}
  for (const path of ['key-describe', 'key-set', 'key-unset']) {
    const result = await bridge(path, dependencies({getConfig: fail}))
    assert.equal(result.status, 200); assert.equal(result.code, 'credentials-write-failed')
  }
  const probe = await bridge('test', dependencies({probe: fail}))
  assert.equal(probe.status, 200); assert.equal(probe.code, 'probe-failed')
})

test('bridge never writes a second response after the response has already ended', async () => {
  const route = makeBridgeRoutes(dependencies()).find(row => row.path.endsWith('/describe'))
  const res = {writableEnded: false, headersSent: false, writes: 0,
    writeHead() {this.headersSent = true},
    end() {this.writes++; this.writableEnded = true; throw Error('fixture already sent')},
  }
  await route.handler({method: 'POST', headers: {'content-type': 'application/json'}, socket: {remoteAddress: '127.0.0.1'}}, res)
  assert.equal(res.writes, 1)
})

for (const status of [429, 503]) {
  test(`HTTP ${status} with Retry-After above 30 seconds fails immediately without echoing the body`, async t => {
    let calls = 0
    const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive))
    await assert.rejects(callJev({url: 'http://fixture', apiKey: 'fixture-key', ...request, timeoutMs: 100,
      fetchImpl: async () => {calls++; return new Response('fixture-private-body', {status, headers: {'retry-after': '15366'}})},
    }), error => {
      assert.equal(error.name, 'Error')
      assert.match(error.message, /30 秒/)
      assert.match(error.message, new RegExp(`HTTP ${status}`))
      assert.doesNotMatch(error.message, /fixture-private-body/)
      return true
    })
    assert.equal(calls, 1)
  })
}

test('valid Retry-After is honored up to 30 seconds, then the request can succeed', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  let calls = 0
  const pending = callJev({url: 'http://fixture', apiKey: 'fixture-key', ...request,
    fetchImpl: async () => ++calls === 1
      ? new Response('{}', {status: 429, headers: {'retry-after': '30'}})
      : new Response(JSON.stringify(reply)),
  })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(29999)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  t.mock.timers.tick(1)
  assert.deepEqual(await pending, reply)
  assert.equal(calls, 2)
})

test('non-retryable HTTP errors keep their existing error regardless of Retry-After', async () => {
  let calls = 0
  await assert.rejects(callJev({url: 'http://fixture', apiKey: 'fixture-key', ...request,
    fetchImpl: async () => {calls++; return new Response('{}', {status: 401, headers: {'retry-after': '15366'}})},
  }), /拒绝了凭据.*HTTP 401/)
  assert.equal(calls, 1)
})
