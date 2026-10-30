import { eq } from 'drizzle-orm'
import { createPaperSchema } from '#shared/schemas'
import { useDb } from '../db'
import { papers } from '../db/schema'
import { SourceError, sourceRef, summarize } from '../pipeline/sources'
import type { SourceFile } from '../pipeline/sources'
import { filesFromUpload } from '../pipeline/sources/upload'
import { storeSources } from '../utils/sourceStore'
import { startRun } from '../utils/dispatch'
import { appendEvent, createRun } from '../utils/runs'

/**
 * JSON `{ title, slug, source, profile, method, budgetUsd }`, or multipart for uploads:
 * a `payload` field with that JSON plus the files.
 */
export default defineEventHandler(async (event) => {
  let raw: unknown
  let uploaded: SourceFile[] | null = null
  try {
    if ((getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')) {
      const parts = await readMultipartFormData(event) ?? []
      const payload = parts.find(p => p.name === 'payload' && !p.filename)
      raw = payload ? JSON.parse(payload.data.toString('utf8')) : {}
      if ((raw as { source?: { kind?: string } }).source?.kind === 'upload') {
        uploaded = filesFromUpload(parts.filter(p => p.filename))
        summarize(uploaded) // throws if no main file can be picked
      }
    } else {
      raw = await readBody(event)
    }
  } catch (err) {
    if (err instanceof SourceError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw createError({ statusCode: 400, statusMessage: 'Could not read the request body' })
  }

  const parsed = createPaperSchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
  }
  const body = parsed.data
  if (body.source.kind === 'upload' && !uploaded) {
    throw createError({ statusCode: 400, statusMessage: 'Upload sources must be sent as multipart/form-data with the files' })
  }

  let ref: string
  try {
    ref = body.source.kind === 'upload' ? uploaded!.map(f => f.path).join(', ').slice(0, 500) : sourceRef(body.source)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : 'Bad source' })
  }

  const db = await useDb()
  const [taken] = await db.select({ id: papers.id }).from(papers).where(eq(papers.slug, body.slug))
  if (taken) {
    throw createError({ statusCode: 409, statusMessage: `The slug "${body.slug}" is taken` })
  }

  const [paper] = await db.insert(papers).values({
    slug: body.slug,
    title: body.title,
    sourceKind: body.source.kind,
    sourceRef: ref
  }).returning({ id: papers.id })
  const paperId = paper!.id
  if (uploaded) {
    await storeSources(paperId, uploaded)
  }

  const runId = await createRun({ paperId, profile: body.profile, method: body.method, budgetUsd: body.budgetUsd })
  await db.update(papers).set({ latestRunId: runId, updatedAt: new Date() }).where(eq(papers.id, paperId))
  await appendEvent(runId, 'run', 'info', `queued · ${body.source.kind} ${ref} · ${body.profile} · ${body.method} · budget $${body.budgetUsd}`)

  // Inngest when INNGEST_EVENT_KEY is set or outside dev, else LocalRunner in-process (not awaited).
  await startRun(runId, paperId)
  setResponseStatus(event, 201)
  return { paperId, runId, slug: body.slug }
})
