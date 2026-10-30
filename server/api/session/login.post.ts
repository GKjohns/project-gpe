import { z } from 'zod'
import { SlidingWindow } from '../../utils/chatLimits'
import { authMode, signIn, tokenMatches } from '../../utils/operator'

/** 10 attempts per IP per 15 minutes (in memory, per instance; see chatLimits.ts). */
const attempts = new SlidingWindow(10, 15 * 60 * 1000)

const bodySchema = z.object({ token: z.string().min(1).max(512) })

export default defineEventHandler(async (event) => {
  const mode = authMode()
  if (mode === 'open') {
    return { operator: true }
  }
  if (mode === 'closed') {
    throw createError({ statusCode: 503, statusMessage: 'Operator auth is not configured on this deployment' })
  }
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!attempts.hit(ip).ok) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts; try again later' })
  }
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success || !tokenMatches(parsed.data.token, process.env.OPERATOR_TOKEN!.trim())) {
    throw createError({ statusCode: 401, statusMessage: 'That token is not right' })
  }
  await signIn(event)
  return { operator: true }
})
