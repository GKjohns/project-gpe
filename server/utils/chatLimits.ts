/**
 * Bounds on the public paper chat (operators are never limited): a per-IP turn rate and a global daily spend ceiling.
 *
 * LIMITATION: the counters live in memory, per function instance. Vercel Fluid reuses instances, so they hold for
 * steady traffic, but concurrent instances each keep their own counts and a cold start resets them; the real
 * ceiling is therefore "about N × the limit" under load. A Vercel Firewall rate-limit rule on /api/papers/*\/chat is
 * the backstop (added separately). No DB table on purpose: the schema is not ours to change right now.
 */

/** Sliding-window counter per key: at most `limit` hits in any `windowMs`. */
export class SlidingWindow {
  private hits = new Map<string, number[]>()

  constructor(readonly limit: number, readonly windowMs: number, private readonly maxKeys = 10_000) {}

  private recent(key: string, now: number) {
    const list = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs)
    if (list.length) {
      this.hits.set(key, list)
    } else {
      this.hits.delete(key)
    }
    return list
  }

  /** Records a hit when under the limit. Returns whether it was allowed and, if not, ms until the next slot. */
  hit(key: string, now = Date.now()): { ok: true } | { ok: false, retryAfterMs: number } {
    const list = this.recent(key, now)
    if (list.length >= this.limit) {
      return { ok: false, retryAfterMs: this.windowMs - (now - list[0]!) }
    }
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      // Bounded memory: drop the oldest key (Map keeps insertion order).
      this.hits.delete(this.hits.keys().next().value!)
    }
    list.push(now)
    this.hits.set(key, list)
    return { ok: true }
  }
}

/** Spend summed per UTC day; resets when the date changes. */
export class DailySpend {
  private day = ''
  private total = 0

  constructor(readonly ceilingUsd: number) {}

  private roll(now: number) {
    const day = new Date(now).toISOString().slice(0, 10)
    if (day !== this.day) {
      this.day = day
      this.total = 0
    }
  }

  add(usd: number, now = Date.now()) {
    this.roll(now)
    if (Number.isFinite(usd) && usd > 0) {
      this.total += usd
    }
  }

  spent(now = Date.now()) {
    this.roll(now)
    return this.total
  }

  exhausted(now = Date.now()) {
    return this.spent(now) >= this.ceilingUsd
  }
}

export type ChatLimitResult = { ok: true } | { ok: false, reason: 'rate' | 'budget', retryAfterMs?: number }

export class ChatLimiter {
  readonly turns: SlidingWindow
  readonly spend: DailySpend

  constructor(opts: { turnsPerHour: number, dailyUsd: number }) {
    this.turns = new SlidingWindow(opts.turnsPerHour, 60 * 60 * 1000)
    this.spend = new DailySpend(opts.dailyUsd)
  }

  /** Call once per public turn, before any model call. The budget is checked first, so a closed day costs no slot. */
  admit(ip: string, now = Date.now()): ChatLimitResult {
    if (this.spend.exhausted(now)) {
      return { ok: false, reason: 'budget' }
    }
    const r = this.turns.hit(ip, now)
    return r.ok ? r : { ok: false, reason: 'rate', retryAfterMs: r.retryAfterMs }
  }

  /** A finished (or aborted) public turn's cost. */
  record(usd: number, now = Date.now()) {
    this.spend.add(usd, now)
  }
}

export const CHAT_TURNS_PER_HOUR = 20
export const CHAT_DAILY_USD_DEFAULT = 5

/** Parses CHAT_DAILY_USD; anything unusable falls back to the default. */
export function chatDailyUsd(raw = process.env.CHAT_DAILY_USD) {
  const n = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : CHAT_DAILY_USD_DEFAULT
}

let limiter: ChatLimiter | undefined
/** This instance's limiter (see the limitation above). */
export function chatLimiter() {
  return limiter ??= new ChatLimiter({ turnsPerHour: CHAT_TURNS_PER_HOUR, dailyUsd: chatDailyUsd() })
}

export const CHAT_RATE_LIMITED = 'You have reached the chat limit for now. Try again in a little while.'
