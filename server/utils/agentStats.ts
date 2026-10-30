// The operator's readout of agent_requests: counts by day, surface, client, tool, paper and ref, with unique callers
// (distinct ip_hash). Printed by `npm run agent:stats`; there is deliberately no HTTP endpoint for it.
import { desc, gte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../db'
import { agentRequests } from '../db/schema'

export interface AgentStatRow { key: string, requests: number, callers: number, errors: number }

export interface AgentStats {
  since: Date
  total: AgentStatRow
  byDay: AgentStatRow[]
  bySurface: AgentStatRow[]
  byClient: AgentStatRow[]
  byTool: AgentStatRow[]
  byPaper: AgentStatRow[]
  byRef: AgentStatRow[]
}

const DIMENSION_ROWS = 25

export async function agentRequestStats(db: Db, opts: { days?: number } = {}): Promise<AgentStats> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000)
  const where = gte(agentRequests.at, since)
  const counts = {
    requests: sql<number>`count(*)`.mapWith(Number),
    callers: sql<number>`count(distinct ${agentRequests.ipHash})`.mapWith(Number),
    errors: sql<number>`count(*) filter (where ${agentRequests.status} >= 400)`.mapWith(Number)
  }
  const by = async (key: SQL, order: 'key' | 'requests' = 'requests') => {
    const rows = await db.select({ key: sql<string>`coalesce(${key}, '—')`, ...counts }).from(agentRequests).where(where)
      .groupBy(sql`1`).orderBy(order === 'key' ? desc(sql`1`) : desc(sql`2`)).limit(order === 'key' ? 366 : DIMENSION_ROWS)
    return rows.map(r => ({ ...r, key: String(r.key) }))
  }
  const [total] = await db.select({ ...counts }).from(agentRequests).where(where)
  return {
    since,
    total: { key: 'total', ...(total ?? { requests: 0, callers: 0, errors: 0 }) },
    byDay: await by(sql`to_char(${agentRequests.at} at time zone 'UTC', 'YYYY-MM-DD')`, 'key'),
    bySurface: await by(sql`${agentRequests.surface}`),
    byClient: await by(sql`${agentRequests.client}`),
    byTool: await by(sql`${agentRequests.tool}`),
    byPaper: await by(sql`${agentRequests.paper}`),
    byRef: await by(sql`${agentRequests.ref}`)
  }
}

/** Plain-text tables, one per dimension. */
export function formatAgentStats(stats: AgentStats): string {
  const table = (title: string, rows: AgentStatRow[]) => {
    if (!rows.length) {
      return `${title}\n  (none)`
    }
    const width = Math.max(title.length, ...rows.map(r => r.key.length))
    const line = (k: string, a: string | number, b: string | number, c: string | number) =>
      `  ${k.padEnd(width)}  ${String(a).padStart(8)}  ${String(b).padStart(8)}  ${String(c).padStart(7)}`
    return [title, line('', 'requests', 'callers', 'errors'), ...rows.map(r => line(r.key, r.requests, r.callers, r.errors))].join('\n')
  }
  const { total } = stats
  return [
    `Agent API since ${stats.since.toISOString().slice(0, 10)}: ${total.requests} requests, ${total.callers} unique callers, ${total.errors} errors`,
    table('day (UTC)', stats.byDay),
    table('surface', stats.bySurface),
    table('client', stats.byClient),
    table('tool', stats.byTool),
    table('paper', stats.byPaper),
    table('ref', stats.byRef)
  ].join('\n\n')
}
