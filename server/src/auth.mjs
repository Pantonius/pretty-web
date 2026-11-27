import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

const HTTP_TIMEOUT_MS = 5000
const JWKS_MAX_AGE_MS = 15 * 60 * 1000
const CLOCK_LEEWAY_S = 30

export const AUTH_MODES = ['none', 'oidc', 'proxy']

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function b64Url(input) {
  return Buffer.from(input).toString('base64url')
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

class OidcVerifier {
  constructor({ issuer, audience }) {
    this.issuer = issuer
    this.audience = audience
    this.jwks = null
    this.jwksFetchedAt = 0
    this.jwksPromise = null
  }

  async fetchDiscovery() {
    const url = `${this.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
    const discovery = await fetchJson(url)
    if (!discovery.jwks_uri) {
      throw new Error(`OIDC discovery at ${url} has no jwks_uri`)
    }
    return discovery
  }

  async getDiscovery() {
    this.discovery ??= this.fetchDiscovery()
    return this.discovery
  }

  async loadJwks(force = false) {
    const fresh = this.jwks && Date.now() - this.jwksFetchedAt < JWKS_MAX_AGE_MS
    if (fresh && !force) return this.jwks
    this.jwksPromise ??= (async () => {
      const discovery = await this.getDiscovery()
      const jwks = await fetchJson(discovery.jwks_uri)
      this.jwksFetchedAt = Date.now()
      return jwks
    })()
    try {
      this.jwks = await this.jwksPromise
      return this.jwks
    } finally {
      this.jwksPromise = null
    }
  }

  async verify(token) {
    if (typeof token !== 'string' || token.length > 8192) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null

    let header, payload
    try {
      header = JSON.parse(base64UrlDecode(parts[0]))
      payload = JSON.parse(base64UrlDecode(parts[1]))
    } catch {
      return null
    }
    if (header.alg !== 'RS256') return null

    let jwk = null
    try {
      const jwks = await this.loadJwks()
      jwk = (jwks.keys ?? []).find(key => key.kid === header.kid) ?? null
      if (!jwk && Date.now() - this.jwksFetchedAt > 10_000) {
        jwk = ((await this.loadJwks(true)).keys ?? []).find(key => key.kid === header.kid) ?? null
      }
    } catch {
      return null
    }
    if (!jwk) return null

    let valid = false
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' })
      valid = cryptoVerify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], 'base64')
      )
    } catch {
      return null
    }
    if (!valid) return null

    const now = Math.floor(Date.now() / 1000)
    if (typeof payload.exp === 'number' && payload.exp + CLOCK_LEEWAY_S < now) return null
    if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_LEEWAY_S > now) return null
    if (this.issuer && payload.iss?.replace(/\/$/, '') !== this.issuer.replace(/\/$/, '')) return null
    if (this.audience) {
      const aud = payload.aud
      if (aud !== this.audience && !(Array.isArray(aud) && aud.includes(this.audience))) return null
    }
    if (!payload.sub) return null
    return payload
  }
}

function identityFromProxyHeaders(headers) {
  const username = headers['x-authentik-username']
  if (!username) return null
  const groups = headers['x-authentik-groups']
  return {
    sub: String(username),
    preferred_username: String(username),
    name: headers['x-authentik-name'] ? String(headers['x-authentik-name']) : String(username),
    email: headers['x-authentik-email'] ? String(headers['x-authentik-email']) : undefined,
    groups: groups ? String(groups).split(',').filter(Boolean) : []
  }
}

export async function createAuth(env = process.env) {
  const mode = env.AUTH_MODE ?? 'none'
  if (!AUTH_MODES.includes(mode)) {
    throw new Error(`Invalid AUTH_MODE "${mode}" (expected one of ${AUTH_MODES.join(', ')})`)
  }

  if (mode === 'oidc') {
    const issuer = env.AUTH_ISSUER
    if (!issuer) throw new Error('AUTH_MODE=oidc requires AUTH_ISSUER (authentik provider URL, e.g. https://auth.example.com/application/o/pretty-web/)')
    const verifier = new OidcVerifier({ issuer, audience: env.AUTH_AUDIENCE })
    await verifier.loadJwks()
    console.log(`auth: oidc (issuer ${issuer}, JWKS loaded)`)
    return {
      mode,
      async authenticate(req) {
        const url = new URL(req.url ?? '/', 'http://localhost')
        return verifier.verify(url.searchParams.get('token'))
      }
    }
  }

  if (mode === 'proxy') {
    console.log('auth: proxy (trusting X-authentik-* headers; must ONLY be reachable through the authentik outpost)')
    return {
      mode,
      async authenticate(req) {
        const headers = req.headers ?? {}
        if (env.AUTH_PROXY_SECRET) {
          const provided = headers['x-authentik-proxy-secret'] ?? headers['x-proxy-secret']
          if (provided !== env.AUTH_PROXY_SECRET) return null
        }
        return identityFromProxyHeaders(headers)
      }
    }
  }

  console.log('auth: disabled (anonymous access)')
  return {
    mode,
    async authenticate() {
      return { sub: 'anonymous', preferred_username: 'anonymous' }
    }
  }
}
