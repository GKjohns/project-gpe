/**
 * Method B: the outline as a Claude Agent SDK agent in a Vercel Sandbox.
 *
 * A wait can't live inside a step and every stage is one, so the method is split across steps (see ingest.ts):
 *   outline              outlineAgentStart: boot the sandbox from the snapshot, write the paper + TASK.md, start agent.mjs detached
 *   outline:poll-<i>     pollAgent (quiet): read new trace.jsonl lines into run_events, extend the sandbox timeout
 *   (top level)          waitForEvent('structure/agent.finished') in short slices between polls
 *   outline:collect      outlineAgentCollect: read outline.json + done.json, normalize like Method A, stop the sandbox
 * The HTTP callback (POST /api/runs/:id/events) feeds the same trace ingestion and sets the agent_finished flag;
 * polling stays on as the safety net. Any failure path stops the sandbox (failRun, the dev sweep, collect's finally).
 */
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { Sandbox } from '@vercel/sandbox'
import type { NetworkPolicy } from '@vercel/sandbox'
import type { Outline, Skeleton } from '#shared/pipeline'
import { CLAIM_PROOF_LINES } from '#shared/pipeline'
import { outlineModelSchema } from '#shared/schemas'
import type { z } from 'zod'
import { useDb } from '../../db'
import { runs, sources } from '../../db/schema'
import { PRICES, PROFILES } from '../../utils/aiModels'
import { runnerMode } from '../../utils/dispatch'
import { addCost, appendEvent, bumpProgress, getRun, patchProgress } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import type { RunContext } from '../runner'
import { AGENT_DIR, PAPER_DIR, ensureSnapshot } from '../sandbox/snapshot'
import TASK_TEMPLATE from '../sandbox/TASK.md'
// Nitro dev doesn't watch `raw:` imports: after editing these scripts, touch this file so the bundle picks them up.
import AGENT_MJS from 'raw:../sandbox/agent.mjs'
import VALIDATE_MJS from 'raw:../sandbox/validate_outline.mjs'
import { normalizeOutline, skeletonDigest } from './outline'

/** What the `outline` step returns when it started an agent rather than finishing an outline. */
export const AGENT_PENDING = -1

const MAX_TURNS = 200
const CEILING_MS = 90 * 60 * 1000 // how long the run waits for the agent before collecting whatever exists
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000 // initial VM lifetime; extended while the agent runs, up to the ceiling
const EXTEND_BY_MS = 30 * 60 * 1000
const EXTEND_WHEN_LEFT_MS = 12 * 60 * 1000
const GATEWAY_HOST = 'ai-gateway.vercel.sh'

export interface TraceEntry {
  seq: number
  ts: string
  turn: number
  kind: 'start' | 'tool' | 'text' | 'validate' | 'error' | 'result'
  tool?: string
  summary?: string
  calls: number
  cost_usd: number
  tokens_in: number
  tokens_out: number
}

interface AgentDone {
  subtype: string
  is_error: boolean
  num_turns: number
  calls: number
  total_cost_usd: number
  cost_source: 'sdk' | 'estimate'
  usage: { tokens_in: number, tokens_out: number, tokens_cached: number }
  duration_ms: number
  errors: string[]
  final_text: string
  outline_written: boolean
}

export interface AgentPoll { state: 'running' | 'finished' | 'expired' | 'gone', waitMs: number }

/** 'anthropic/claude-opus-5.5' → 'claude-opus-5-5': the gateway's Claude Code endpoint takes bare ids, and the SDK prices them. */
export function claudeCodeModel(id: string): string {
  return id.replace(/^anthropic\//, '').replace(/\./g, '-')
}

/** The callback is a latency nicety for a public app URL; a sandbox can't reach localhost, so dev polls. */
export function callbackUrl(appUrl: string | undefined, runId: string): string | null {
  if (!appUrl) {
    return null
  }
  try {
    const u = new URL(appUrl)
    const local = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)|\.local$|\.localhost$/.test(u.hostname)
    return local || u.protocol !== 'https:' ? null : `${u.origin}/api/runs/${runId}/events`
  } catch {
    return null
  }
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

async function getSandbox(name: string): Promise<Sandbox | null> {
  try {
    return await Sandbox.get({ name })
  } catch {
    return null
  }
}

async function readText(sb: Sandbox, path: string): Promise<string | null> {
  const buf = await sb.readFileToBuffer({ path })
  return buf ? buf.toString('utf8') : null
}

/** Stops the run's sandbox if one is recorded and not yet stopped. Safe to call from any failure path. */
export async function stopAgentSandbox(runId: string, reason: string): Promise<boolean> {
  const run = await getRun(runId)
  const name = run?.progress.agent_sandbox
  if (typeof name !== 'string' || run?.progress.agent_stopped) {
    return false
  }
  const sb = await getSandbox(name)
  if (sb && ['pending', 'running'].includes(sb.status)) {
    await sb.stop().catch(() => {})
  }
  await patchProgress(runId, { agent_stopped: true })
  await appendEvent(runId, 'outline', 'info', `outline · sandbox ${name} stopped (${reason})`)
  return true
}

/**
 * Appends trace entries not seen yet (the callback and polling can both deliver a line) and moves the agent's
 * running cost into runs.cost_usd, so the runner's budget checkpoint sees it. The seq/cost high-water marks are
 * claimed in one locked update, so two deliveries can't both log a line or both add the same spend.
 */
export async function ingestTrace(runId: string, entries: TraceEntry[]): Promise<number> {
  if (!entries.length) {
    return 0
  }
  const maxSeq = Math.max(...entries.map(e => e.seq))
  const maxCost = Math.max(...entries.map(e => e.cost_usd ?? 0))
  const db = await useDb()
  const res = await db.execute<{ seq: number, cost: string }>(sql`
    update runs set progress = runs.progress || jsonb_build_object(
      'agent_trace_seq', greatest(prev.seq, ${maxSeq}::int),
      'agent_cost_usd', greatest(prev.cost, ${maxCost}::numeric))
    from (
      select coalesce((progress->>'agent_trace_seq')::int, 0) as seq, coalesce((progress->>'agent_cost_usd')::numeric, 0) as cost
      from runs where id = ${runId} for update
    ) prev
    where runs.id = ${runId}
    returning prev.seq as seq, prev.cost as cost`)
  const row = (Array.isArray(res) ? res : (res as unknown as { rows: { seq: number, cost: string }[] }).rows)[0]
  const prevSeq = Number(row?.seq ?? 0)
  const prevCost = Number(row?.cost ?? 0)
  if (maxCost > prevCost) {
    await addCost(runId, maxCost - prevCost)
  }
  const fresh = entries.filter(e => e.seq > prevSeq).sort((a, b) => a.seq - b.seq)
  for (const e of fresh) {
    const what = e.kind === 'tool' ? `${e.tool} ${e.summary ?? ''}` : `${e.kind}${e.summary ? ` · ${e.summary}` : ''}`
    const level = e.kind === 'error' ? 'warn' : 'info'
    await appendEvent(runId, 'outline', level, `agent · turn ${e.turn} · ${what.trim()}`, { trace: true, seq: e.seq, turn: e.turn, kind: e.kind, tool: e.tool ?? null, cost_usd: e.cost_usd })
  }
  const lastTool = [...fresh].reverse().find(e => e.kind === 'tool' || e.kind === 'validate')
  const turn = Math.max(...entries.map(e => e.turn))
  await patchProgress(runId, {
    agent_turn: turn,
    ...(lastTool ? { agent_last_tool: lastTool.kind === 'validate' ? 'validate' : `${lastTool.tool} ${(lastTool.summary ?? '').slice(0, 60)}`.trim() } : {})
  })
  return fresh.length
}

function parseTrace(raw: string | null): TraceEntry[] {
  if (!raw) {
    return []
  }
  const out: TraceEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      out.push(JSON.parse(line) as TraceEntry)
    } catch {
      // A line being written while we read; the next poll gets it whole.
    }
  }
  return out
}

/** Step `outline` (agent branch): boots the sandbox and starts the agent. Returns AGENT_PENDING. */
export async function outlineAgentStart(ctx: RunContext): Promise<number> {
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!skeleton) {
    throw new Error('no skeleton for this run; re-run from chunk')
  }
  // A retried step may have booted a sandbox already; never leave two running.
  await stopAgentSandbox(ctx.runId, 'outline step retried')
  const run = (await getRun(ctx.runId))!
  const db = await useDb()
  const files = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, ctx.paperId))

  const profileModel = PROFILES[ctx.profile].agent
  const model = claudeCodeModel(profileModel)
  const price = PRICES[profileModel] ?? { input: 0, output: 0 }
  // Leave room for extract → classify (≈ $3 on careful for a long paper); the agent gets the rest, up to 60% of the budget.
  const agentBudget = Math.max(0.5, Math.min(ctx.budgetUsd * 0.6, ctx.budgetUsd - run.costUsd - 2))
  const long = skeleton.statements.filter(s => (s.proof?.lines ?? 0) >= CLAIM_PROOF_LINES).length
  const token = randomBytes(24).toString('hex')
  const callback = callbackUrl(process.env.NUXT_PUBLIC_APP_URL, ctx.runId)

  const t0 = Date.now()
  const snapshotId = await ensureSnapshot(msg => appendEvent(ctx.runId, 'outline', 'info', msg))
  const key = process.env.AI_GATEWAY_API_KEY
  if (!key) {
    throw new Error('AI_GATEWAY_API_KEY is not set')
  }
  // Only the gateway (key injected here, never written into the VM) and, when public, the app's own host.
  const allow: Record<string, { transform: { headers: Record<string, string> }[] }[]> = {
    [GATEWAY_HOST]: [{ transform: [{ headers: { authorization: `Bearer ${key}` } }] }]
  }
  if (callback) {
    allow[new URL(callback).host] = []
  }
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false,
    networkPolicy: { allow } as NetworkPolicy,
    tags: { app: 'gpe', run: ctx.runId.slice(0, 8), role: 'outline-agent' }
  })
  const bootMs = Date.now() - t0
  try {
    await patchProgress(ctx.runId, { agent_sandbox: sandbox.name, agent_stopped: false, agent_finished: false })
    const vars = {
      FILES: skeleton.files.map(f => `\`${f.path}\` (${f.lines} lines)`).join(', '),
      MAIN_FILE: skeleton.mainFile,
      LONG_PROOFS: long,
      CLAIM_PROOF_LINES,
      MAX_TURNS,
      BUDGET: agentBudget.toFixed(2)
    }
    await sandbox.writeFiles([
      ...files.map(f => ({ path: `${PAPER_DIR}/src/${f.path}`, content: f.content })),
      { path: `${PAPER_DIR}/skeleton.json`, content: JSON.stringify(skeleton, null, 1) },
      { path: `${PAPER_DIR}/skeleton.md`, content: `# Skeleton\n\n${skeletonDigest(skeleton)}\n` },
      { path: `${PAPER_DIR}/TASK.md`, content: fill(TASK_TEMPLATE, vars) },
      { path: `${PAPER_DIR}/validate_outline.mjs`, content: VALIDATE_MJS },
      { path: `${AGENT_DIR}/agent.mjs`, content: AGENT_MJS }
    ])
    const env: Record<string, string> = {
      AGENT_MODEL: model,
      AGENT_MAX_TURNS: String(MAX_TURNS),
      AGENT_MAX_BUDGET_USD: agentBudget.toFixed(2),
      AGENT_PRICE_IN: String(price.input),
      AGENT_PRICE_OUT: String(price.output),
      CALLBACK_URL: callback ?? '',
      CALLBACK_TOKEN: callback ? token : ''
    }
    // The shell records the exit code, so a crash before done.json is still visible to polling.
    const cmd = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', `node ${AGENT_DIR}/agent.mjs > ${PAPER_DIR}/agent.log 2>&1; echo $? > ${PAPER_DIR}/agent.exit`],
      cwd: AGENT_DIR,
      env,
      detached: true
    })
    const now = Date.now()
    await db.update(runs).set({ agentToken: callback ? token : null }).where(eq(runs.id, ctx.runId))
    await patchProgress(ctx.runId, {
      agent_cmd: cmd.cmdId,
      agent_model: model,
      agent_started_at: now,
      agent_deadline: now + CEILING_MS,
      agent_expires_at: now + SANDBOX_TIMEOUT_MS,
      agent_budget_usd: agentBudget,
      agent_turn: 0,
      agent_transport: callback ? 'callback+polling' : 'polling'
    })
    await appendEvent(ctx.runId, 'outline', 'info',
      `outline · agent sandbox ${sandbox.name} booted in ${(bootMs / 1000).toFixed(1)}s from ${snapshotId}; ${model}, ≤ ${MAX_TURNS} turns, ≤ $${agentBudget.toFixed(2)}, ${long} proofs ≥ ${CLAIM_PROOF_LINES} lines; transport ${callback ? 'callback + polling' : 'polling (app URL not public)'}`,
      { sandbox: sandbox.name, snapshotId, bootMs, model, maxTurns: MAX_TURNS, budget: agentBudget, files: files.length })
  } catch (err) {
    await sandbox.stop().catch(() => {})
    await patchProgress(ctx.runId, { agent_stopped: true })
    throw err
  }
  return AGENT_PENDING
}

/** Step `outline:poll-<i>`: drains new trace lines, keeps the VM alive, says whether to keep waiting. */
export async function pollAgent(ctx: RunContext): Promise<AgentPoll> {
  const waitMs = runnerMode() === 'inngest' ? 60_000 : 10_000
  const run = await getRun(ctx.runId)
  const p = run?.progress ?? {}
  const name = p.agent_sandbox
  if (typeof name !== 'string' || p.agent_stopped) {
    return { state: 'gone', waitMs: 0 }
  }
  const sb = await getSandbox(name)
  if (!sb || !['pending', 'running'].includes(sb.status)) {
    return { state: 'gone', waitMs: 0 }
  }
  await ingestTrace(ctx.runId, parseTrace(await readText(sb, `${PAPER_DIR}/trace.jsonl`)))
  if (p.agent_finished || await readText(sb, `${PAPER_DIR}/agent.exit`) !== null) {
    return { state: 'finished', waitMs: 0 }
  }
  const now = Date.now()
  const deadline = Number(p.agent_deadline ?? 0)
  if (now >= deadline) {
    return { state: 'expired', waitMs: 0 }
  }
  const expires = Number(p.agent_expires_at ?? 0)
  if (expires - now < EXTEND_WHEN_LEFT_MS && expires < deadline + 5 * 60 * 1000) {
    await sb.extendTimeout(EXTEND_BY_MS)
    await patchProgress(ctx.runId, { agent_expires_at: expires + EXTEND_BY_MS })
    await appendEvent(ctx.runId, 'outline', 'info', `outline · sandbox timeout extended by ${EXTEND_BY_MS / 60000} min`)
  }
  return { state: 'running', waitMs: Math.min(waitMs, deadline - now) }
}

type ModelOutline = z.infer<typeof outlineModelSchema>

/** Keeps every claim and flag that parses on its own; one malformed entry doesn't sink a partial outline. */
export function parseAgentOutline(raw: unknown): { outline: ModelOutline, rejected: number } | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const whole = outlineModelSchema.safeParse(raw)
  if (whole.success) {
    return { outline: whole.data, rejected: 0 }
  }
  const r = raw as { claims?: unknown[], flags?: unknown[] }
  const claimSchema = outlineModelSchema.shape.claims.element
  const flagSchema = outlineModelSchema.shape.flags.element
  const claims = (Array.isArray(r.claims) ? r.claims : []).map(c => claimSchema.safeParse(c))
  const flags = (Array.isArray(r.flags) ? r.flags : []).map(f => flagSchema.safeParse(f))
  return {
    outline: { claims: claims.filter(c => c.success).map(c => c.data!), flags: flags.filter(f => f.success).map(f => f.data!) },
    rejected: claims.filter(c => !c.success).length + flags.filter(f => !f.success).length
  }
}

/** Step `outline:collect`: the agent's outline → stage_outputs.outline (normalized as Method A's), then stop the VM. */
export async function outlineAgentCollect(ctx: RunContext, endState: AgentPoll['state']): Promise<number> {
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!skeleton) {
    throw new Error('no skeleton for this run; re-run from chunk')
  }
  const run = (await getRun(ctx.runId))!
  const p = run.progress
  const name = typeof p.agent_sandbox === 'string' ? p.agent_sandbox : null
  let rawOutline: unknown = null
  let done: AgentDone | null = null
  let logTail = ''
  try {
    const sb = name ? await getSandbox(name) : null
    if (sb && ['pending', 'running'].includes(sb.status)) {
      await ingestTrace(ctx.runId, parseTrace(await readText(sb, `${PAPER_DIR}/trace.jsonl`)))
      const o = await readText(sb, `${PAPER_DIR}/outline.json`)
      try {
        rawOutline = o ? JSON.parse(o) : null
      } catch {
        rawOutline = null
      }
      const d = await readText(sb, `${PAPER_DIR}/done.json`)
      done = d ? JSON.parse(d) as AgentDone : null
      if (!done || done.is_error) {
        logTail = (await readText(sb, `${PAPER_DIR}/agent.log`) ?? '').slice(-600)
      }
    }
  } finally {
    await stopAgentSandbox(ctx.runId, 'collected')
  }

  // Spend: the SDK's own total replaces the running estimate.
  const after = (await getRun(ctx.runId))!
  const estimated = Number(after.progress.agent_cost_usd ?? 0)
  const finalCost = done?.total_cost_usd ?? estimated
  if (finalCost !== estimated) {
    await addCost(ctx.runId, finalCost - estimated)
    await patchProgress(ctx.runId, { agent_cost_usd: finalCost })
  }
  const startedAt = Number(p.agent_started_at ?? Date.now())
  const wallclock = done?.duration_ms ?? Date.now() - startedAt
  const turns = done?.num_turns ?? Number(after.progress.agent_turn ?? 0)
  const calls = done?.calls ?? 0
  const model = String(p.agent_model ?? '')
  if (calls) {
    await bumpProgress(ctx.runId, 'calls', calls)
  }
  // One 'model call' event for the whole agent (finalize sums cost/tokens per stage from these), and the agent's
  // wallclock as an 'outline:agent finished' event (finalize's per-stage ms come from '<stage>[:sub] finished').
  await appendEvent(ctx.runId, 'outline', 'info', `model call ${model} (agent, ${calls} calls, ${turns} turns)`, {
    model, calls, turns, tokens_in: done?.usage.tokens_in ?? 0, tokens_out: done?.usage.tokens_out ?? 0,
    tokens_cached: done?.usage.tokens_cached ?? 0, cost_usd: finalCost, cost_source: done?.cost_source ?? 'estimate', ms: wallclock
  })
  await appendEvent(ctx.runId, 'outline', 'info', 'outline:agent finished', { ms: wallclock })

  const parsed = parseAgentOutline(rawOutline)
  const { claims, flags, dropped } = parsed
    ? normalizeOutline(parsed.outline, skeleton)
    : { claims: [] as Outline['claims'], flags: [] as Outline['flags'], dropped: [] as string[] }

  const reasons: string[] = []
  if (endState === 'expired') {
    reasons.push(`the agent ran past the ${CEILING_MS / 60000}-min ceiling`)
  } else if (endState === 'gone' && !done) {
    reasons.push('the sandbox stopped before the agent finished')
  }
  if (done && done.subtype !== 'success') {
    reasons.push(`the agent ended with ${done.subtype}${done.errors.length ? ` (${done.errors.join('; ').slice(0, 200)})` : ''}`)
  }
  if (!done && endState === 'finished') {
    reasons.push(`the agent exited without a result${logTail ? `: ${logTail.split('\n').filter(Boolean).slice(-2).join(' / ')}` : ''}`)
  }
  if (!parsed) {
    reasons.push('no readable outline.json')
  }
  const partial = reasons.length > 0
  if (partial) {
    flags.push({ kind: 'other', note: `structure partial (agent method): ${reasons.join('; ')}; claims are whatever outline.json held` })
  }

  const outline: Outline = {
    method: 'agent',
    claims,
    flags,
    stats: {
      calls,
      tokens_in: done?.usage.tokens_in ?? 0,
      tokens_out: done?.usage.tokens_out ?? 0,
      cost_usd: finalCost,
      wallclock_ms: wallclock,
      turns
    }
  }
  await stageOutputs.put(ctx.runId, 'outline', outline)

  if (parsed?.rejected) {
    await appendEvent(ctx.runId, 'outline', 'warn', `outline · ${parsed.rejected} malformed entries in outline.json skipped`)
  }
  for (const d of dropped) {
    await appendEvent(ctx.runId, 'outline', 'warn', `outline · dropped claim ${d}`)
  }
  for (const f of flags) {
    await appendEvent(ctx.runId, 'outline', f.kind === 'suspect_span' ? 'info' : 'warn', `outline · flag ${f.kind}${f.label ? ` ${f.label}` : ''}: ${f.note}`)
  }
  const parents = new Set(claims.map(c => c.parentLabel)).size
  await patchProgress(ctx.runId, {
    claims: claims.length,
    outline_flags: flags.length,
    outline_cost_usd: finalCost,
    agent_turns: turns,
    agent_calls: calls,
    agent_wallclock_ms: wallclock,
    ...(partial ? { structure_partial: true } : {})
  })
  if (partial) {
    await appendEvent(ctx.runId, 'outline', 'warn', `outline · structure partial: ${reasons.join('; ')}; continuing with ${claims.length} claims`)
  }
  await appendEvent(ctx.runId, 'outline', 'info',
    `outline · agent: ${claims.length} claims in ${parents} proofs, ${flags.length} flags · ${turns} turns · ${calls} calls · $${finalCost.toFixed(2)} · ${Math.round(wallclock / 1000)}s`,
    { claims: claims.length, parents, flags: flags.length, dropped: dropped.length, partial, ...outline.stats })
  return claims.length
}
