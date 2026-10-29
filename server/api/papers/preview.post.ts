import { z } from 'zod'
import { paperSourceSchema } from '#shared/schemas'
import { fetchRemoteSource, SourceError, sourceRef, summarize } from '../../pipeline/sources'
import { defaultMethodFor, defaultProfileFor } from '../../utils/aiModels'

const bodySchema = z.object({ source: paperSourceSchema })

/** `{ source }` → `{ files, mainFile, estTokens, estPages, defaultProfile, defaultMethod }`. Uploads are summarized in the browser instead. */
export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { source: { kind, url | id } }' })
  }
  const { source } = parsed.data
  if (source.kind === 'upload') {
    throw createError({ statusCode: 400, statusMessage: 'Uploads are previewed in the browser' })
  }
  try {
    const files = await fetchRemoteSource(source.kind, sourceRef(source))
    const summary = summarize(files)
    return { ...summary, defaultProfile: defaultProfileFor(summary.estTokens, summary.estPages), defaultMethod: defaultMethodFor(summary.estTokens) }
  } catch (err) {
    if (err instanceof SourceError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
