// Request logging for the public agent API (/llms.txt, /api/v1, /api/mcp): who calls it, with which client, for which
// tools and papers. One row per request, one per tools/call over MCP. Writes are fire-and-forget behind waitUntil so
// Vercel keeps the instance alive for them; a failed write is a console.warn, never a failed or slower response.
// Read with `npm run agent:stats` (server/utils/agentStats.ts).
import { createHash } from 'node:crypto'
import { CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server'
import { useDb } from '../db'
import { agentRequests } from '../db/schema'
import type { AgentSurface } from '../db/schema'

// Nitro's h3 is auto-imported, not a dependency; take its event type from a helper.
type H3Event = Parameters<typeof getQuery>[0]

const UA_CHARS = 300
const CLIENT_CHARS = 80
const REF_CHARS = 64
const DEV_SALT = 'gpe-agent-log-dev'

export type AgentRequestEntry = typeof agentRequests.$inferInsert

/** What a log row needs from the request; requestInfo() reads it off an h3 event. */
export interface AgentRequestInfo { userAgent?: string | null, ip?: string | null, ref?: string | null }

/** The parts of a row the route knows: what was asked and how it went. */
export interface AgentCallFields { surface: AgentSurface, tool?: string | null, paper?: string | null, status: number, ms: number, client?: string | null }

// First match wins, so the specific agents come before the generic Mozilla catch-all (bots send Mozilla too).
const UA_FAMILIES: [RegExp, string][] = [
  [/Claude-User/i, 'Claude-User'],
  [/Claude-SearchBot/i, 'Claude-SearchBot'],
  [/ClaudeBot/i, 'ClaudeBot'],
  [/ChatGPT-User/i, 'ChatGPT-User'],
  [/OAI-SearchBot/i, 'OAI-SearchBot'],
  [/GPTBot/i, 'GPTBot'],
  [/Perplexity-User/i, 'Perplexity-User'],
  [/PerplexityBot/i, 'PerplexityBot'],
  [/Googlebot|Google-Extended|GoogleOther/i, 'Googlebot'],
  [/bingbot/i, 'bingbot'],
  [/^curl\//i, 'curl'],
  [/^Wget\//i, 'wget'],
  [/python-requests/i, 'python-requests'],
  [/python-httpx|aiohttp|Python-urllib|^python/i, 'python'],
  [/^node$|^node[-/]|undici|node-fetch|axios/i, 'node'],
  [/^Bun\//, 'bun'],
  [/Mozilla\/5\.0/, 'browser']
]

/** A normalized client family from a user-agent: Claude-User, ChatGPT-User, curl, python-requests, node, browser, … */
export function classifyUserAgent(ua: string | null | undefined): string {
  const s = ua?.trim()
  if (!s) {
    return 'other'
  }
  return UA_FAMILIES.find(([re]) => re.test(s))?.[1] ?? 'other'
}

/** An MCP client's self-reported identity ("claude-ai/0.1.0"), or null when the message carries none. */
export function mcpClientName(info: unknown): string | null {
  const { name, version } = (info ?? {}) as { name?: unknown, version?: unknown }
  if (typeof name !== 'string' || !name.trim()) {
    return null
  }
  return `${name.trim()}${typeof version === 'string' && version ? `/${version}` : ''}`.slice(0, CLIENT_CHARS)
}

export function hashIp(ip: string | null | undefined, salt = process.env.AGENT_LOG_SALT || DEV_SALT): string | null {
  return ip ? createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32) : null
}

/** A row from the request and the call; never holds the raw IP. */
export function agentEntry(info: AgentRequestInfo, fields: AgentCallFields): AgentRequestEntry {
  const ua = info.userAgent?.trim() || null
  return {
    surface: fields.surface,
    tool: fields.tool ?? null,
    paper: fields.paper ? fields.paper.slice(0, 120) : null,
    status: fields.status,
    ms: Math.max(0, Math.round(fields.ms)),
    client: fields.client || classifyUserAgent(ua),
    userAgent: ua ? ua.slice(0, UA_CHARS) : null,
    ipHash: hashIp(info.ip),
    ref: info.ref ? info.ref.slice(0, REF_CHARS) : null
  }
}

export type AgentLogSink = (entries: AgentRequestEntry[]) => Promise<unknown>

const insertEntries: AgentLogSink = async (entries) => {
  const db = await useDb()
  await db.insert(agentRequests).values(entries)
}
let sink: AgentLogSink = insertEntries

/** Tests swap the database write for a recorder; returns the previous sink. */
export function setAgentLogSink(next: AgentLogSink): AgentLogSink {
  const prev = sink
  sink = next
  return prev
}

/**
 * Fire-and-forget: hands the write to `waitUntil` (when the runtime has one) and swallows every failure. The returned
 * promise never rejects, so a caller already inside a waitUntil can return it instead.
 */
export function recordAgentRequests(entries: AgentRequestEntry[], waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  if (!entries.length) {
    return Promise.resolve()
  }
  const warn = (err: unknown) => console.warn('[agent-log]', (err as Error).message)
  let write: Promise<void>
  try {
    write = sink(entries).then(() => undefined, warn)
  } catch (err) {
    warn(err)
    return Promise.resolve()
  }
  try {
    waitUntil?.(write)
  } catch {
    // No usable waitUntil in this runtime; the write still runs.
  }
  return write
}

/** The `ref` query param, unless it is one of the tool's own arguments (view_figure takes a `ref`). */
export function attributionRef(query: Record<string, unknown>, toolArgs: string[] = []): string | null {
  const raw = Array.isArray(query.ref) ? query.ref[0] : query.ref
  return typeof raw === 'string' && raw && !toolArgs.includes('ref') ? raw : null
}

export function requestInfo(event: H3Event, toolArgs: string[] = []): AgentRequestInfo {
  return {
    userAgent: getRequestHeader(event, 'user-agent'),
    ip: getRequestIP(event, { xForwardedFor: true }),
    ref: attributionRef(getQuery(event), toolArgs)
  }
}

/** Logs calls made by one request. Never throws. */
export function logAgentRequest(event: H3Event, calls: AgentCallFields | AgentCallFields[], toolArgs: string[] = []) {
  try {
    const info = requestInfo(event, toolArgs)
    recordAgentRequests((Array.isArray(calls) ? calls : [calls]).map(c => agentEntry(info, c)), p => event.waitUntil?.(p))
  } catch (err) {
    console.warn('[agent-log]', (err as Error).message)
  }
}

// --- MCP: one entry per tools/call (and per initialize, so connects that never call a tool still show) ---

interface RpcMessage { id?: string | number | null, method?: string, params?: Record<string, unknown> }
interface RpcReply { id?: string | number | null, error?: { code?: number }, result?: { isError?: boolean, content?: { type?: string, text?: string }[] } }

/** The JSON-RPC messages in a body or reply: plain JSON, or the `data:` lines of an SSE reply (legacy clients get one). */
export function parseRpc(text: string): unknown[] {
  const parse = (t: string) => {
    try {
      return JSON.parse(t) as unknown
    } catch {
      return null
    }
  }
  const whole = parse(text)
  if (whole !== null) {
    return Array.isArray(whole) ? whole : [whole]
  }
  return text.split('\n').filter(l => l.startsWith('data:')).map(l => parse(l.slice(5).trim())).filter(m => m !== null)
}

/** Whether a request body has anything mcpCalls() logs, so the route only reads replies it needs. */
export const hasLoggedCalls = (body: unknown[]) => body.some(m => ['tools/call', 'initialize'].includes((m as RpcMessage)?.method ?? ''))

const asList = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as T[]

function replyStatus(reply: RpcReply | undefined, httpStatus: number): number {
  if (httpStatus >= 300) {
    return httpStatus
  }
  if (reply?.error) {
    // INVALID_PARAMS / METHOD_NOT_FOUND / INVALID_REQUEST are the caller's fault; the rest are ours.
    return [-32602, -32601, -32600].includes(reply.error.code ?? 0) ? 400 : 500
  }
  if (reply?.result?.isError) {
    // Same rule as ToolError: "No paper/node/figure …" is a 404, anything else the caller got wrong a 400.
    return reply.result.content?.[0]?.text?.startsWith('No ') ? 404 : 400
  }
  return httpStatus
}

/**
 * The calls worth logging in one MCP POST body, with their status read off the JSON reply. `client` is the MCP
 * client's own name/version: from initialize's clientInfo, or (modern stateless protocol) the clientInfo every request
 * carries in `_meta`. Legacy clients send it only on initialize, so their tool calls fall back to the user-agent.
 */
export function mcpCalls(body: unknown, reply: unknown, httpStatus: number): Omit<AgentCallFields, 'ms'>[] {
  const replies = new Map(asList<RpcReply>(reply).filter(r => r.id !== undefined).map(r => [r.id, r]))
  return asList<RpcMessage>(body).flatMap((m) => {
    const params = m.params ?? {}
    const status = replyStatus(m.id === undefined ? undefined : replies.get(m.id), httpStatus)
    const meta = (params._meta ?? {}) as Record<string, unknown>
    if (m.method === 'tools/call') {
      const args = (params.arguments ?? {}) as { paper?: unknown }
      return [{
        surface: 'mcp' as const,
        tool: typeof params.name === 'string' ? params.name.slice(0, 64) : null,
        paper: typeof args.paper === 'string' ? args.paper : null,
        status,
        client: mcpClientName(meta[CLIENT_INFO_META_KEY])
      }]
    }
    if (m.method === 'initialize') {
      return [{ surface: 'mcp' as const, tool: null, paper: null, status, client: mcpClientName(params.clientInfo) }]
    }
    return []
  })
}
