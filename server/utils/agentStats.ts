// The operator's readout of agent_requests: counts by day, surface, client, tool, paper and ref, with unique callers
// (distinct ip_hash). Printed by `npm run agent:stats`; there is deliberately no HTTP endpoint for it.
import { must, useSupabase } from './supabase'

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

/** Aggregated in Postgres by RPC agent_request_stats (db_migrations/0004): newest 366 days, top 25 per dimension. */
export async function agentRequestStats(opts: { days?: number } = {}): Promise<AgentStats> {
  const raw = must(await useSupabase().rpc('agent_request_stats', { p_days: opts.days ?? 30 })) as unknown as Omit<AgentStats, 'since'> & { since: string }
  return { ...raw, since: new Date(raw.since) }
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
