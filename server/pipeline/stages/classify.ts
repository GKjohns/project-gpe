import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Skeleton } from '#shared/pipeline'
import { classifySchema } from '#shared/schemas'
import type { ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, bumpProgress, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { rootIds } from '../dag'
import { callObject } from '../llm'
import { mapLimit, statementIds } from '../nodes'
import { checkpoint } from '../runner'
import type { AnnotateOutput } from './annotate'
import type { StageFn } from './stub'

export interface ClassifyOutput { nodes: ProofNode[] }

const CONCURRENCY = 6
const BATCH = 18 // budget/cancel checkpoint between batches
export const MAX_NOVEL = 5
const MIN_CITE_CHARS = 20

const CLASSIFY_INSTRUCTIONS = `You classify one node of a mathematics paper's proof map by where its content comes from. You are given the paper's title and main result, the node (statement in LaTeX, a plain summary, why it is in the paper) and what it uses.

Classes:
- standard: a known result or definition from the literature or textbooks, used as is or in a well-known form. Cite it: name the result and a source (author(s) and year, or a textbook), e.g. "Chernoff bound (Chernoff 1952)", or the paper's own \\cite key when the statement cites one.
- routine: new to this paper in this exact form, but it follows from known results by a standard argument (bookkeeping, a calculation, an adaptation of a known technique, a direct consequence of earlier nodes). Cite what it adapts or follows from, e.g. "standard union bound over the earlier claims".
- novel: one of the paper's genuinely new ideas, the kind its abstract would claim. A paper has few of these (often one to three, rarely more than five); most new lemmas are routine. Cite why nothing prior covers it: what is new compared with the closest known result.
- unknown: you cannot tell from what you were given.

classification_cite: one or two sentences, required for every class except unknown. Do not invent references: when unsure of a source, describe the known result without a year rather than guess one.`

const noveltyCapSchema = z.object({ keep: z.array(z.string()) })

export interface ClassifyContext {
  title: string
  main?: ProofNode
  byId: Map<string, ProofNode>
  numbers: Map<string, string | undefined>
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)} …` : t
}

export function classifyPrompt(n: ProofNode, c: ClassifyContext): string {
  const num = c.numbers.get(n.id)
  const deps = [...new Set([...n.deps_paper, ...n.deps_inferred])].map(id => c.byId.get(id)).filter(Boolean) as ProofNode[]
  const parent = n.parent_id ? c.byId.get(n.parent_id) : undefined
  return [
    `Paper: ${c.title}`,
    c.main && c.main.id !== n.id ? `Main result: ${c.main.name}: ${c.main.statement_plain}` : '',
    '',
    `Node: ${n.id} · ${n.kind}${num ? ` ${num}` : ''}${n.paper_ref.label ? ` · label ${n.paper_ref.label}` : ''} · §${n.paper_ref.section}${n.paper_ref.sectionTitle ? ` ${n.paper_ref.sectionTitle}` : ''}`,
    parent ? `A step inside the proof of ${parent.id} (${parent.name}).` : '',
    `Name: ${n.name}`,
    `Statement (LaTeX): ${oneLine(n.statement_paper, 3000)}`,
    `In plain English: ${n.statement_plain}`,
    `Why it is here: ${n.explanation}`,
    '',
    deps.length ? 'Uses:' : 'Uses: nothing else in the paper.',
    ...deps.slice(0, 20).map(d => `- ${d.id} · ${d.kind} — ${d.name}: ${oneLine(d.statement_plain, 200)}`)
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

/** `novel` must justify itself; a missing cite is not allowed for any class but unknown. Returns what changed. */
export function enforceCites(n: ProofNode): string | null {
  const cite = n.classification_cite?.trim() ?? ''
  if (n.classification === 'novel' && cite.length < MIN_CITE_CHARS) {
    n.classification = 'routine'
    n.classification_cite = cite || 'Downgraded from novel: no justification given.'
    return `${n.id}: novel without a justification → routine`
  }
  if (n.classification !== 'unknown' && !cite) {
    const was = n.classification
    n.classification = 'unknown'
    delete n.classification_cite
    return `${n.id}: ${was} without a cite → unknown`
  }
  if (n.classification === 'unknown' && !cite) {
    delete n.classification_cite
  }
  return null
}

export const classifyStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'classify')
  const reused = await stageOutputs.get<ClassifyOutput>(ctx.runId, 'classify')
  if (reused) {
    await appendEvent(ctx.runId, 'classify', 'info', `classify · reused stage_outputs.classify (${reused.nodes.length} nodes)`)
    return reused.nodes.length
  }
  const annotated = await stageOutputs.get<AnnotateOutput>(ctx.runId, 'annotate')
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!annotated || !skeleton) {
    throw new Error('missing annotate output for this run; re-run from annotate')
  }
  const nodes: ProofNode[] = structuredClone(annotated.nodes)
  const db = await useDb()
  const [paper] = await db.select({ title: papers.title }).from(papers).where(eq(papers.id, ctx.paperId))
  const ids = statementIds(skeleton.statements)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const c: ClassifyContext = {
    title: paper?.title ?? '',
    main: byId.get(rootIds(nodes, skeleton.sections)[0] ?? ''),
    byId,
    numbers: new Map(skeleton.statements.map(s => [ids.get(s.label)!, s.number]))
  }
  const model = PROFILES[ctx.profile].classify
  await patchProgress(ctx.runId, { classified: 0, classify_total: nodes.length })
  await appendEvent(ctx.runId, 'classify', 'info', `classify · ${nodes.length} nodes · ${model}`)

  let failed = 0
  const fixes: string[] = []
  for (let i = 0; i < nodes.length; i += BATCH) {
    await checkpoint(ctx.runId)
    await mapLimit(nodes.slice(i, i + BATCH), CONCURRENCY, async (n) => {
      try {
        const { object } = await callObject({
          model,
          schema: classifySchema,
          instructions: CLASSIFY_INSTRUCTIONS,
          prompt: classifyPrompt(n, c),
          runId: ctx.runId,
          stage: 'classify'
        })
        n.classification = object.classification
        n.classification_cite = object.classification_cite?.trim()
      } catch (err) {
        failed++
        n.classification = 'unknown'
        await appendEvent(ctx.runId, 'classify', 'warn', `classify · ${n.id}: call failed, left unknown: ${(err as Error).message.slice(0, 200)}`)
      }
      const fix = enforceCites(n)
      if (fix) {
        fixes.push(fix)
      }
      await bumpProgress(ctx.runId, 'classified')
    })
  }
  for (const f of fixes) {
    await appendEvent(ctx.runId, 'classify', 'warn', `classify · ${f}`)
  }

  // A paper has few genuinely new ideas; if the per-node calls found more, one paper-level call keeps the central ones.
  let novel = nodes.filter(n => n.classification === 'novel')
  if (novel.length > MAX_NOVEL) {
    const list = novel.map(n => `- ${n.id} · ${n.kind} — ${n.name}: ${n.statement_plain} Novelty: ${n.classification_cite}`).join('\n')
    try {
      const { object } = await callObject({
        model,
        schema: noveltyCapSchema,
        instructions: `You are given the nodes of a mathematics paper that were each judged "novel" in isolation. Keep at most ${MAX_NOVEL}: the paper's central new ideas, the ones its abstract would claim. Return their ids in \`keep\`; the rest will be reclassified as routine (new in form, built from known techniques or from the kept ideas).`,
        prompt: `Paper: ${c.title}\n${c.main ? `Main result: ${c.main.name}: ${c.main.statement_plain}\n` : ''}\nNovel candidates (${novel.length}):\n${list}`,
        runId: ctx.runId,
        stage: 'classify'
      })
      const keep = new Set(object.keep.slice(0, MAX_NOVEL))
      for (const n of novel.filter(n => !keep.has(n.id))) {
        n.classification = 'routine'
        n.classification_cite = `Routine relative to the paper's central ideas (downgraded from novel at the paper level). ${n.classification_cite ?? ''}`.trim()
        await appendEvent(ctx.runId, 'classify', 'info', `classify · ${n.id}: novel → routine (paper-level cap of ${MAX_NOVEL})`)
      }
    } catch (err) {
      await appendEvent(ctx.runId, 'classify', 'warn', `classify · novelty cap call failed, keeping first ${MAX_NOVEL} by document order: ${(err as Error).message.slice(0, 200)}`)
      for (const n of novel.slice(MAX_NOVEL)) {
        n.classification = 'routine'
      }
    }
    novel = nodes.filter(n => n.classification === 'novel')
  }

  const counts = { standard: 0, routine: 0, novel: 0, unknown: 0 }
  nodes.forEach(n => counts[n.classification]++)
  await stageOutputs.put(ctx.runId, 'classify', { nodes } satisfies ClassifyOutput)
  await patchProgress(ctx.runId, { novel: counts.novel, classify_failed: failed, classify_downgraded: fixes.length })
  await appendEvent(ctx.runId, 'classify', 'info',
    `classify · ${counts.standard} standard · ${counts.routine} routine · ${counts.novel} novel (${novel.map(n => n.id).join(', ') || 'none'}) · ${counts.unknown} unknown`,
    { ...counts })
  return nodes.length
}
