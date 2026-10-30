/**
 * Operator auth: one secret (OPERATOR_TOKEN) unlocks everything that spends money or changes state.
 *
 * Signing in posts the token to /api/session/login, which stores `{ operator: true }` in an h3 sealed session cookie
 * (iron-sealed, httpOnly, sameSite=lax, secure in prod; Nitro's h3 is v1 here). server/middleware/operator.ts denies every guarded request without it.
 *
 * Modes (authMode): OPERATOR_TOKEN set → 'token'. Unset → 'open' in dev (local development unchanged) and 'closed'
 * in production (fail closed: nothing mutating works until the token is set).
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Nitro's (h3 v1) event; the top-level `h3` package is v2, so its type would not match. */
type H3Event = Parameters<typeof getCookie>[0]

export type AuthMode = 'token' | 'open' | 'closed'

export const SESSION_COOKIE = 'gpe-operator'
/** Absolute session lifetime: 30 days, then sign in again. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

interface OperatorEnv { token?: string, secret?: string, dev: boolean }

function readEnv(): OperatorEnv {
  return {
    token: process.env.OPERATOR_TOKEN?.trim() || undefined,
    secret: process.env.SESSION_SECRET?.trim() || undefined,
    dev: import.meta.dev
  }
}

export function authMode(env: OperatorEnv = readEnv()): AuthMode {
  return env.token ? 'token' : env.dev ? 'open' : 'closed'
}

/**
 * Whether a request needs the operator. Deny by default: every non-read method under /api/ is guarded except the
 * routes below, so a new mutating route is locked down without anyone remembering to add it.
 *  - /api/inngest: Inngest signs its requests (INNGEST_SIGNING_KEY); the SDK verifies them.
 *  - /api/mcp: the public, read-only agent API (POST is just MCP's transport).
 *  - /api/runs/:id/events: the sandbox agent's callback, authorized by the per-run bearer token.
 *  - /api/papers/:slug/chat: public for readers, bounded by chatLimits.ts instead.
 *  - /api/session/*: signing in and out.
 */
const OPEN_WRITES: RegExp[] = [
  /^\/api\/inngest\/?$/,
  /^\/api\/mcp\/?$/,
  /^\/api\/runs\/[^/]+\/events\/?$/,
  /^\/api\/papers\/[^/]+\/chat\/?$/,
  /^\/api\/session\/(login|logout)\/?$/
]
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function needsOperator(method: string, pathname: string) {
  if (READ_METHODS.has(method.toUpperCase())) {
    return false
  }
  // Collapse `//` and decode so `/api//papers` or `/api/%70apers` can't slip past the prefix check.
  let path = pathname
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return true
  }
  path = path.replace(/\/{2,}/g, '/').toLowerCase()
  if (!path.startsWith('/api/')) {
    return false
  }
  return !OPEN_WRITES.some(re => re.test(path))
}

/** Constant-time compare (lengths leak, which is fine for a random token). */
export function tokenMatches(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

/** Short fingerprint of the token stored in the session, so rotating OPERATOR_TOKEN signs every session out. */
export function tokenFingerprint(token: string) {
  return createHash('sha256').update(`gpe-operator:${token}`).digest('hex').slice(0, 16)
}

/** SESSION_SECRET when it is long enough (h3 needs 32+ chars), else a key derived from OPERATOR_TOKEN. */
export function sessionPassword(env: OperatorEnv) {
  if (env.secret && env.secret.length >= 32) {
    return env.secret
  }
  return createHash('sha256').update(`gpe-session:${env.token ?? ''}`).digest('hex')
}

interface OperatorSession { operator?: boolean, tok?: string }

function sessionConfig(env: OperatorEnv) {
  return {
    name: SESSION_COOKIE,
    password: sessionPassword(env),
    maxAge: SESSION_MAX_AGE,
    sessionHeader: false as const,
    cookie: { httpOnly: true, secure: !env.dev, sameSite: 'lax' as const, path: '/' }
  }
}

export async function isOperator(event: H3Event) {
  const env = readEnv()
  const mode = authMode(env)
  if (mode !== 'token') {
    return mode === 'open'
  }
  // Memoized per request: the middleware and the chat route both ask.
  const ctx = event.context as { operator?: boolean }
  if (ctx.operator !== undefined) {
    return ctx.operator
  }
  // Read the cookie directly: h3 v1's getSession would mint (and Set-Cookie) a session for every anonymous visitor.
  const sealed = getCookie(event, SESSION_COOKIE)
  const data = sealed
    ? ((await unsealSession(event, sessionConfig(env), sealed).catch(() => null))?.data as OperatorSession | undefined)
    : undefined
  ctx.operator = data?.operator === true && data.tok === tokenFingerprint(env.token!)
  return ctx.operator
}

/** Throws 401 unless the request is the operator's. Use in a handler; the middleware already covers /api writes. */
export async function requireOperator(event: H3Event) {
  if (await isOperator(event)) {
    return
  }
  const closed = authMode() === 'closed'
  throw createError({
    statusCode: closed ? 503 : 401,
    statusMessage: closed ? 'Operator auth is not configured' : 'Sign in as the operator to do this'
  })
}

export async function signIn(event: H3Event) {
  const env = readEnv()
  await updateSession<OperatorSession>(event, sessionConfig(env), { operator: true, tok: tokenFingerprint(env.token!) })
  ;(event.context as { operator?: boolean }).operator = true
}

export async function signOut(event: H3Event) {
  await clearSession(event, sessionConfig(readEnv()))
  ;(event.context as { operator?: boolean }).operator = false
}
