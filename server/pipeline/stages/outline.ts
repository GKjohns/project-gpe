import { eq } from 'drizzle-orm'
import type { Outline, Skeleton } from '#shared/pipeline'
import { CLAIM_PROOF_LINES } from '#shared/pipeline'
import { outlineModelSchema } from '#shared/schemas'
import type { z } from 'zod'
import { useDb } from '../../db'
import { sources } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { callObject } from '../llm'
import { claimId, sliceLines, sourceLines, statementIds } from '../nodes'
import type { SourceLines } from '../nodes'
import type { SourceFile } from '../sources/main'
import OUTLINE_INSTRUCTIONS from '../prompts/outline.md'
import type { StageFn } from './stub'
import { outlineAgentStart } from './outline-agent'

type ModelOutline = z.infer<typeof outlineModelSchema>

/** The skeleton as the outline model reads it: one line per statement, with proof spans and \ref edges. */
export function skeletonDigest(skeleton: Skeleton): string {
  const refs = new Map<string, Set<string>>()
  for (const r of skeleton.refs) {
    const set = refs.get(r.fromLabel) ?? new Set()
    set.add(r.toLabel)
    refs.set(r.fromLabel, set)
  }
  const files = skeleton.files.map(f => `${f.path} (${f.lines} lines)`).join(', ')
  const sections = skeleton.sections.map(s => `${'  '.repeat(s.level - 1)}- §${s.id} ${s.title} (${s.file}:${s.line})`)
  const statements = skeleton.statements.map((s) => {
    const head = `- ${s.label} · ${s.env}${s.number ? ` ${s.number}` : ''}${s.title ? ` "${s.title}"` : ''} · §${s.sectionId} · ${s.file}:${s.startLine}-${s.endLine}`
    const proof = s.proof
      ? `proof ${s.proof.file}:${s.proof.startLine}-${s.proof.endLine} (${s.proof.lines} lines) · outline: ${s.proof.lines >= CLAIM_PROOF_LINES ? 'yes' : 'no'}`
      : 'proof: none in a proof environment (check whether the text proves it elsewhere)'
    const out = refs.get(s.label)
    return `${head} · ${proof}${out ? ` · refs: ${[...out].join(', ')}` : ''}`
  })
  return [
    `Files: ${files}. Main file: ${skeleton.mainFile}.`,
    '',
    'Sections:',
    ...sections,
    '',
    `Statements (${skeleton.statements.length}):`,
    ...statements
  ].join('\n')
}

export function outlinePrompt(skeleton: Skeleton, src: SourceLines): string {
  const files = skeleton.files
    .filter(f => /\.tex$/i.test(f.path))
    .map(f => `### File: ${f.path}\n\n${sliceLines(src, f.path, 1, f.lines, true)}`)
  return [
    '# Full LaTeX source (line-numbered)',
    '',
    ...files,
    '',
    '# Skeleton',
    '',
    skeletonDigest(skeleton),
    '',
    '# Task',
    '',
    `Outline the major claims of every proof marked "outline: yes" (≥ ${CLAIM_PROOF_LINES} lines), plus statements proved elsewhere or by several proofs as the instructions describe. Return JSON per the schema.`
  ].join('\n')
}

/**
 * Validates the model's outline against the skeleton: known parents, spans inside real files,
 * the 60-line rule, canonical claim ids ('claim-<parent>-<n>'), restsOn pointing at things that exist.
 */
export function normalizeOutline(raw: ModelOutline, skeleton: Skeleton): { claims: Outline['claims'], flags: Outline['flags'], dropped: string[] } {
  const ids = statementIds(skeleton.statements)
  const byLabel = new Map(skeleton.statements.map(s => [s.label, s]))
  const fileLines = new Map(skeleton.files.map(f => [f.path, f.lines]))
  const flags: Outline['flags'] = [...raw.flags]
  const dropped: string[] = []
  const kept: { raw: ModelOutline['claims'][number], id: string }[] = []
  const counters = new Map<string, number>()
  const rename = new Map<string, string>()
  const insideProof = (label: string, span: { file: string, startLine: number, endLine: number }) => {
    const p = byLabel.get(label)?.proof
    return !!p && p.file === span.file && span.startLine >= p.startLine && span.endLine <= p.endLine
  }
  // A parent with claims outside its recorded proof (a second proof, an appendix) is one argument across
  // several places; the 60-line rule then applies to the whole, not the short first proof alone.
  const spansElsewhere = new Set(raw.claims.filter(c => byLabel.has(c.parentLabel) && !insideProof(c.parentLabel, c.span)).map(c => c.parentLabel))

  for (const c of raw.claims) {
    const parent = byLabel.get(c.parentLabel)
    if (!parent) {
      dropped.push(`${c.id}: unknown parent ${c.parentLabel}`)
      continue
    }
    const lines = fileLines.get(c.span.file)
    if (!lines) {
      dropped.push(`${c.id}: unknown file ${c.span.file}`)
      continue
    }
    let { startLine, endLine } = c.span
    if (startLine > endLine) {
      [startLine, endLine] = [endLine, startLine]
    }
    startLine = Math.max(1, Math.min(startLine, lines))
    endLine = Math.max(startLine, Math.min(endLine, lines))
    const p = parent.proof
    const inside = insideProof(c.parentLabel, { file: c.span.file, startLine, endLine })
    // 60-line rule: a short recorded proof gets no claims, unless the argument continues elsewhere.
    if (p && inside && p.lines < CLAIM_PROOF_LINES && !spansElsewhere.has(c.parentLabel)) {
      dropped.push(`${c.id}: ${c.parentLabel}'s proof is ${p.lines} lines (< ${CLAIM_PROOF_LINES})`)
      continue
    }
    if (p && !inside) {
      flags.push({ kind: 'suspect_span', label: c.parentLabel, note: `claim "${c.nameHint}" (${c.span.file}:${startLine}-${endLine}) lies outside the recorded proof; a second proof or an appendix` })
    }
    const parentId = ids.get(parent.label)!
    const n = (counters.get(parentId) ?? 0) + 1
    counters.set(parentId, n)
    const id = claimId(parentId, n)
    if (!rename.has(c.id)) {
      rename.set(c.id, id)
    }
    kept.push({ raw: { ...c, span: { file: c.span.file, startLine, endLine } }, id })
  }

  const claims: Outline['claims'] = kept.map(({ raw: c, id }) => {
    const restsOn: string[] = []
    for (const t of c.restsOn) {
      const target = byLabel.has(t) ? t : rename.get(t)
      if (!target || target === id || target === c.parentLabel || restsOn.includes(target)) {
        continue
      }
      restsOn.push(target)
    }
    return {
      id,
      parentLabel: c.parentLabel,
      nameHint: c.nameHint.trim(),
      span: c.span,
      restsOn,
      confidence: Math.max(0, Math.min(1, c.confidence))
    }
  })
  return { claims, flags, dropped }
}

async function loadSources(paperId: string): Promise<SourceFile[]> {
  const db = await useDb()
  return db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, paperId))
}

/** Method A: one whole-paper call. */
const outlinePipeline: StageFn = async (ctx) => {
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!skeleton) {
    throw new Error('no skeleton for this run; re-run from chunk')
  }
  const src = sourceLines(await loadSources(ctx.paperId))
  const model = PROFILES[ctx.profile].outline
  const long = skeleton.statements.filter(s => (s.proof?.lines ?? 0) >= CLAIM_PROOF_LINES).length
  await appendEvent(ctx.runId, 'outline', 'info', `outline · whole-paper call to ${model} (reasoning high) over ${long} proofs ≥ ${CLAIM_PROOF_LINES} lines`)

  const t0 = Date.now()
  const { object, usage } = await callObject({
    model,
    schema: outlineModelSchema,
    instructions: OUTLINE_INSTRUCTIONS,
    prompt: outlinePrompt(skeleton, src),
    reasoning: 'high',
    runId: ctx.runId,
    stage: 'outline'
  })
  const { claims, flags, dropped } = normalizeOutline(object, skeleton)
  const outline: Outline = {
    method: 'pipeline',
    claims,
    flags,
    stats: {
      calls: usage.retried ? 2 : 1,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      cost_usd: usage.cost_usd,
      wallclock_ms: Date.now() - t0
    }
  }
  await stageOutputs.put(ctx.runId, 'outline', outline)

  for (const d of dropped) {
    await appendEvent(ctx.runId, 'outline', 'warn', `outline · dropped claim ${d}`)
  }
  for (const f of flags) {
    await appendEvent(ctx.runId, 'outline', f.kind === 'suspect_span' ? 'info' : 'warn', `outline · flag ${f.kind}${f.label ? ` ${f.label}` : ''}: ${f.note}`)
  }
  const parents = new Set(claims.map(c => c.parentLabel)).size
  await patchProgress(ctx.runId, { claims: claims.length, outline_flags: flags.length, outline_cost_usd: usage.cost_usd })
  await appendEvent(ctx.runId, 'outline', 'info',
    `outline · ${claims.length} claims in ${parents} proofs, ${flags.length} flags · ${usage.tokens_in} in / ${usage.tokens_out} out · $${usage.cost_usd.toFixed(3)} · ${Math.round(outline.stats.wallclock_ms / 1000)}s`,
    { claims: claims.length, parents, flags: flags.length, dropped: dropped.length, ...outline.stats })
  return claims.length
}

export const outlineStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'outline')
  const reused = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  if (reused) {
    await patchProgress(ctx.runId, { claims: reused.claims.length, outline_flags: reused.flags.length })
    await appendEvent(ctx.runId, 'outline', 'info', `outline · reused stage_outputs.outline (${reused.claims.length} claims, ${reused.method})`)
    return reused.claims.length
  }
  // Method B boots the sandbox and returns AGENT_PENDING; ingestPaper then waits and runs 'outline:collect'.
  if (ctx.method === 'agent') {
    return outlineAgentStart(ctx)
  }
  return outlinePipeline(ctx)
}
