import { asc, eq } from 'drizzle-orm'
import type { CritiqueResult, Outline, RunProgress, Skeleton } from '#shared/pipeline'
import { CLAIM_PROOF_LINES } from '#shared/pipeline'
import { critiqueSchema } from '#shared/schemas'
import type { ReviewItemPayload } from '#shared/runs'
import type { ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { reviewItems, sources } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, getRun, patchProgress, setStage, setStatus } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { hasCycle } from '../dag'
import { callObject } from '../llm'
import { sliceLines, sourceLines, statementIds } from '../nodes'
import CRITIQUE_INSTRUCTIONS from '../prompts/critique.md'
import type { RunContext } from '../runner'
import type { ResolveOutput } from './resolve'
import type { StageFn } from './stub'

export type Fix = CritiqueResult['fixes'][number]

export interface CritiqueOutput {
  nodes: ProofNode[] // after auto-applied fixes (and, once reviewed, accepted ones)
  result: CritiqueResult // what the model returned (plus a forced test item, if any)
  applied: { fix: Fix, message: string, by: 'auto' | 'review' }[]
  skipped: { fix: Fix, message: string }[]
  pending: Fix[] // waiting on a human
  reviewed: boolean // true once nothing is pending; annotate reads `nodes` only then
}

export const AUTO_APPLY = 0.85

// --- applying fixes (pure) ---

const unique = (ids: string[]) => [...new Set(ids)]

/** Applies one fix to a copy of the nodes. Refuses anything that would touch a statement's existence, a \ref edge, or create a cycle. */
export function applyFix(nodes: ProofNode[], fix: Fix): { ok: boolean, message: string, nodes: ProofNode[] } {
  const out: ProofNode[] = structuredClone(nodes)
  const byId = new Map(out.map(n => [n.id, n]))
  const refuse = (message: string) => ({ ok: false, message, nodes })
  const t = fix.target
  const missing = t.find(id => !byId.has(id))
  if (missing) {
    return refuse(`unknown node ${missing}`)
  }
  const isClaim = (id: string) => byId.get(id)?.kind === 'claim'
  const note = `critique: ${fix.note}`
  let message: string

  switch (fix.kind) {
    case 'add_edge': {
      const [from, to] = t
      if (!from || !to || from === to) {
        return refuse('add_edge needs two different nodes')
      }
      const n = byId.get(from)!
      if (n.deps_paper.includes(to) || n.deps_inferred.includes(to)) {
        return refuse(`${from} already uses ${to}`)
      }
      n.deps_inferred.push(to)
      n.friction.push({ kind: 'inferred_dep', severity: 'info', note })
      message = `added ${from} → ${to}`
      break
    }
    case 'remove_edge': {
      const [from, to] = t
      const n = from ? byId.get(from) : undefined
      if (!n || !to) {
        return refuse('remove_edge needs two nodes')
      }
      if (!n.deps_inferred.includes(to)) {
        return refuse(n.deps_paper.includes(to) ? `${from} → ${to} is a \\ref edge (a fact of the source)` : `no edge ${from} → ${to}`)
      }
      n.deps_inferred = n.deps_inferred.filter(d => d !== to)
      const label = byId.get(to)!.paper_ref.label
      n.friction = n.friction.filter(f => !(f.kind === 'inferred_dep' && (f.note.includes(to) || (label && f.note.includes(label)))))
      message = `removed inferred ${from} → ${to}`
      break
    }
    case 'drop': {
      const [id] = t
      if (!id || t.length !== 1 || !isClaim(id)) {
        return refuse('only a single claim can be dropped')
      }
      const gone = byId.get(id)!
      const inherit = unique([...gone.deps_paper, ...gone.deps_inferred])
      for (const n of out) {
        if (n.deps_paper.includes(id) || n.deps_inferred.includes(id)) {
          // Whatever relied on the dropped claim now relies on what the claim relied on.
          n.deps_paper = n.deps_paper.filter(d => d !== id)
          n.deps_inferred = unique([...n.deps_inferred.filter(d => d !== id), ...inherit.filter(d => d !== n.id && !n.deps_paper.includes(d))])
        }
      }
      const parent = gone.parent_id ? byId.get(gone.parent_id) : undefined
      if (parent) {
        for (const d of inherit) {
          if (d !== parent.id && !parent.deps_paper.includes(d) && !parent.deps_inferred.includes(d) && byId.get(d)?.parent_id !== parent.id) {
            parent.deps_inferred.push(d)
          }
        }
      }
      out.splice(out.indexOf(gone), 1)
      message = `dropped ${id}${inherit.length ? ` (its ${inherit.length} deps pass to its users and parent)` : ''}`
      break
    }
    case 'merge': {
      const [keepId, ...others] = t
      if (!keepId || !others.length || !t.every(isClaim)) {
        return refuse('merge needs two or more claims')
      }
      const keep = byId.get(keepId)!
      if (others.some(o => byId.get(o)!.parent_id !== keep.parent_id)) {
        return refuse('merged claims must share a parent')
      }
      const folded = new Set(others)
      for (const o of others) {
        const other = byId.get(o)!
        keep.statement_paper = `${keep.statement_paper}\n\n${other.statement_paper}`
        keep.paper_ref.line = Math.min(keep.paper_ref.line, other.paper_ref.line)
        keep.friction.push(...other.friction)
        keep.deps_paper = unique([...keep.deps_paper, ...other.deps_paper])
        keep.deps_inferred = unique([...keep.deps_inferred, ...other.deps_inferred])
        out.splice(out.indexOf(other), 1)
      }
      for (const n of out) {
        const swap = (ds: string[]) => unique(ds.map(d => folded.has(d) ? keepId : d)).filter(d => d !== n.id)
        n.deps_paper = swap(n.deps_paper)
        n.deps_inferred = swap(n.deps_inferred).filter(d => !n.deps_paper.includes(d))
      }
      message = `merged ${others.join(', ')} into ${keepId}`
      break
    }
    case 'reparent': {
      const [id, parentId] = t
      if (!id || !parentId || !isClaim(id) || isClaim(parentId)) {
        return refuse('reparent needs a claim and a statement')
      }
      const n = byId.get(id)!
      if (n.parent_id === parentId) {
        return refuse(`${id} is already under ${parentId}`)
      }
      n.parent_id = parentId
      n.deps_paper = n.deps_paper.filter(d => d !== parentId)
      n.deps_inferred = n.deps_inferred.filter(d => d !== parentId)
      message = `moved ${id} under ${parentId}`
      break
    }
    case 'split': {
      const [id] = t
      if (!id || !isClaim(id)) {
        return refuse('split needs a claim')
      }
      // Splitting needs new statement text; record it where readers see it and leave the structure alone.
      byId.get(id)!.friction.push({ kind: 'structure_uncertain', severity: 'warn', note })
      message = `split of ${id} recorded as structure_uncertain friction (re-run the outline to apply)`
      break
    }
  }
  if (hasCycle(out) && !hasCycle(nodes)) {
    return refuse('would create a dependency cycle')
  }
  return { ok: true, message, nodes: out }
}

// --- the prompt ---

type Statement = Skeleton['statements'][number]

const span = (s: { file: string, startLine: number, endLine: number }) => `${s.file}:${s.startLine}-${s.endLine}`

/** One line per node: id, kind, label, where it lives, edges. */
export function dagLines(nodes: ProofNode[], skeleton: Skeleton, outline: Outline): string[] {
  const ids = statementIds(skeleton.statements)
  const statementById = new Map<string, Statement>(skeleton.statements.map(s => [ids.get(s.label)!, s]))
  const claimById = new Map(outline.claims.map(c => [c.id, c]))
  return nodes.map((n) => {
    const edges = [
      n.deps_paper.length ? `uses \\ref: ${n.deps_paper.join(', ')}` : '',
      n.deps_inferred.length ? `uses inferred: ${n.deps_inferred.join(', ')}` : ''
    ].filter(Boolean).join(' · ') || 'uses nothing'
    if (n.kind === 'claim') {
      const c = claimById.get(n.id)
      return `- ${n.id} · claim in ${n.parent_id} · ${c ? span(c.span) : `${n.paper_ref.file}:${n.paper_ref.line}`} · "${n.name}" · ${edges}`
    }
    const s = statementById.get(n.id)
    const where = s ? `${span(s)}${s.proof ? `, proof ${span(s.proof)} (${s.proof.lines} lines)` : ', no proof environment'}` : `${n.paper_ref.file}:${n.paper_ref.line}`
    return `- ${n.id} · ${n.kind}${s?.number ? ` ${s.number}` : ''}${n.paper_ref.label ? ` · label ${n.paper_ref.label}` : ''} · §${n.paper_ref.section} · ${where} · ${edges}`
  })
}

/** Cheap structural checks done in code, handed to the model as leads. */
export function automaticChecks(nodes: ProofNode[], skeleton: Skeleton, outline: Outline): string[] {
  const out: string[] = []
  const used = new Set(nodes.flatMap(n => [...n.deps_paper, ...n.deps_inferred]))
  const parents = new Set(nodes.map(n => n.parent_id).filter(Boolean))
  const orphans = nodes.filter(n => n.kind !== 'claim' && n.kind !== 'remark' && !used.has(n.id) && !n.deps_paper.length && !n.deps_inferred.length && !parents.has(n.id))
  if (orphans.length) {
    out.push(`Orphans (no uses, no users, no claims): ${orphans.map(n => n.id).join(', ')}`)
  }
  const byParent = new Map<string, Outline['claims']>()
  for (const c of outline.claims) {
    if (nodes.some(n => n.id === c.id)) {
      byParent.set(c.parentLabel, [...(byParent.get(c.parentLabel) ?? []), c])
    }
  }
  for (const [label, claims] of byParent) {
    const sorted = [...claims].sort((a, b) => a.span.file.localeCompare(b.span.file) || a.span.startLine - b.span.startLine)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!
      const b = sorted[i]!
      if (a.span.file === b.span.file && b.span.startLine <= a.span.endLine) {
        out.push(`Overlapping spans in ${label}: ${a.id} (${span(a.span)}) and ${b.id} (${span(b.span)})`)
      }
    }
    const proof = skeleton.statements.find(s => s.label === label)?.proof
    if (proof && proof.lines >= CLAIM_PROOF_LINES) {
      const covered = new Set<number>()
      for (const c of claims.filter(c => c.span.file === proof.file)) {
        for (let l = c.span.startLine; l <= c.span.endLine; l++) {
          covered.add(l)
        }
      }
      const gaps: string[] = []
      let start: number | null = null
      for (let l = proof.startLine; l <= proof.endLine + 1; l++) {
        const free = l <= proof.endLine && !covered.has(l)
        if (free && start === null) {
          start = l
        } else if (!free && start !== null) {
          if (l - start >= 15) {
            gaps.push(`${start}-${l - 1}`)
          }
          start = null
        }
      }
      if (gaps.length) {
        out.push(`Uncovered stretches of ${label}'s proof (${proof.file}, ≥ 15 lines with no claim): ${gaps.join(', ')}`)
      }
    }
  }
  for (const f of outline.flags) {
    out.push(`Outline flag ${f.kind}${f.label ? ` ${f.label}` : ''}: ${f.note}`)
  }
  return out.length ? out : ['None.']
}

export function critiquePrompt(nodes: ProofNode[], skeleton: Skeleton, outline: Outline, src: ReturnType<typeof sourceLines>): string {
  const files = skeleton.files
    .filter(f => /\.tex$/i.test(f.path))
    .map(f => `### File: ${f.path}\n\n${sliceLines(src, f.path, 1, f.lines, true)}`)
  return [
    '# Full LaTeX source (line-numbered)',
    '',
    ...files,
    '',
    `# DAG (${nodes.length} nodes: ${nodes.filter(n => n.kind !== 'claim').length} statements, ${nodes.filter(n => n.kind === 'claim').length} claims)`,
    '',
    ...dagLines(nodes, skeleton, outline),
    '',
    '# Automatic checks',
    '',
    ...automaticChecks(nodes, skeleton, outline).map(l => `- ${l}`),
    '',
    '# Task',
    '',
    'Critique the DAG against the source and return fixes per the schema.'
  ].join('\n')
}

// --- review items ---

function payloadFor(fix: Fix, nodes: ProofNode[], outline: Outline): ReviewItemPayload {
  const claimSpan = new Map(outline.claims.map(c => [c.id, c.span]))
  return {
    ...fix,
    nodes: fix.target.map((id) => {
      const n = nodes.find(x => x.id === id)
      const s = claimSpan.get(id)
      return {
        id,
        name: n?.name ?? id,
        kind: n?.kind ?? 'unknown',
        ref: s ? span(s) : n ? `${n.paper_ref.file}:${n.paper_ref.line}` : ''
      }
    })
  }
}

/** A test-only low-confidence item, so the review queue can be exercised when the model finds nothing to ask about. */
export function forcedFix(nodes: ProofNode[]): Fix | null {
  const n = nodes.find(x => x.kind === 'claim' && x.deps_inferred.length) ?? nodes.find(x => x.deps_inferred.length)
  if (n) {
    return { kind: 'remove_edge', target: [n.id, n.deps_inferred[0]!], note: `[test item: DIGEST_FORCE_REVIEW] Is the inferred edge ${n.id} → ${n.deps_inferred[0]} supported by the text? Rejecting keeps it.`, confidence: 0.5 }
  }
  const c = nodes.find(x => x.kind === 'claim')
  return c ? { kind: 'split', target: [c.id], note: '[test item: DIGEST_FORCE_REVIEW] Should this claim be split? Rejecting changes nothing.', confidence: 0.5 } : null
}

async function createReviewItems(runId: string, pending: Fix[], nodes: ProofNode[], outline: Outline) {
  if (!pending.length) {
    return
  }
  const db = await useDb()
  // Idempotent: under Inngest a retried critique step must not queue the same questions twice.
  const [existing] = await db.select({ id: reviewItems.id }).from(reviewItems).where(eq(reviewItems.runId, runId)).limit(1)
  if (existing) {
    return
  }
  await db.insert(reviewItems).values(pending.map(fix => ({ runId, kind: fix.kind, payload: payloadFor(fix, nodes, outline) })))
}

async function loadInputs(ctx: RunContext) {
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  const outline = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  const resolved = await stageOutputs.get<ResolveOutput>(ctx.runId, 'resolve')
  if (!skeleton || !outline || !resolved) {
    throw new Error('missing chunk/outline/resolve output for this run; re-run from resolve')
  }
  return { skeleton, outline, nodes: resolved.nodes }
}

const forceReview = (progress: RunProgress) => process.env.DIGEST_FORCE_REVIEW === '1' || progress.force_review === true

/**
 * Step 1: one whole-DAG call, auto-apply confident fixes, queue the rest for review.
 * Returns the number of items waiting on a human; ingestPaper waits for 'review/decided' when it is > 0.
 */
export const critiqueStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'critique')
  const reused = await stageOutputs.get<CritiqueOutput>(ctx.runId, 'critique')
  if (reused?.reviewed) {
    await appendEvent(ctx.runId, 'critique', 'info', `critique · reused stage_outputs.critique (${reused.applied.length} fixes applied)`)
    return 0
  }
  const { skeleton, outline, nodes: resolved } = await loadInputs(ctx)
  if (reused) {
    // Copied from a run that stopped while waiting for review: ask again on this run.
    await createReviewItems(ctx.runId, reused.pending, reused.nodes, outline)
    await setStatus(ctx.runId, 'waiting_review')
    await appendEvent(ctx.runId, 'critique', 'info', `critique · reused stage_outputs.critique; ${reused.pending.length} fixes still need review`)
    return reused.pending.length
  }

  const db = await useDb()
  const src = sourceLines(await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, ctx.paperId)))
  const model = PROFILES[ctx.profile].critique
  await appendEvent(ctx.runId, 'critique', 'info', `critique · whole-DAG call to ${model} (reasoning high) over ${resolved.length} nodes`)
  const t0 = Date.now()
  const { object, usage } = await callObject({
    model,
    schema: critiqueSchema,
    instructions: CRITIQUE_INSTRUCTIONS,
    prompt: critiquePrompt(resolved, skeleton, outline, src),
    reasoning: 'high',
    cache: true,
    runId: ctx.runId,
    stage: 'critique'
  })
  const result: CritiqueResult = { ok: object.ok, fixes: [...object.fixes] }

  let nodes = resolved
  const applied: CritiqueOutput['applied'] = []
  const skipped: CritiqueOutput['skipped'] = []
  const pending: Fix[] = []
  for (const fix of result.fixes) {
    const what = `${fix.kind} [${fix.target.join(', ')}] (${fix.confidence.toFixed(2)})`
    if (fix.confidence < AUTO_APPLY) {
      // Only queue what could be applied; a fix on unknown ids is noise, not a question.
      const probe = applyFix(nodes, fix)
      if (probe.ok || fix.kind === 'split') {
        pending.push(fix)
        await appendEvent(ctx.runId, 'critique', 'info', `critique · for review: ${what}: ${fix.note}`)
      } else {
        skipped.push({ fix, message: probe.message })
        await appendEvent(ctx.runId, 'critique', 'warn', `critique · skipped ${what}: ${probe.message}`)
      }
      continue
    }
    const res = applyFix(nodes, fix)
    if (res.ok) {
      nodes = res.nodes
      applied.push({ fix, message: res.message, by: 'auto' })
      await appendEvent(ctx.runId, 'critique', 'info', `critique · auto-applied ${what}: ${res.message} — ${fix.note}`)
    } else {
      skipped.push({ fix, message: res.message })
      await appendEvent(ctx.runId, 'critique', 'warn', `critique · skipped ${what}: ${res.message}`)
    }
  }

  const run = await getRun(ctx.runId)
  if (!pending.length && run && forceReview(run.progress)) {
    const forced = forcedFix(nodes)
    if (forced) {
      result.fixes.push(forced)
      pending.push(forced)
      await appendEvent(ctx.runId, 'critique', 'warn', `critique · DIGEST_FORCE_REVIEW: added a test review item (${forced.kind} [${forced.target.join(', ')}])`)
    }
  }

  await stageOutputs.put(ctx.runId, 'critique', { nodes, result, applied, skipped, pending, reviewed: !pending.length } satisfies CritiqueOutput)
  await patchProgress(ctx.runId, {
    critique_findings: result.fixes.length,
    critique_applied: applied.length,
    critique_skipped: skipped.length,
    review_items: pending.length
  })
  await appendEvent(ctx.runId, 'critique', 'info',
    `critique · ${result.fixes.length} findings (${result.ok ? 'model says ok' : 'model proposes changes'}): ${applied.length} auto-applied, ${pending.length} for review, ${skipped.length} skipped · $${usage.cost_usd.toFixed(3)} · ${Math.round((Date.now() - t0) / 1000)}s`,
    { findings: result.fixes.length, applied: applied.length, pending: pending.length, skipped: skipped.length })

  if (pending.length) {
    await createReviewItems(ctx.runId, pending, nodes, outline)
    await setStatus(ctx.runId, 'waiting_review')
    await appendEvent(ctx.runId, 'critique', 'info', `critique · waiting for review of ${pending.length} item${pending.length === 1 ? '' : 's'}`)
  }
  return pending.length
}

/** Step 2 (after 'review/decided' or its timeout): apply accepted fixes, discard the rest, resume. */
export async function critiqueReviewStage(ctx: RunContext, decided: boolean): Promise<number> {
  await setStatus(ctx.runId, 'running')
  const out = await stageOutputs.get<CritiqueOutput>(ctx.runId, 'critique')
  if (!out) {
    throw new Error('no critique output to review')
  }
  if (out.reviewed) {
    return out.applied.length
  }
  const db = await useDb()
  const items = await db.select().from(reviewItems).where(eq(reviewItems.runId, ctx.runId)).orderBy(asc(reviewItems.id))
  let nodes = out.nodes
  let accepted = 0
  for (const item of items) {
    const { nodes: _n, ...fix } = item.payload as ReviewItemPayload
    const what = `${fix.kind} [${fix.target.join(', ')}]`
    if (item.decision === 'accept') {
      const res = applyFix(nodes, fix)
      if (res.ok) {
        nodes = res.nodes
        accepted++
        out.applied.push({ fix, message: res.message, by: 'review' })
        await appendEvent(ctx.runId, 'critique', 'info', `critique · accepted in review, applied ${what}: ${res.message}`)
      } else {
        out.skipped.push({ fix, message: res.message })
        await appendEvent(ctx.runId, 'critique', 'warn', `critique · accepted in review but not applicable ${what}: ${res.message}`)
      }
    } else if (item.decision === 'reject') {
      await appendEvent(ctx.runId, 'critique', 'info', `critique · rejected in review, discarded ${what}`)
    } else {
      await appendEvent(ctx.runId, 'critique', 'warn', `critique · ${decided ? 'undecided' : 'review timed out'}, discarded ${what}`)
    }
  }
  await stageOutputs.put(ctx.runId, 'critique', { ...out, nodes, pending: [], reviewed: true } satisfies CritiqueOutput)
  await patchProgress(ctx.runId, { critique_applied: out.applied.length, review_accepted: accepted })
  await appendEvent(ctx.runId, 'critique', 'info', `critique · review done: ${accepted} accepted of ${items.length}; resuming`)
  return accepted
}
