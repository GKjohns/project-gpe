import { eq } from 'drizzle-orm'
import type { Outline, Skeleton } from '#shared/pipeline'
import { extractClaimSchema } from '#shared/schemas'
import type { ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { sources } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { callObject } from '../llm'
import { envKind, mapLimit, sectionAt, sliceLines, sourceLines, statementIds } from '../nodes'
import type { SourceLines } from '../nodes'
import type { StageFn } from './stub'

export interface ExtractOutput { nodes: ProofNode[] }

const CONCURRENCY = 6
const CONTEXT_LINES = 15
const FALLBACK_CHARS = 1500

const EXTRACT_INSTRUCTIONS = `You extract one intermediate claim from inside a proof in a mathematics paper.
You are given the parent statement, the surrounding proof (line-numbered), and the line span where the claim is established.
Write statement_paper: the claim as a precise mathematical statement in LaTeX, in the paper's own notation and macros, as close to the paper's wording as possible (verbatim when the paper states it outright). State what the span establishes, not how; no proof, no commentary, no "we show that". One to four sentences. kind is always "claim".`

const sectionTitle = (skeleton: Skeleton, id: string) => skeleton.sections.find(s => s.id === id)?.title

/** Every skeleton statement becomes a node directly; no model call. Prose fields are filled by annotate. */
export function statementNodes(skeleton: Skeleton): ProofNode[] {
  const ids = statementIds(skeleton.statements)
  return skeleton.statements.map(s => ({
    id: ids.get(s.label)!,
    name: s.title ?? `${s.env.replace(/\*$/, '').replace(/^./, c => c.toUpperCase())} ${s.number ?? s.label}`,
    kind: envKind(s.env),
    statement_paper: s.body.trim(),
    statement_plain: '',
    explanation: '',
    classification: 'unknown',
    paper_ref: {
      ...(s.label.startsWith('unlabeled-') ? {} : { label: s.label }),
      section: s.sectionId,
      sectionTitle: sectionTitle(skeleton, s.sectionId),
      file: s.file,
      line: s.startLine
    },
    deps_paper: [],
    deps_inferred: [],
    friction: []
  }))
}

/** Context for one claim: the parent statement, the parent proof (or the span's neighborhood), and the span. */
export function claimPrompt(skeleton: Skeleton, src: SourceLines, claim: Outline['claims'][number]): string {
  const parent = skeleton.statements.find(s => s.label === claim.parentLabel)!
  const { file, startLine, endLine } = claim.span
  const p = parent.proof
  const inProof = p && p.file === file && startLine >= p.startLine && endLine <= p.endLine
  // A window around the span, clipped to the proof: enough for notation, cheap enough that a retry from extract stays well under $0.50 on ETH.
  const from = Math.max(inProof ? p.startLine : 1, startLine - CONTEXT_LINES)
  const to = Math.min(inProof ? p.endLine : Number.MAX_SAFE_INTEGER, endLine + CONTEXT_LINES)
  return [
    `Parent statement: ${parent.label} (${parent.env}${parent.number ? ` ${parent.number}` : ''}), section ${parent.sectionId}`,
    parent.body.trim(),
    '',
    `${inProof ? 'From the proof of the parent' : 'Surrounding text'} (${file}, lines ${from}–${to}):`,
    sliceLines(src, file, from, to, true),
    '',
    `Return statement_paper for the claim "${claim.nameHint}", established in lines ${startLine}–${endLine} above.`
  ].join('\n')
}

export function claimNode(skeleton: Skeleton, claim: Outline['claims'][number], parentId: string, statementPaper: string, uncertain?: string): ProofNode {
  const parent = skeleton.statements.find(s => s.label === claim.parentLabel)!
  const section = sectionAt(skeleton, claim.span.file, claim.span.startLine)
  const sectionId = section?.id ?? parent.sectionId
  return {
    id: claim.id,
    name: claim.nameHint || `Claim in ${parent.number ?? parent.label}`,
    kind: 'claim',
    parent_id: parentId,
    statement_paper: statementPaper,
    statement_plain: '',
    explanation: '',
    classification: 'unknown',
    paper_ref: { section: sectionId, sectionTitle: sectionTitle(skeleton, sectionId), file: claim.span.file, line: claim.span.startLine },
    deps_paper: [],
    deps_inferred: [],
    friction: uncertain ? [{ kind: 'structure_uncertain', severity: 'warn', note: uncertain }] : []
  }
}

async function loadSourceLines(paperId: string): Promise<SourceLines> {
  const db = await useDb()
  return sourceLines(await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, paperId)))
}

export const extractStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'extract')
  const reused = await stageOutputs.get<ExtractOutput>(ctx.runId, 'extract')
  if (reused) {
    const claims = reused.nodes.filter(n => n.kind === 'claim' && n.parent_id).length
    await patchProgress(ctx.runId, { statements_extracted: reused.nodes.length - claims, claims })
    await appendEvent(ctx.runId, 'extract', 'info', `extract · reused stage_outputs.extract (${reused.nodes.length} nodes)`)
    return reused.nodes.length
  }

  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  const outline = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  if (!skeleton || !outline) {
    throw new Error(`no ${skeleton ? 'outline' : 'skeleton'} for this run; re-run from ${skeleton ? 'outline' : 'chunk'}`)
  }

  const statements = statementNodes(skeleton)
  await patchProgress(ctx.runId, { statements_in_source: skeleton.statements.length, statements_extracted: statements.length, claims: outline.claims.length, claims_extracted: 0 })
  await appendEvent(ctx.runId, 'extract', 'info', `extract · ${statements.length} statement nodes from the skeleton (no model call); ${outline.claims.length} claims to extract`)

  const ids = statementIds(skeleton.statements)
  const src = outline.claims.length ? await loadSourceLines(ctx.paperId) : new Map()
  const model = PROFILES[ctx.profile].extract
  let done = 0
  let failed = 0
  const claims = await mapLimit(outline.claims, CONCURRENCY, async (claim) => {
    const parentId = ids.get(claim.parentLabel)!
    let node: ProofNode
    try {
      const { object } = await callObject({
        model,
        schema: extractClaimSchema,
        instructions: EXTRACT_INSTRUCTIONS,
        prompt: claimPrompt(skeleton, src, claim),
        runId: ctx.runId,
        stage: 'extract'
      })
      node = claimNode(skeleton, claim, parentId, object.statement_paper.trim())
    } catch (err) {
      // One bad claim shouldn't sink the stage: keep the span text and flag it.
      failed++
      const text = sliceLines(src, claim.span.file, claim.span.startLine, claim.span.endLine).slice(0, FALLBACK_CHARS)
      node = claimNode(skeleton, claim, parentId, text, `claim statement not extracted (${(err as Error).message.slice(0, 120)}); showing the span text`)
      await appendEvent(ctx.runId, 'extract', 'warn', `extract · ${claim.id} failed, kept the span text: ${(err as Error).message.slice(0, 200)}`)
    }
    done++
    await patchProgress(ctx.runId, { claims_extracted: done })
    return node
  })

  const nodes = [...statements, ...claims]
  await stageOutputs.put(ctx.runId, 'extract', { nodes } satisfies ExtractOutput)
  await patchProgress(ctx.runId, { claims: claims.length, claims_extracted: claims.length - failed, extract_failed: failed })
  await appendEvent(ctx.runId, 'extract', 'info',
    `extract · ${nodes.length} nodes: ${statements.length}/${skeleton.statements.length} statements + ${claims.length} claims${failed ? ` (${failed} kept as span text)` : ''}`,
    { statements: statements.length, claims: claims.length, failed })
  return nodes.length
}
