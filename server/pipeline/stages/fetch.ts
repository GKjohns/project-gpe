import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { papers, sources } from '../../db/schema'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { storeSources } from '../../utils/sourceStore'
import { stageOutputs } from '../../utils/stageOutputs'
import { fetchRemoteSource, summarize } from '../sources'
import type { SourceFile, SourceSummary } from '../sources'
import type { StageFn } from './stub'

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`

/** GitHub / arXiv are downloaded here; uploads were stored by POST /api/papers and are only re-read. */
export const fetchStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'fetch')
  const reused = await stageOutputs.get<SourceSummary>(ctx.runId, 'fetch')
  if (reused) {
    await patchProgress(ctx.runId, { files: reused.files.length, bytes: reused.files.reduce((n, f) => n + f.bytes, 0) })
    await appendEvent(ctx.runId, 'fetch', 'info', `fetch · reused ${reused.files.length} files from the parent run`)
    return reused.files.length
  }

  const db = await useDb()
  const [paper] = await db.select().from(papers).where(eq(papers.id, ctx.paperId))
  if (!paper) {
    throw new Error('paper row is gone')
  }

  let files: SourceFile[]
  if (paper.sourceKind === 'upload') {
    files = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, paper.id))
  } else {
    await appendEvent(ctx.runId, 'fetch', 'info', `fetch · ${paper.sourceKind === 'github' ? 'GitHub' : 'arXiv'} ${paper.sourceRef}`)
    files = await fetchRemoteSource(paper.sourceKind, paper.sourceRef)
    // A fresh fetch replaces whatever an earlier run stored; figures' images etc. go to source_assets.
    const assets = await storeSources(paper.id, files)
    if (assets.stored || assets.skipped.length) {
      await appendEvent(ctx.runId, 'fetch', assets.skipped.length ? 'warn' : 'info',
        `fetch · ${assets.stored} assets (${kb(assets.bytes)}) for the renderer${assets.skipped.length ? ` · skipped for size: ${assets.skipped.slice(0, 5).join(', ')}` : ''}`)
    }
    files = files.filter(f => !f.data)
  }

  const summary = summarize(files)
  const bytes = summary.files.reduce((n, f) => n + f.bytes, 0)
  await stageOutputs.put(ctx.runId, 'fetch', summary)
  await patchProgress(ctx.runId, { files: files.length, bytes })
  await appendEvent(ctx.runId, 'fetch', 'info', `fetch · ${files.length} files, ${kb(bytes)} · main: ${summary.mainFile}`, {
    files: summary.files,
    mainFile: summary.mainFile,
    estTokens: summary.estTokens,
    estPages: summary.estPages
  })
  return files.length
}
