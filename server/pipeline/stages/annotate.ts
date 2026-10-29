import { eq } from 'drizzle-orm'
import type { Skeleton } from '#shared/pipeline'
import { annotateSchema } from '#shared/schemas'
import type { ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, bumpProgress, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { CycleError, topoLevels, usedByMap } from '../dag'
import { runGraphLabels } from '../graphLabels'
import { callObject } from '../llm'
import { mapLimit, statementIds } from '../nodes'
import ANNOTATE_INSTRUCTIONS from '../prompts/annotate.md'
import { checkpoint } from '../runner'
import type { CritiqueOutput } from './critique'
import type { StageFn } from './stub'

export interface AnnotateOutput { nodes: ProofNode[] }

const CONCURRENCY = 6
const MAX_STATEMENT_CHARS = 4000
const MAX_DEPS = 20
const MAX_USERS = 12

export interface AnnotateContext {
  title: string
  byId: Map<string, ProofNode>
  usedBy: Map<string, string[]>
  numbers: Map<string, string | undefined>
  sectionTitles: Map<string, string>
}

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)} …[truncated]` : s
const oneLine = (s: string, n: number) => clip(s.replace(/\s+/g, ' ').trim(), n)

function heading(n: ProofNode, c: AnnotateContext) {
  const num = c.numbers.get(n.id)
  return `${n.id} · ${n.kind}${num ? ` ${num}` : ''}${n.paper_ref.label ? ` · label ${n.paper_ref.label}` : ''}`
}

/** One node's prompt: its statement, where it sits, its deps (already explained) and its users (not yet). */
export function annotatePrompt(n: ProofNode, c: AnnotateContext): string {
  const parent = n.parent_id ? c.byId.get(n.parent_id) : undefined
  const deps = [...new Set([...n.deps_paper, ...n.deps_inferred])].map(id => c.byId.get(id)).filter(Boolean) as ProofNode[]
  const claims = [...c.byId.values()].filter(x => x.parent_id === n.id)
  const users = (c.usedBy.get(n.id) ?? []).map(id => c.byId.get(id)).filter(Boolean) as ProofNode[]
  const explained = (d: ProofNode) => `- ${heading(d, c)} — ${d.name}: ${d.statement_plain || '(no summary)'}${d.explanation ? ` Why: ${d.explanation}` : ''}`
  const section = c.sectionTitles.get(n.paper_ref.section)
  return [
    `Paper: ${c.title}`,
    `Node: ${heading(n, c)} · §${n.paper_ref.section}${section ? ` ${section}` : ''}`,
    ...(parent
      ? [`This is an intermediate claim inside the proof of ${heading(parent, c)}${parent.statement_plain ? ` (${parent.name}: ${parent.statement_plain})` : ''}.`, `Parent statement (LaTeX): ${oneLine(parent.statement_paper, 1500)}`, `Outline's working name for the claim: ${n.name}`]
      : []),
    '',
    'Statement (LaTeX):',
    clip(n.statement_paper.trim(), MAX_STATEMENT_CHARS),
    '',
    claims.length ? 'Claims inside its proof (already explained, in order):' : '',
    ...claims.map(explained),
    claims.length ? '' : '',
    deps.length ? 'Uses (already explained):' : 'Uses: nothing in the paper (foundational, or relies only on outside results).',
    ...deps.slice(0, MAX_DEPS).map(explained),
    deps.length > MAX_DEPS ? `- …and ${deps.length - MAX_DEPS} more` : '',
    '',
    users.length ? 'Used by (not yet explained):' : 'Used by: nothing (a top-level result, or a side remark).',
    ...users.slice(0, MAX_USERS).map(u => `- ${heading(u, c)} — ${u.name}: ${oneLine(u.statement_paper, 200)}`),
    users.length > MAX_USERS ? `- …and ${users.length - MAX_USERS} more` : ''
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

export const annotateStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'annotate')
  const reused = await stageOutputs.get<AnnotateOutput>(ctx.runId, 'annotate')
  if (reused) {
    await appendEvent(ctx.runId, 'annotate', 'info', `annotate · reused stage_outputs.annotate (${reused.nodes.length} nodes)`)
    return reused.nodes.length
  }
  const critique = await stageOutputs.get<CritiqueOutput>(ctx.runId, 'critique')
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!critique?.reviewed || !skeleton) {
    throw new Error('missing a reviewed critique output for this run; re-run from critique')
  }
  const nodes: ProofNode[] = structuredClone(critique.nodes)

  let levels: string[][]
  try {
    levels = topoLevels(nodes)
  } catch (err) {
    if (!(err instanceof CycleError)) {
      throw err
    }
    // A \ref cycle is a fact of the source; explain those nodes last rather than fail the run.
    await appendEvent(ctx.runId, 'annotate', 'warn', `annotate · ${err.message}; annotating them together in a final level`)
    levels = topoLevels(nodes, { onCycle: 'flatten' })
  }

  const db = await useDb()
  const [paper] = await db.select({ title: papers.title }).from(papers).where(eq(papers.id, ctx.paperId))
  const ids = statementIds(skeleton.statements)
  const c: AnnotateContext = {
    title: paper?.title ?? '',
    byId: new Map(nodes.map(n => [n.id, n])),
    usedBy: usedByMap(nodes),
    numbers: new Map(skeleton.statements.map(s => [ids.get(s.label)!, s.number])),
    sectionTitles: new Map(skeleton.sections.map(s => [s.id, s.title]))
  }
  const model = PROFILES[ctx.profile].annotate
  await patchProgress(ctx.runId, { annotated: 0, annotate_total: nodes.length, annotate_levels: levels.length })
  await appendEvent(ctx.runId, 'annotate', 'info', `annotate · ${nodes.length} nodes in ${levels.length} dependency levels (deps first, claims before their parent) · ${model}`)

  let failed = 0
  for (const [i, level] of levels.entries()) {
    await checkpoint(ctx.runId)
    await mapLimit(level, CONCURRENCY, async (id) => {
      const n = c.byId.get(id)!
      let lastErr: unknown
      // callObject retries a schema miss itself; this covers a transient gateway error.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { object } = await callObject({
            model,
            schema: annotateSchema,
            instructions: ANNOTATE_INSTRUCTIONS,
            prompt: annotatePrompt(n, c),
            runId: ctx.runId,
            stage: 'annotate'
          })
          n.name = object.name.trim()
          n.statement_plain = object.statement_plain.trim()
          n.explanation = object.explanation.trim()
          await bumpProgress(ctx.runId, 'annotated')
          return
        } catch (err) {
          lastErr = err
        }
      }
      failed++
      n.statement_plain ||= 'Not annotated: the model call failed.'
      n.explanation ||= 'Not annotated: the model call failed.'
      n.friction.push({ kind: 'structure_uncertain', severity: 'warn', note: 'annotate: model call failed; text is a placeholder' })
      await appendEvent(ctx.runId, 'annotate', 'warn', `annotate · ${id}: failed twice, placeholder kept: ${(lastErr as Error).message.slice(0, 200)}`)
    })
    await appendEvent(ctx.runId, 'annotate', 'info', `annotate · level ${i + 1}/${levels.length} done (${level.length} nodes)`)
  }

  // Graph card lines (headline + role) need every node's users and finished text: one pass over the whole paper.
  try {
    const labels = await runGraphLabels(nodes, { title: c.title, model, runId: ctx.runId })
    await appendEvent(ctx.runId, 'annotate', labels.missing.length ? 'warn' : 'info', `annotate · graph labels: ${labels.labeled}/${nodes.length} nodes${labels.missing.length ? ` (missing ${labels.missing.join(', ')}; cards fall back to names)` : ''}`)
  } catch (err) {
    await appendEvent(ctx.runId, 'annotate', 'warn', `annotate · graph labels failed, cards fall back to names: ${(err as Error).message.slice(0, 200)}`)
  }

  await stageOutputs.put(ctx.runId, 'annotate', { nodes } satisfies AnnotateOutput)
  await patchProgress(ctx.runId, { annotate_failed: failed })
  await appendEvent(ctx.runId, 'annotate', 'info', `annotate · ${nodes.length - failed}/${nodes.length} nodes named and explained${failed ? `, ${failed} failed` : ''}`)
  return nodes.length
}
