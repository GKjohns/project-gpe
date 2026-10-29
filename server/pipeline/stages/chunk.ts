import { eq } from 'drizzle-orm'
import type { Skeleton } from '#shared/pipeline'
import { CLAIM_PROOF_LINES } from '#shared/pipeline'
import { useDb } from '../../db'
import { sources } from '../../db/schema'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { chunkLatex } from '../latex/chunk'
import type { SourceSummary } from '../sources'
import type { StageFn } from './stub'

/** Counters the run page shows; `sections` is top-level only, matching how a reader counts them. */
export function skeletonCounters(s: Skeleton) {
  return {
    sections: s.sections.filter(x => x.level === 1).length,
    subsections: s.sections.filter(x => x.level > 1).length,
    statements: s.statements.length,
    labeled: s.statements.filter(x => !x.label.startsWith('unlabeled-')).length,
    proofs: s.statements.filter(x => x.proof).length,
    long_proofs: s.statements.filter(x => (x.proof?.lines ?? 0) >= CLAIM_PROOF_LINES).length,
    refs: s.refs.length,
    unresolved: s.unresolved.length,
    macros: Object.keys(s.macros).length
  }
}

const MAX_WARNINGS_LOGGED = 20

export const chunkStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'chunk')
  const reused = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (reused) {
    await patchProgress(ctx.runId, skeletonCounters(reused))
    await appendEvent(ctx.runId, 'chunk', 'info', 'chunk · reused the skeleton from the parent run')
    return reused.statements.length
  }

  const db = await useDb()
  const files = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, ctx.paperId))
  if (!files.length) {
    throw new Error('no sources stored for this paper; re-run from fetch')
  }
  const fetched = await stageOutputs.get<SourceSummary>(ctx.runId, 'fetch')
  const { skeleton, warnings } = chunkLatex(files, { mainFile: fetched?.mainFile })

  for (const w of warnings.slice(0, MAX_WARNINGS_LOGGED)) {
    await appendEvent(ctx.runId, 'chunk', 'warn', `chunk · ${w}`)
  }
  if (warnings.length > MAX_WARNINGS_LOGGED) {
    await appendEvent(ctx.runId, 'chunk', 'warn', `chunk · ${warnings.length - MAX_WARNINGS_LOGGED} more warnings`)
  }

  await stageOutputs.put(ctx.runId, 'chunk', skeleton)
  const c = skeletonCounters(skeleton)
  await patchProgress(ctx.runId, { ...c, chunk_warnings: warnings.length })
  const includes = skeleton.files.filter(f => f.path.endsWith('.tex') && f.path !== skeleton.mainFile).length
  await appendEvent(ctx.runId, 'chunk', 'info',
    `chunk · ${skeleton.mainFile}${includes ? ` + ${includes} \\inputs` : ''} → ${c.sections} sections, ${c.statements} statements (${c.labeled} labeled), ${c.refs} statement refs in proofs, ${c.long_proofs} proofs ≥ ${CLAIM_PROOF_LINES} lines`,
    c)
  return skeleton.statements.length
}
