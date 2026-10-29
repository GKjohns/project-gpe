import { eq } from 'drizzle-orm'
import type { Outline, Skeleton } from '#shared/pipeline'
import { inferredDepsSchema } from '#shared/schemas'
import type { ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { sources } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { callObject } from '../llm'
import { mapLimit, sliceLines, sourceLines, statementIds, textAfter } from '../nodes'
import type { SourceLines } from '../nodes'
import type { ExtractOutput } from './extract'
import type { StageFn } from './stub'

export interface ResolveOutput { nodes: ProofNode[] }

const CONCURRENCY = 6
const MAX_PROOF_CHARS = 40_000

// A proof that names a result without \ref. The plan's regex, plus "the previous lemma" and appendix pointers.
const TRIGGERS = [
  /(Lemma|Theorem|Proposition|Corollary|Claim|Definition)~?\s*[0-9A-Z][0-9A-Z.]*/,
  /by the (standard|usual) argument|as in Section/i,
  /\b(the|this|that|above|previous|preceding|following|same)\s+(lemma|theorem|proposition|corollary|claim)\b/i,
  /\bAppendix\b/
]
const REF_CMD = /\\[a-zA-Z]*ref\*?\s*\{[^}]*\}/g

/** True when the text mentions a result in prose, after \ref commands are masked out. */
export function mentionsUnreffed(text: string): boolean {
  const masked = text.replace(REF_CMD, '§REF§')
  return TRIGGERS.some(re => re.test(masked))
}

type Index = Map<string, ProofNode>

/** Does `from` reach `to` along dependency edges? A parent depends on its claims (containment counts). */
function reaches(index: Index, children: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) {
      return true
    }
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    const n = index.get(id)
    if (n) {
      stack.push(...n.deps_paper, ...n.deps_inferred, ...(children.get(id) ?? []))
    }
  }
  return false
}

export type AddResult = 'added' | 'self' | 'unknown' | 'duplicate' | 'cycle'

/** Wraps a node list for edge insertion with cycle rejection. Mutates the nodes it was given. */
export function depGraph(nodes: ProofNode[]) {
  const index: Index = new Map(nodes.map(n => [n.id, n]))
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parent_id) {
      children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n.id])
    }
  }
  const check = (from: string, to: string): AddResult | null => {
    const node = index.get(from)
    if (!node || !index.has(to)) {
      return 'unknown'
    }
    if (from === to) {
      return 'self'
    }
    if (node.deps_paper.includes(to) || node.deps_inferred.includes(to)) {
      return 'duplicate'
    }
    return reaches(index, children, to, from) ? 'cycle' : null
  }
  return {
    index,
    children,
    addMechanical(from: string, to: string): AddResult {
      const bad = check(from, to)
      // Mechanical edges are facts of the source: a cycle is kept and reported, never dropped.
      if (bad && bad !== 'cycle') {
        return bad
      }
      index.get(from)!.deps_paper.push(to)
      return bad ?? 'added'
    },
    addInferred(from: string, to: string, note: string): AddResult {
      const bad = check(from, to)
      if (bad) {
        return bad
      }
      const node = index.get(from)!
      node.deps_inferred.push(to)
      node.friction.push({ kind: 'inferred_dep', severity: 'info', note })
      return 'added'
    }
  }
}

/** \ref edges: statement → statement from every ref in its proof; claim → statement from refs inside its span. */
export function addMechanicalEdges(graph: ReturnType<typeof depGraph>, skeleton: Skeleton, outline: Outline) {
  const ids = statementIds(skeleton.statements)
  const result = { statementEdges: 0, claimEdges: 0, cycles: [] as string[] }
  for (const r of skeleton.refs) {
    const from = ids.get(r.fromLabel)
    const to = ids.get(r.toLabel)
    if (!from || !to) {
      continue
    }
    const res = graph.addMechanical(from, to)
    if (res === 'added' || res === 'cycle') {
      result.statementEdges++
    }
    if (res === 'cycle') {
      result.cycles.push(`${from} → ${to}`)
    }
  }
  for (const c of outline.claims) {
    if (!graph.index.has(c.id)) {
      continue
    }
    for (const r of skeleton.refs) {
      const to = ids.get(r.toLabel)
      if (!to || r.fromLabel !== c.parentLabel || r.file !== c.span.file || r.line < c.span.startLine || r.line > c.span.endLine) {
        continue
      }
      // A claim citing its own parent would be circular; the parent already owns the edge.
      if (to === ids.get(c.parentLabel)) {
        continue
      }
      const res = graph.addMechanical(c.id, to)
      if (res === 'added' || res === 'cycle') {
        result.claimEdges++
      }
      if (res === 'cycle') {
        result.cycles.push(`${c.id} → ${to}`)
      }
    }
  }
  return result
}

const labelOf = (n: ProofNode) => n.paper_ref.label ?? n.id

/** One line per candidate the model may pick from. */
function candidateLine(n: ProofNode, numbers: Map<string, string | undefined>): string {
  const num = numbers.get(n.id)
  const first = n.statement_paper.replace(/\s+/g, ' ').slice(0, 140)
  return `- ${n.id} · ${n.kind}${num ? ` ${num}` : ''} · label ${labelOf(n)} · §${n.paper_ref.section}${n.paper_ref.sectionTitle ? ` ${n.paper_ref.sectionTitle}` : ''} · ${n.kind === 'claim' ? n.name : first}`
}

const RESOLVE_INSTRUCTIONS = `You find dependencies that a mathematics paper states in prose without a \\ref.
You are given one statement (or claim) of the paper, the text of its proof, the dependencies already linked by \\ref, and a list of candidate statements with their display numbers and labels.
Return the candidates this text actually uses without a \\ref: cited by number ("Lemma 4.2"), by name ("the sparsification lemma"), by position ("the previous lemma", "as in Section 4"), or by saying where the proof lives ("Appendix A proves the lemma", which makes the lemmas of that appendix dependencies).
Rules: only ids from the candidate list; never an id that is already linked; never the statement itself; no guesses from topic similarity alone. Each reason is one line that quotes or paraphrases the phrase in the text. An empty list is a normal answer.`

export interface ProseJob { node: ProofNode, text: string }

/** Statements whose proof (or, with no proof, the text right after them) names a result in prose. */
export function proseJobs(nodes: ProofNode[], skeleton: Skeleton, src: SourceLines): ProseJob[] {
  const ids = statementIds(skeleton.statements)
  const jobs: ProseJob[] = []
  for (const s of skeleton.statements) {
    const node = nodes.find(n => n.id === ids.get(s.label))
    if (!node) {
      continue
    }
    if (s.proof) {
      const text = sliceLines(src, s.proof.file, s.proof.startLine, s.proof.endLine)
      if (mentionsUnreffed(text)) {
        jobs.push({ node, text: text.slice(0, MAX_PROOF_CHARS) })
      }
    } else {
      const after = textAfter(skeleton, src, s)
      // e.g. "Appendix~\\ref{app:sparsify} proves the lemma" right after a proofless lemma.
      if (/Appendix|proves|proved|proof of/i.test(after)) {
        jobs.push({ node, text: `(No proof environment. Text right after the statement:)\n${after}` })
      }
    }
  }
  return jobs
}

export function prosePrompt(job: ProseJob, nodes: ProofNode[], numbers: Map<string, string | undefined>): string {
  const n = job.node
  const own = new Set(nodes.filter(c => c.parent_id === n.id).map(c => c.id))
  const linked = new Set([...n.deps_paper, ...n.deps_inferred])
  const candidates = nodes.filter(c => c.id !== n.id && !own.has(c.id) && !linked.has(c.id) && c.kind !== 'claim')
  return [
    `Statement: ${n.id} · ${n.kind}${numbers.get(n.id) ? ` ${numbers.get(n.id)}` : ''} · label ${labelOf(n)} · §${n.paper_ref.section}`,
    n.statement_paper.slice(0, 2000),
    '',
    'Its proof:',
    job.text,
    '',
    `Already linked by \\ref: ${[...linked].join(', ') || 'none'}`,
    '',
    'Candidates:',
    ...candidates.map(c => candidateLine(c, numbers))
  ].join('\n')
}

async function loadSourceLines(paperId: string): Promise<SourceLines> {
  const db = await useDb()
  return sourceLines(await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, paperId)))
}

export const resolveStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'resolve')
  const reused = await stageOutputs.get<ResolveOutput>(ctx.runId, 'resolve')
  if (reused) {
    await appendEvent(ctx.runId, 'resolve', 'info', `resolve · reused stage_outputs.resolve (${reused.nodes.length} nodes)`)
    return reused.nodes.length
  }
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  const outline = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  const extracted = await stageOutputs.get<ExtractOutput>(ctx.runId, 'extract')
  if (!skeleton || !outline || !extracted) {
    throw new Error('missing chunk/outline/extract output for this run; re-run from extract')
  }

  const nodes: ProofNode[] = structuredClone(extracted.nodes)
  const graph = depGraph(nodes)
  const ids = statementIds(skeleton.statements)
  const numbers = new Map(skeleton.statements.map(s => [ids.get(s.label)!, s.number]))

  // 1. Mechanical: the \ref graph.
  const mech = addMechanicalEdges(graph, skeleton, outline)
  for (const c of mech.cycles) {
    await appendEvent(ctx.runId, 'resolve', 'warn', `resolve · \\ref cycle kept (a fact of the source): ${c}`)
  }
  await patchProgress(ctx.runId, { refs_mechanical: mech.statementEdges, claim_refs: mech.claimEdges })
  await appendEvent(ctx.runId, 'resolve', 'info',
    `resolve · ${mech.statementEdges} mechanical edges between statements (from ${skeleton.refs.length} \\refs in proofs) + ${mech.claimEdges} from refs inside claim spans`)

  let inferred = 0
  let rejected = 0
  const logInferred = async (from: string, to: string, note: string, source: 'outline' | 'prose') => {
    const res = graph.addInferred(from, to, note)
    if (res === 'added') {
      inferred++
      await appendEvent(ctx.runId, 'resolve', 'info', `resolve · inferred ${from} → ${to} (${source}): ${note}`, { from, to, source })
    } else if (res === 'cycle' || res === 'self') {
      rejected++
      await appendEvent(ctx.runId, 'resolve', 'warn', `resolve · rejected inferred ${from} → ${to} (${res}): ${note}`, { from, to, source, reason: res })
    }
  }

  // 2. Outline: what each claim rests on, beyond the refs inside its span.
  for (const c of outline.claims) {
    for (const t of c.restsOn) {
      const to = ids.get(t) ?? t
      const node = graph.index.get(c.id)
      if (node && !node.deps_paper.includes(to)) {
        await logInferred(c.id, to, `outline: "${c.nameHint}" rests on ${t}`, 'outline')
      }
    }
  }
  const fromOutline = inferred

  // 3. Prose: statements whose proof names a result without \ref.
  const jobs = proseJobs(nodes, skeleton, await loadSourceLines(ctx.paperId))
  await appendEvent(ctx.runId, 'resolve', 'info', `resolve · ${jobs.length} proofs mention a result without \\ref; asking ${PROFILES[ctx.profile].resolve}`)
  const model = PROFILES[ctx.profile].resolve
  let failed = 0
  const answers = await mapLimit(jobs, CONCURRENCY, async (job) => {
    try {
      const { object } = await callObject({
        model,
        schema: inferredDepsSchema,
        instructions: RESOLVE_INSTRUCTIONS,
        prompt: prosePrompt(job, nodes, numbers),
        runId: ctx.runId,
        stage: 'resolve'
      })
      return object.deps
    } catch (err) {
      failed++
      await appendEvent(ctx.runId, 'resolve', 'warn', `resolve · ${job.node.id}: inferred-dep call failed, skipped: ${(err as Error).message.slice(0, 200)}`)
      return []
    }
  })
  // Applied in skeleton order after all calls return, so cycle rejection is deterministic.
  for (const [i, deps] of answers.entries()) {
    const from = jobs[i]!.node.id
    for (const d of deps) {
      const target = graph.index.get(d.id) ?? graph.index.get(ids.get(d.id) ?? '')
      if (!target) {
        await appendEvent(ctx.runId, 'resolve', 'warn', `resolve · ignored unknown id "${d.id}" from ${from}`)
        continue
      }
      await logInferred(from, target.id, d.reason, 'prose')
    }
  }

  await stageOutputs.put(ctx.runId, 'resolve', { nodes } satisfies ResolveOutput)
  await patchProgress(ctx.runId, {
    refs_inferred: inferred,
    inferred_outline: fromOutline,
    inferred_prose: inferred - fromOutline,
    inferred_rejected: rejected,
    resolve_calls: jobs.length,
    resolve_failed: failed
  })
  await appendEvent(ctx.runId, 'resolve', 'info',
    `resolve · ${mech.statementEdges + mech.claimEdges} mechanical + ${inferred} inferred edges (${fromOutline} from the outline, ${inferred - fromOutline} from prose); ${rejected} rejected`,
    { refs_mechanical: mech.statementEdges, claim_refs: mech.claimEdges, refs_inferred: inferred, rejected })
  return nodes.length
}
