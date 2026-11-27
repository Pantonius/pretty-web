const DISCOVERY_TIMEOUT_MS = 5000

export type AuthMode = 'none' | 'oidc' | 'proxy'

export interface AuthConfig {
  mode: AuthMode
  issuer?: string
  clientId?: string
  redirectUri: string
  scope: string
}

export interface UserProfile {
  sub: string
  name: string
  email?: string
}

interface Tokens {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresAt: number
}

export function readAuthConfig(): AuthConfig {
  const mode = ((import.meta.env.VITE_AUTH_MODE as AuthMode | undefined) || 'none') as AuthMode
  return {
    mode,
    issuer: import.meta.env.VITE_OIDC_ISSUER as string | undefined,
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined,
    redirectUri: (import.meta.env.VITE_OIDC_REDIRECT_URI as string | undefined) ||
      `${window.location.origin}${import.meta.env.BASE_URL}`,
    scope: (import.meta.env.VITE_OIDC_SCOPE as string | undefined) || 'openid profile email'
  }
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(
    atob(padded)
      .split('')
      .map(char => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join('')
  )
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function fetchDiscovery(issuer: string): Promise<{ authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const TOKEN_KEY = 'pretty-web.tokens'

function loadTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    return null
  }
}

function saveTokens(tokens: Tokens): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem('pretty-web.pkce')
}

let discoveryCache: Promise<{ authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string }> | null = null

function getDiscovery(config: AuthConfig) {
  discoveryCache ??= fetchDiscovery(config.issuer!)
  return discoveryCache
}

export function hasAuthCodeCallback(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') && params.has('state')
}

export async function login(config: AuthConfig): Promise<void> {
  const discovery = await getDiscovery(config)
  const verifier = randomString()
  const state = randomString(16)
  const challenge = await pkceChallenge(verifier)

  sessionStorage.setItem('pretty-web.pkce', JSON.stringify({ verifier, state }))

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId!,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  window.location.assign(`${discovery.authorization_endpoint}?${params}`)
}

export async function handleAuthCallback(config: AuthConfig): Promise<UserProfile> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) throw new Error('Missing code/state in callback')

  const stored = sessionStorage.getItem('pretty-web.pkce')
  if (!stored) throw new Error('No login attempt in progress')
  const { verifier, state: expectedState } = JSON.parse(stored) as { verifier: string; state: string }
  if (state !== expectedState) throw new Error('OAuth state mismatch')

  const discovery = await getDiscovery(config)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId!,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier
  })
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status}`)
  const payload = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    id_token?: string
  }

  saveTokens({
    accessToken: payload.access_token,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000
  })

  window.history.replaceState({}, '', config.redirectUri)
  const claims = payload.id_token ? (JSON.parse(base64UrlDecode(payload.id_token.split('.')[1])) as Record<string, unknown>) : {}
  return profileFromClaims(claims)
}

export function profileFromClaims(claims: Record<string, unknown>): UserProfile {
  const sub = String(claims.sub ?? 'user')
  return {
    sub,
    name: String(claims.preferred_username ?? claims.name ?? claims.email ?? sub),
    email: claims.email ? String(claims.email) : undefined
  }
}

async function refresh(config: AuthConfig, refreshToken: string): Promise<Tokens> {
  const discovery = await getDiscovery(config)
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId!,
      refresh_token: refreshToken
    })
  })
  if (!res.ok) throw new Error('Refresh failed')
  const payload = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    id_token?: string
  }
  const tokens: Tokens = {
    accessToken: payload.access_token,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000
  }
  saveTokens(tokens)
  return tokens
}

export async function getAccessToken(config: AuthConfig): Promise<string> {
  const tokens = loadTokens()
  if (!tokens) throw new Error('Not authenticated')
  if (tokens.expiresAt - 30_000 > Date.now()) return tokens.accessToken
  if (!tokens.refreshToken) throw new Error('Session expired')
  return (await refresh(config, tokens.refreshToken)).accessToken
}

export function isAuthenticated(): boolean {
  const tokens = loadTokens()
  return !!tokens && (tokens.expiresAt > Date.now() || !!tokens.refreshToken)
}

export async function logout(config: AuthConfig): Promise<void> {
  const tokens = loadTokens()
  clearTokens()
  if (tokens?.accessToken) {
    try {
      const discovery = await getDiscovery(config)
      if (discovery.revocation_endpoint) {
        await fetch(discovery.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.clientId!,
            token: tokens.accessToken
          })
        })
      }
    } catch {
      /* revocation is best-effort */
    }
  }
}

export async function fetchProxyIdentity(): Promise<UserProfile> {
  const res = await fetch('/me', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Not authenticated through the proxy (HTTP ${res.status})`)
  const body = (await res.json()) as { user?: { sub?: string; preferred_username?: string; name?: string; email?: string } }
  const user = body.user
  if (!user) throw new Error('Proxy did not provide an identity')
  return {
    sub: String(user.sub ?? user.preferred_username ?? 'user'),
    name: String(user.name ?? user.preferred_username ?? user.sub ?? 'user'),
    email: user.email
  }
}
