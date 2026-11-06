// The app's public origin for links the server writes (agent API, llms.txt, the agent callback). A production build that
// still has nuxt.config's localhost default would hand agents dead links, so fall back to Vercel's production host.
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/
let warned = false

export function resolveAppUrl(configured: string | undefined): string {
  const url = (configured || 'http://localhost:3120').replace(/\/$/, '')
  if (process.env.NODE_ENV !== 'production' || !LOCAL.test(url)) {
    return url
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) {
    return `https://${vercel}`
  }
  if (!warned) {
    warned = true
    console.error('[proofmap] NUXT_PUBLIC_APP_URL is still localhost in production and VERCEL_PROJECT_PRODUCTION_URL is unset; links will be wrong')
  }
  return url
}

export const appUrl = () => resolveAppUrl(useRuntimeConfig().public.appUrl)
