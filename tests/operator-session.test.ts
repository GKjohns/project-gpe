// The guard end to end with OPERATOR_TOKEN set, on Nitro's own h3 (v1): sign in, cookie, guarded write, sign out.
// vitest has no Nitro auto-imports, so the h3 helpers operator.ts uses are stubbed in as globals.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as h3 from '../node_modules/@nuxt/nitro-server/node_modules/h3/dist/index.mjs'

const TOKEN = 'test-operator-token-0123456789abcdef'

let handle: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubEnv('OPERATOR_TOKEN', TOKEN)
  for (const name of ['getCookie', 'unsealSession', 'updateSession', 'clearSession', 'createError'] as const) {
    vi.stubGlobal(name, h3[name])
  }
  const { needsOperator, requireOperator, signIn, signOut, tokenMatches, isOperator } = await import('../server/utils/operator')
  const app = h3.createApp()
  // Same order as Nitro: the middleware, then the routes.
  app.use(h3.eventHandler(async (event) => {
    if (needsOperator(event.method, h3.getRequestURL(event).pathname)) {
      await requireOperator(event)
    }
  }))
  const router = h3.createRouter()
    .post('/api/session/login', h3.eventHandler(async (event) => {
      const body = await h3.readBody<{ token?: string }>(event)
      if (!tokenMatches(body?.token ?? '', TOKEN)) {
        throw h3.createError({ statusCode: 401 })
      }
      await signIn(event)
      return { operator: true }
    }))
    .post('/api/session/logout', h3.eventHandler(async (event) => {
      await signOut(event)
      return { operator: false }
    }))
    .get('/api/session', h3.eventHandler(async event => ({ operator: await isOperator(event) })))
    .post('/api/papers', h3.eventHandler(() => ({ ok: true })))
    .post('/api/runs/:id/events', h3.eventHandler(() => ({ ok: true })))
  app.use(router)
  const web = h3.toWebHandler(app)
  handle = req => web(req)
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const req = (method: string, path: string, init: { cookie?: string, body?: unknown } = {}) => handle(new Request(`http://localhost${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
  body: init.body === undefined ? undefined : JSON.stringify(init.body)
}))

describe('operator session (OPERATOR_TOKEN set)', () => {
  it('denies guarded writes without a session and sets no cookie for anonymous readers', async () => {
    expect((await req('POST', '/api/papers', { body: {} })).status).toBe(401)
    const session = await req('GET', '/api/session')
    expect(await session.json()).toEqual({ operator: false })
    expect(session.headers.get('set-cookie')).toBeNull()
  })

  it('keeps the per-run callback reachable without the cookie', async () => {
    expect((await req('POST', '/api/runs/abc/events', { body: {} })).status).toBe(200)
  })

  it('rejects a wrong token and a forged cookie', async () => {
    expect((await req('POST', '/api/session/login', { body: { token: 'nope' } })).status).toBe(401)
    expect((await req('POST', '/api/papers', { cookie: 'gpe-operator=Fe26.2**forged', body: {} })).status).toBe(401)
  })

  it('signs in, allows guarded writes with the cookie, and signs out', async () => {
    const login = await req('POST', '/api/session/login', { body: { token: TOKEN } })
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^gpe-operator=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    // vitest isn't dev, so this is the production cookie.
    expect(setCookie).toMatch(/Secure/i)
    const cookie = setCookie.split(';')[0]!

    expect((await req('POST', '/api/papers', { cookie, body: {} })).status).toBe(200)
    expect(await (await req('GET', '/api/session', { cookie })).json()).toEqual({ operator: true })

    const logout = await req('POST', '/api/session/logout', { cookie })
    expect(logout.headers.get('set-cookie')).toMatch(/^gpe-operator=;/)
  })

  it('signs every session out when the token rotates', async () => {
    const login = await req('POST', '/api/session/login', { body: { token: TOKEN } })
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
    // A SESSION_SECRET keeps the same cookie key across the rotation, so only the fingerprint can catch it.
    vi.stubEnv('SESSION_SECRET', 'y'.repeat(40))
    const login2 = await req('POST', '/api/session/login', { body: { token: TOKEN } })
    const cookie2 = (login2.headers.get('set-cookie') ?? '').split(';')[0]!
    vi.stubEnv('OPERATOR_TOKEN', `${TOKEN}-rotated`)
    expect((await req('POST', '/api/papers', { cookie: cookie2, body: {} })).status).toBe(401)
    expect((await req('POST', '/api/papers', { cookie, body: {} })).status).toBe(401)
    vi.stubEnv('OPERATOR_TOKEN', TOKEN)
    vi.stubEnv('SESSION_SECRET', '')
  })
})
