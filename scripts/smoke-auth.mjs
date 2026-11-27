import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocket } from 'ws'

const KEY_PORT = 9999
const APP_PORT = 1234
const kid = 'test-key-1'

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = publicKey.export({ format: 'jwk' })
pubJwk.kid = kid
pubJwk.alg = 'RS256'
pubJwk.use = 'sig'

const b64u = input => Buffer.from(JSON.stringify(input)).toString('base64url')
const sign = (header, payload) => {
  const data = `${b64u(header)}.${b64u(payload)}`
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey)
  return `${data}.${sig.toString('base64url')}`
}

const now = Math.floor(Date.now() / 1000)
const validToken = sign({ alg: 'RS256', kid, typ: 'JWT' }, {
  iss: 'http://127.0.0.1:9999/app/',
  sub: 'alice',
  preferred_username: 'alice',
  aud: 'pretty-web',
  exp: now + 300
})
const expiredToken = sign({ alg: 'RS256', kid, typ: 'JWT' }, {
  iss: 'http://127.0.0.1:9999/app/', sub: 'alice', aud: 'pretty-web', exp: now - 300
})
const wrongIssuerToken = sign({ alg: 'RS256', kid, typ: 'JWT' }, {
  iss: 'http://evil.example/', sub: 'alice', aud: 'pretty-web', exp: now + 300
})
const [h, p, s] = validToken.split('.')
const tamperedToken = `${h}.${p}.${s.slice(0, -4)}AAAA`

const discovery = http.createServer((req, res) => {
  if (req.url === '/app/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ issuer: 'http://127.0.0.1:9999/app/', jwks_uri: `http://127.0.0.1:${KEY_PORT}/jwks` }))
    return
  }
  if (req.url === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: [pubJwk] }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise(resolve => discovery.listen(KEY_PORT, '127.0.0.1', resolve))

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function tryConnect(label, url, headers = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket(url, { headers })
    const outcome = new Promise(resolveOutcome => {
      ws.on('open', () => resolveOutcome('open'))
      ws.on('error', err => resolveOutcome(`error: ${err.message}`))
    })
    const timeout = wait(4000).then(() => 'timeout')
    Promise.race([outcome, timeout]).then(result => {
      ws.terminate()
      console.log(`${label}: ${result}`)
      resolve(result)
    })
  })
}

async function getMe(path, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, { headers })
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}

async function testOidc() {
  console.log('--- AUTH_MODE=oidc ---')
  const child = spawnServer({ AUTH_MODE: 'oidc', AUTH_ISSUER: 'http://127.0.0.1:9999/app/', AUTH_AUDIENCE: 'pretty-web' })
  await wait(1200)

  const results = []
  results.push(await tryConnect('valid token', `ws://127.0.0.1:${APP_PORT}/room-a?token=${validToken}`))
  results.push(await tryConnect('no token', `ws://127.0.0.1:${APP_PORT}/room-a`))
  results.push(await tryConnect('expired token', `ws://127.0.0.1:${APP_PORT}/room-a?token=${expiredToken}`))
  results.push(await tryConnect('tampered token', `ws://127.0.0.1:${APP_PORT}/room-a?token=${tamperedToken}`))
  results.push(await tryConnect('wrong issuer', `ws://127.0.0.1:${APP_PORT}/room-a?token=${wrongIssuerToken}`))
  results.push(await tryConnect('garbage token', `ws://127.0.0.1:${APP_PORT}/room-a?token=not-a-jwt`))

  const me1 = await getMe('/me', {})
  const me2 = await getMe(`/me?token=${validToken}`)
  console.log('/me unauthenticated:', me1.status, '| /me with token:', me2.status, JSON.stringify(me2.body))

  child.kill()
  discovery.close()

  const ok =
    results[0] === 'open' &&
    results.slice(1).every(r => r.startsWith('error')) &&
    me1.status === 401 &&
    me2.status === 200
  if (!ok) throw new Error('OIDC auth test FAILED')
  console.log('OIDC MODE PASSED')
}

import { spawn } from 'node:child_process'

function spawnServer(env) {
  const child = spawn('node', ['server/src/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(APP_PORT), DATA_DIR: '/tmp/pretty-auth-data', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', d => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', d => process.stderr.write(`[server!] ${d}`))
  return child
}

async function testProxy() {
  console.log('--- AUTH_MODE=proxy ---')
  const child = spawnServer({ AUTH_MODE: 'proxy' })
  await wait(800)

  const results = []
  results.push(await tryConnect('with authentik headers', `ws://127.0.0.1:${APP_PORT}/room-b`, {
    'x-authentik-username': 'bob',
    'x-authentik-name': 'Bob Builder'
  }))
  results.push(await tryConnect('without headers', `ws://127.0.0.1:${APP_PORT}/room-b`))

  const me1 = await getMe('/me', { 'x-authentik-username': 'bob', 'x-authentik-name': 'Bob Builder' })
  const me2 = await getMe('/me')
  console.log('/me with headers:', me1.status, JSON.stringify(me1.body), '| without:', me2.status)

  child.kill()
  const ok = results[0] === 'open' && results[1].startsWith('error') && me1.status === 200 && me2.status === 401
  if (!ok) throw new Error('PROXY auth test FAILED')
  console.log('PROXY MODE PASSED')
}

async function testNone() {
  console.log('--- AUTH_MODE=none ---')
  const child = spawnServer({ AUTH_MODE: 'none' })
  await wait(800)
  const r = await tryConnect('anonymous', `ws://127.0.0.1:${APP_PORT}/room-c`)
  const me = await getMe('/me')
  child.kill()
  if (r !== 'open' || me.status !== 200) throw new Error('NONE auth test FAILED')
  console.log('NONE MODE PASSED')
}

await testOidc()
await testProxy()
await testNone()
console.log('ALL AUTH SMOKE TESTS PASSED')
process.exit(0)
