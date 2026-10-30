import { asc, eq, sql } from 'drizzle-orm'
import { goldenDiff, goldenDiffCount } from '#shared/corpus'
import type { Outline, RunProgress, Skeleton } from '#shared/pipeline'
import { RUN_STAGES } from '#shared/pipeline'
import type { PaperDigest, PaperFigure, PaperLabel, PaperRender, ProofNode, RunMetrics, RunStage } from '#shared/types'
import { useDb } from '../../db'
import { papers, reviewItems, runEvents, runs, sources } from '../../db/schema'
import { goldenForPaper } from '../../utils/corpus'
import { appendEvent, getRun, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { rootIds } from '../dag'
import { extractLabels } from '../latex/equations'
import type { PaperLabels } from '../latex/equations'
import { statementIds } from '../nodes'
import { blobUrl } from '../../utils/blobs'
import type { ClassifyOutput } from './classify'
import type { FiguresOutput } from './figures'
import { toPaperFigure } from './figures'
import type { RenderOutput } from './render'
import type { StageFn } from './stub'

export interface MetricEvent { stage: string, message: string, data: Record<string, unknown> | null, ts: Date }

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0

/**
 * RunMetrics from this run's progress counters and events. per_stage: ms from '<stage> finished' events
 * (a stage's sub-steps like 'critique:review' count toward it), cost and calls from 'model call' events.
 * A re-run's reused stages show their (tiny) reuse time and no cost: the metrics describe this run.
 */
export function computeMetrics(input: {
  progress: RunProgress
  events: MetricEvent[]
  startedAt: Date
  now: Date
  costUsd: number
  reviewItems: number
  /** Counts read from the data itself; they win over progress counters, which a re-run's reused stages don't repeat. */
  counts?: Pick<RunMetrics, 'statements_in_source' | 'statements_extracted' | 'claims' | 'refs_mechanical' | 'refs_inferred'>
}): RunMetrics {
  const p = input.progress
  const per: RunMetrics['per_stage'] = {}
  const slot = (s: RunStage) => (per[s] ??= { ms: 0, cost_usd: 0, calls: 0 })
  const tokens = { in: 0, out: 0, cached: 0 }
  const stages = new Set<string>(RUN_STAGES)
  let finalizeStart: Date | null = null
  for (const e of input.events) {
    const done = /^(\w+)(?::[\w-]+)? finished$/.exec(e.message)
    if (done && stages.has(done[1]!)) {
      slot(done[1] as RunStage).ms += num(e.data?.ms)
    }
    if (e.message === 'finalize started') {
      finalizeStart = e.ts
    }
    if (e.message.startsWith('model call ') && stages.has(e.stage)) {
      const s = slot(e.stage as RunStage)
      s.cost_usd += num(e.data?.cost_usd)
      s.calls += num(e.data?.calls) || 1 // Method B logs its whole agent as one event with data.calls
      tokens.in += num(e.data?.tokens_in)
      tokens.out += num(e.data?.tokens_out)
      tokens.cached += num(e.data?.tokens_cached)
    }
  }
  if (finalizeStart) {
    slot('finalize').ms = input.now.getTime() - finalizeStart.getTime()
  }
  for (const s of Object.values(per)) {
    s.cost_usd = Math.round(s.cost_usd * 1e6) / 1e6
  }
  return {
    statements_in_source: num(p.statements_in_source),
    statements_extracted: num(p.statements_extracted),
    claims: num(p.claims),
    refs_mechanical: num(p.refs_mechanical) + num(p.claim_refs),
    refs_inferred: num(p.refs_inferred),
    ...input.counts,
    schema_retries: num(p.schema_retries),
    critique_findings: num(p.critique_findings),
    review_items: input.reviewItems,
    calls: num(p.calls),
    tokens_in: tokens.in,
    tokens_out: tokens.out,
    tokens_cached: tokens.cached,
    cost_usd: Math.round(input.costUsd * 1e6) / 1e6,
    wallclock_ms: input.now.getTime() - input.startedAt.getTime(),
    per_stage: per
  }
}

/** Paper-internal friction from the outline's flags, on the node each flag names. Returns how many were added. */
export function flagFriction(nodes: ProofNode[], outline: Outline | null, skeleton: Skeleton): number {
  if (!outline) {
    return 0
  }
  const ids = statementIds(skeleton.statements)
  const byId = new Map(nodes.map(n => [n.id, n]))
  let added = 0
  for (const f of outline.flags) {
    const node = f.label ? byId.get(ids.get(f.label) ?? f.label) : undefined
    if (!node) {
      continue
    }
    if (f.kind === 'ref_to_nonstatement') {
      node.friction.push({ kind: 'unresolved_ref', severity: 'warn', note: f.note })
    } else if (f.kind === 'possible_restatement' || f.kind === 'suspect_span' || f.kind === 'other') {
      node.friction.push({ kind: 'structure_uncertain', severity: 'info', note: f.note })
    } else {
      continue
    }
    added++
  }
  return added
}

/** The reader's part of the digest from the render and figures stage outputs (either may be absent). */
export function readerParts(render: RenderOutput | null, figs: FiguresOutput | null): { render?: PaperRender, figures?: PaperFigure[] } {
  if (!render) {
    return {}
  }
  const out: PaperRender = {
    status: render.status,
    ...(render.engine ? { engine: render.engine } : {}),
    ...(render.pdf ? { pdf_url: blobUrl(render.pdf.sha), pages: render.pdf.pages, ...(render.pdf.pageSize ? { page_size: render.pdf.pageSize } : {}) } : {}),
    synctex: !!render.synctex_sha,
    ...(Object.keys(render.anchors).length ? { anchors: render.anchors } : {}),
    ...(render.error ? { error: render.error.slice(0, 600) } : {}),
    rendered_at: render.rendered_at
  }
  const figures = figs?.figures ?? render.figures.map(f => toPaperFigure(f, null))
  return { render: out, ...(figures.length ? { figures } : {}) }
}

/** Every \label inside a figure resolves to it (so \ref{fig:x} renders "Figure 3"). */
export function figureLabels(labels: Record<string, PaperLabel>, figures: PaperFigure[] | undefined, all: Map<string, string[]>) {
  for (const f of figures ?? []) {
    for (const label of all.get(f.id) ?? (f.label ? [f.label] : [])) {
      labels[label] = { kind: 'figure', target: f.id, ...(f.number ? { number: f.number } : {}) }
    }
  }
}

export function buildDigest(input: {
  paper: { slug: string, title: string, authors: string[], sourceKind: PaperDigest['source']['kind'], sourceRef: string }
  skeleton: Skeleton
  nodes: ProofNode[]
  runId: string
  generatedAt: string
  metrics: RunMetrics
  /** Equations and the \label index (additive); omitted when the sources are gone. */
  refs?: PaperLabels
  /** The rendered paper and its figures (additive); omitted before the paper is rendered. */
  reader?: { render?: PaperRender, figures?: PaperFigure[] }
}): PaperDigest {
  const { paper, skeleton, nodes } = input
  return {
    slug: paper.slug,
    title: paper.title,
    ...(paper.authors.length ? { authors: paper.authors } : {}),
    source: { kind: paper.sourceKind, ref: paper.sourceRef },
    sections: skeleton.sections,
    nodes,
    root_ids: rootIds(nodes, skeleton.sections),
    macros: skeleton.macros,
    ...input.refs,
    ...input.reader,
    generated_at: input.generatedAt,
    run_id: input.runId,
    metrics: input.metrics
  }
}

export const finalizeStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'finalize')
  const classified = await stageOutputs.get<ClassifyOutput>(ctx.runId, 'classify')
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  const outline = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  if (!classified || !skeleton) {
    throw new Error('missing classify output for this run; re-run from classify')
  }
  const nodes: ProofNode[] = structuredClone(classified.nodes)
  const flagged = flagFriction(nodes, outline, skeleton)

  const db = await useDb()
  const run = await getRun(ctx.runId)
  const [paper] = await db.select().from(papers).where(eq(papers.id, ctx.paperId))
  if (!run || !paper) {
    throw new Error('run or paper row is gone')
  }
  const events = await db.select({ stage: runEvents.stage, message: runEvents.message, data: runEvents.data, ts: runEvents.ts })
    .from(runEvents).where(eq(runEvents.runId, ctx.runId)).orderBy(asc(runEvents.id))
  const [items] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewItems).where(eq(reviewItems.runId, ctx.runId))
  const now = new Date()
  const counts = {
    statements_in_source: skeleton.statements.length,
    // Outlined claims are the nodes with a parent; a statement can't have one (digests from before Sprint 8 may carry kind 'claim' on \begin{claim} statements).
    statements_extracted: nodes.filter(n => !n.parent_id).length,
    claims: nodes.filter(n => !!n.parent_id).length,
    refs_mechanical: nodes.reduce((s, n) => s + n.deps_paper.length, 0),
    refs_inferred: nodes.reduce((s, n) => s + n.deps_inferred.length, 0)
  }
  const metrics = computeMetrics({ progress: run.progress, events, startedAt: run.startedAt, now, costUsd: run.costUsd, reviewItems: items?.n ?? 0, counts })
  const golden = goldenForPaper(paper.slug)
  if (golden) {
    metrics.golden_diff = goldenDiff(golden, nodes)
    const d = metrics.golden_diff
    await appendEvent(ctx.runId, 'finalize', goldenDiffCount(d) ? 'warn' : 'info',
      `golden ${golden.slug}: ${goldenDiffCount(d)} diffs (missing ${d.missing.join(', ') || '0'} · extra ${d.extra.join(', ') || '0'} · ${d.dep_mismatches} dep mismatches · ${d.kind_mismatches ?? 0} kind mismatches)`,
      { golden_diff: d })
  }
  // Cross-ref index from the stored sources (not a chunk output), so a finalize-only retry backfills older digests.
  let refs: PaperLabels | undefined
  try {
    const files = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, ctx.paperId))
    refs = files.length ? extractLabels(files, skeleton) : undefined
  } catch (err) {
    await appendEvent(ctx.runId, 'finalize', 'warn', `finalize · equation index skipped: ${(err as Error).message}`)
  }
  const render = await stageOutputs.get<RenderOutput>(ctx.runId, 'render')
  const reader = readerParts(render, await stageOutputs.get<FiguresOutput>(ctx.runId, 'figures'))
  if (refs && render) {
    figureLabels(refs.labels, reader.figures, new Map(render.figures.map(f => [f.id, f.labels])))
  }
  const digest = buildDigest({ paper, skeleton, nodes, runId: ctx.runId, generatedAt: now.toISOString(), metrics, refs, reader })

  await db.update(papers).set({ digest, latestRunId: ctx.runId, updatedAt: now }).where(eq(papers.id, ctx.paperId))
  await db.update(runs).set({ metrics }).where(eq(runs.id, ctx.runId))
  await patchProgress(ctx.runId, { digest_nodes: nodes.length, friction_flags: flagged })
  await appendEvent(ctx.runId, 'finalize', 'info',
    `finalize · digest written: ${nodes.length} nodes, ${digest.sections.length} sections, roots ${digest.root_ids.join(', ') || 'none'} · ${flagged} friction rows from outline flags · $${metrics.cost_usd.toFixed(2)} · ${metrics.calls} calls`,
    { nodes: nodes.length, roots: digest.root_ids, cost_usd: metrics.cost_usd, calls: metrics.calls })
  // runs.status → complete is the runner's job right after this step, so the run page sees the last events.
  return nodes.length
}
