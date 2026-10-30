import { blobStore } from '../../utils/blobs'

/**
 * Immutable content-addressed bytes (rendered PDFs, figure PNGs). Honors single byte ranges so PDF.js can stream a
 * long paper in chunks and no response has to carry a whole large PDF (Vercel caps function responses at 4.5 MB).
 */
export default defineEventHandler(async (event) => {
  const sha = getRouterParam(event, 'sha') ?? ''
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw createError({ statusCode: 404, statusMessage: 'No such blob' })
  }
  const meta = await blobStore.meta(sha)
  if (!meta) {
    throw createError({ statusCode: 404, statusMessage: 'No such blob' })
  }
  setResponseHeaders(event, {
    'Content-Type': meta.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': `"${sha}"`,
    'Accept-Ranges': 'bytes'
  })
  if (getRequestHeader(event, 'if-none-match') === `"${sha}"`) {
    setResponseStatus(event, 304)
    return null
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(getRequestHeader(event, 'range') ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, meta.size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), meta.size - 1) : meta.size - 1
    if (start >= meta.size || end < start) {
      setResponseHeader(event, 'Content-Range', `bytes */${meta.size}`)
      throw createError({ statusCode: 416, statusMessage: 'Range not satisfiable' })
    }
    const part = await blobStore.range(sha, start, end)
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'Content-Range': `bytes ${start}-${end}/${meta.size}`, 'Content-Length': part!.byteLength })
    return Buffer.from(part!)
  }
  const blob = await blobStore.get(sha)
  setResponseHeader(event, 'Content-Length', blob!.data.byteLength)
  return Buffer.from(blob!.data)
})
