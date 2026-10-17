import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join, resolve} from 'node:path'
import {makeBridgeRoutes} from '../lib/index.js'

const paths = ['catalog', 'describe', 'mutate', 'key-describe', 'key-set', 'key-unset', 'usage', 'test']
const owner = {peer: {principal: {kind: 'owner'}}}
const authority = '198.51.100.10:3080'

function dependencies(getConnection) {
  const calls = []
  const touch = name => {calls.push(name)}
  return {calls, getConnection,
    getConfig: () => {touch('config'); return {provider: 'custom', baseUrl: 'https://fixture.invalid/systemone', credential: 'FIXTURE_JEV_KEY'}},
    getSettings: () => {touch('settings'); return {describe: () => [{ns: 'jev', revision: 4}], mutate: async () => {touch('mutate')}}},
    getCredentials: () => {touch('credentials'); return {describe: async () => ({configured: true}), set: async () => {touch('set')}, unset: async () => {touch('unset')}}},
    getLedger: () => {touch('ledger'); return {summary: () => ({calls: 0}), reset: () => {touch('reset')}}},
    getLlm: () => {touch('llm'); return {listProviders: () => []}},
    probe: async () => {touch('probe'); return {provider: 'custom', answers: {fixture: {type: 'noul', noul: 1}}}},
  }
}

async function invoke(path, deps, {headers = {}, method = 'POST', address = '198.51.100.20'} = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify({value: 'synthetic-fixture-key', ops: [], expectedRevision: 4}))])
  req.method = method
  req.socket = {remoteAddress: address}
  req.headers = {host: authority, 'content-type': 'application/json', ...headers}
  let status, body
  await makeBridgeRoutes(deps).find(route => route.path.endsWith('/' + path)).handler(req, {
    writeHead(value) {status = value}, end(value) {body = JSON.parse(value)},
  })
  return {status, ...body}
}

test('all settings routes fail closed without admission and require an owner, POST and JSON', async () => {
  for (const path of paths) {
    for (const [getConnection, options, status] of [
      [undefined, {}, 503],
      [() => ({}), {address: '127.0.0.1'}, 503],
      [() => ({admit: () => ({rejection: 401})}), {}, 401],
      [() => ({admit: () => ({rejection: 403})}), {}, 403],
      [() => ({admit: () => undefined}), {}, 403],
      [() => ({admit: () => ({peer: {principal: {kind: 'agent'}}})}), {}, 403],
      [() => ({admit: () => owner}), {method: 'GET'}, 405],
      [() => ({admit: () => owner}), {headers: {'content-type': undefined}}, 415],
      [() => ({admit: () => owner}), {headers: {'content-type': 'text/plain'}}, 415],
      [() => ({admit: () => owner}), {headers: {'content-type': 'application/x-www-form-urlencoded'}}, 415],
      [() => ({admit: () => owner}), {headers: {'content-type': 'multipart/form-data; boundary=fixture'}}, 415],
      [() => ({admit: () => owner}), {headers: {'content-type': 'application/json-unsafe'}}, 415],
    ]) {
      const deps = dependencies(getConnection)
      assert.equal((await invoke(path, deps, options)).status, status, path)
      assert.deepEqual(deps.calls, [], path)
    }
    const deps = dependencies(() => ({admit: () => owner}))
    assert.equal((await invoke(path, deps, {headers: {'content-type': 'Application/JSON; charset=utf-8'}})).ok, true, path)
  }
})

const root = process.env.JEV_DSH_HOST_ROOT

test('real DSH authentication admits remote owner cookies and rejects unauthenticated, forged and cross-site requests on all routes', {skip: !root}, async t => {
  const require = createRequire(join(resolve(root), 'package.json'))
  const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)
  const {Context} = await load('cordis')
  const connectionPlugin = await load('dsh-client-connection')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const records = new Map()
  ctx.provide('credentials', {async modifyRecord(key, change) {
    const update = await change(records.get(key))
    if (update) records.set(key, update)
    return records.get(key)
  }})
  ctx.provide('webServer', {host: '198.51.100.10', protocol: 'http:', register() {return () => {}}})
  await ctx.plugin(connectionPlugin, {})
  await new Promise(resolve => setImmediate(resolve))
  const connection = ctx.get('connection')
  assert.ok(connection)
  const url = new URL(connection.authenticatedUrl('http://' + authority))
  let loginStatus, cookie
  connection.authorizeIndex({method: 'GET', url: url.pathname + url.search, headers: {host: authority}}, {
    writeHead(status, headers) {loginStatus = status; cookie = headers['set-cookie'].split(';')[0]}, end() {},
  })
  assert.equal(loginStatus, 303)
  assert.ok(cookie)
  for (const path of paths) {
    const deps = dependencies(() => connection)
    const result = await invoke(path, deps, {headers: {cookie, origin: 'http://' + authority}})
    assert.equal(result.status, 200, path)
    assert.equal(result.ok, true, path)
    for (const [headers, status] of [
      [{}, 401],
      [{'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': authority}, 401],
      [{cookie: 'forged-fixture-cookie', origin: 'http://' + authority}, 401],
      [{cookie, host: 'attacker.invalid', 'x-forwarded-host': authority}, 403],
      [{cookie, origin: 'https://attacker.invalid'}, 403],
      [{cookie, 'sec-fetch-site': 'cross-site'}, 403],
      [{cookie, 'content-type': 'text/plain'}, 415],
      [{cookie, origin: 'https://attacker.invalid', 'content-type': 'text/plain'}, 403],
    ]) {
      const refused = dependencies(() => connection)
      assert.equal((await invoke(path, refused, {headers})).status, status, path)
      assert.deepEqual(refused.calls, [], path)
    }
  }
})
