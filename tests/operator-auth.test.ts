import { describe, expect, it } from 'vitest'
import { chatErrorMessage } from '../app/utils/chatText'
import { CHAT_DAILY_USD_DEFAULT, ChatLimiter, chatDailyUsd, DailySpend, SlidingWindow } from '../server/utils/chatLimits'
import { authMode, needsOperator, sessionPassword, tokenFingerprint, tokenMatches } from '../server/utils/operator'

describe('operator guard: which requests need the operator', () => {
  const guarded: [string, string][] = [
    ['POST', '/api/papers'],
    ['POST', '/api/papers/preview'],
    ['POST', '/api/papers/eth/labels'],
    ['POST', '/api/runs/0b5c0b8e-9d1c-4a52-9b0e-3c1d2e4f5a6b/retry'],
    ['POST', '/api/runs/0b5c0b8e-9d1c-4a52-9b0e-3c1d2e4f5a6b/cancel'],
    ['POST', '/api/runs/0b5c0b8e-9d1c-4a52-9b0e-3c1d2e4f5a6b/review'],
    ['POST', '/api/corpus/sensitivity/ingest'],
    // Deny by default: a route that doesn't exist yet is guarded too.
    ['DELETE', '/api/papers/eth'],
    ['PATCH', '/api/anything'],
    ['PUT', '/api/papers/eth'],
    // Path tricks don't reach the open list.
    ['POST', '//api//papers'],
    ['POST', '/api/%70apers'],
    ['POST', '/api/papers/x/chat/papers']
  ]
  it.each(guarded)('%s %s is guarded', (method, path) => {
    expect(needsOperator(method, path)).toBe(true)
  })

  const open: [string, string][] = [
    ['GET', '/api/papers'],
    ['GET', '/api/runs/abc'],
    ['GET', '/api/blobs/abc'],
    ['HEAD', '/api/blobs/abc'],
    ['OPTIONS', '/api/papers'],
    ['GET', '/api/corpus'],
    ['GET', '/api/session'],
    ['POST', '/api/session/login'],
    ['POST', '/api/session/logout'],
    ['POST', '/api/inngest'],
    ['PUT', '/api/inngest'],
    ['POST', '/api/mcp'],
    ['GET', '/api/v1/papers/eth/get_node'],
    ['POST', '/api/runs/0b5c0b8e-9d1c-4a52-9b0e-3c1d2e4f5a6b/events'],
    ['POST', '/api/papers/eth/chat'],
    // Pages and other non-API routes aren't this guard's business.
    ['POST', '/papers/new'],
    ['GET', '/llms.txt']
  ]
  it.each(open)('%s %s is open', (method, path) => {
    expect(needsOperator(method, path)).toBe(false)
  })

  it('does not open a route whose name merely starts like an open one', () => {
    expect(needsOperator('POST', '/api/mcp/admin')).toBe(true)
    expect(needsOperator('POST', '/api/inngest-other')).toBe(true)
    expect(needsOperator('POST', '/api/runs/x/events/extra')).toBe(true)
    expect(needsOperator('POST', '/api/papers/eth/chat/x')).toBe(true)
    expect(needsOperator('POST', '/api/session/other')).toBe(true)
  })
})

describe('operator auth mode', () => {
  it('is token when OPERATOR_TOKEN is set, open in dev without it, closed in prod without it', () => {
    expect(authMode({ token: 'x', dev: false })).toBe('token')
    expect(authMode({ token: 'x', dev: true })).toBe('token')
    expect(authMode({ dev: true })).toBe('open')
    expect(authMode({ dev: false })).toBe('closed')
  })

  it('compares tokens exactly', () => {
    expect(tokenMatches('s3cret-token', 's3cret-token')).toBe(true)
    expect(tokenMatches('s3cret-tokem', 's3cret-token')).toBe(false)
    expect(tokenMatches('s3cret', 's3cret-token')).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
  })

  it('ties sessions to the token and uses a long enough cookie key', () => {
    expect(tokenFingerprint('a')).not.toBe(tokenFingerprint('b'))
    expect(sessionPassword({ token: 'short', dev: false }).length).toBeGreaterThanOrEqual(32)
    expect(sessionPassword({ token: 't', secret: 'x'.repeat(40), dev: false })).toBe('x'.repeat(40))
    // A too-short SESSION_SECRET is ignored rather than breaking sealing.
    expect(sessionPassword({ token: 't', secret: 'short', dev: false })).toBe(sessionPassword({ token: 't', dev: false }))
  })
})

describe('chat limits', () => {
  const HOUR = 60 * 60 * 1000

  it('sliding window allows `limit` hits per window per key, then frees the oldest slot', () => {
    const w = new SlidingWindow(3, HOUR)
    const t = 1_000_000
    expect(w.hit('a', t).ok).toBe(true)
    expect(w.hit('a', t + 10).ok).toBe(true)
    expect(w.hit('a', t + 20).ok).toBe(true)
    const denied = w.hit('a', t + 30)
    expect(denied).toEqual({ ok: false, retryAfterMs: HOUR - 30 })
    expect(w.hit('b', t + 30).ok).toBe(true)
    expect(w.hit('a', t + HOUR).ok).toBe(true)
    expect(w.hit('a', t + HOUR + 1).ok).toBe(false)
  })

  it('sliding window keeps memory bounded', () => {
    const w = new SlidingWindow(1, HOUR, 2)
    w.hit('a', 0)
    w.hit('b', 0)
    w.hit('c', 0)
    // 'a' was evicted, so it has a fresh slot.
    expect(w.hit('a', 1).ok).toBe(true)
    expect(w.hit('c', 1).ok).toBe(false)
  })

  it('daily spend sums per UTC day and resets at midnight', () => {
    const d = new DailySpend(5)
    const day1 = Date.UTC(2026, 9, 29, 10)
    d.add(2.5, day1)
    d.add(2.4, day1 + 1)
    d.add(Number.NaN, day1 + 2)
    d.add(-1, day1 + 3)
    expect(d.spent(day1)).toBeCloseTo(4.9)
    expect(d.exhausted(day1)).toBe(false)
    d.add(0.1, day1 + 4)
    expect(d.exhausted(day1)).toBe(true)
    expect(d.exhausted(Date.UTC(2026, 9, 30, 0, 0, 1))).toBe(false)
  })

  it('limiter: rate per IP, then a global budget that closes the chat for everyone', () => {
    const l = new ChatLimiter({ turnsPerHour: 2, dailyUsd: 1 })
    const t = Date.UTC(2026, 9, 29, 12)
    expect(l.admit('1.1.1.1', t).ok).toBe(true)
    expect(l.admit('1.1.1.1', t).ok).toBe(true)
    expect(l.admit('1.1.1.1', t)).toMatchObject({ ok: false, reason: 'rate' })
    expect(l.admit('2.2.2.2', t).ok).toBe(true)
    l.record(0.6, t)
    l.record(0.5, t)
    expect(l.admit('3.3.3.3', t)).toEqual({ ok: false, reason: 'budget' })
    // A closed day doesn't burn rate slots.
    const next = Date.UTC(2026, 9, 30, 0, 1)
    expect(l.admit('3.3.3.3', next).ok).toBe(true)
  })

  it('reads CHAT_DAILY_USD with a default', () => {
    expect(chatDailyUsd(undefined)).toBe(CHAT_DAILY_USD_DEFAULT)
    expect(chatDailyUsd('')).toBe(CHAT_DAILY_USD_DEFAULT)
    expect(chatDailyUsd('nope')).toBe(CHAT_DAILY_USD_DEFAULT)
    expect(chatDailyUsd('-2')).toBe(CHAT_DAILY_USD_DEFAULT)
    expect(chatDailyUsd('12.5')).toBe(12.5)
    expect(chatDailyUsd('0')).toBe(0)
  })

  it('the client shows the route\'s sentence for a 429 and the calm fallback otherwise', () => {
    const limited = new Error(JSON.stringify({ statusCode: 429, statusMessage: 'You have reached the chat limit for now. Try again in a little while.' }))
    expect(chatErrorMessage(limited)).toBe('You have reached the chat limit for now. Try again in a little while.')
    expect(chatErrorMessage(new Error(JSON.stringify({ statusCode: 500, statusMessage: 'boom', stack: [] })))).toBe('The chat is unavailable right now.')
  })
})
