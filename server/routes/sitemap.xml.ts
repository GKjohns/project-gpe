// GET /sitemap.xml — the public pages: landing, catalog, every family page and every public digest's overview. Built
// from the cached catalog (no extra queries); absolute URLs from the app origin.
import { familyCode } from '#shared/catalog'
import { loadCatalog } from '../utils/agentApi'
import { appUrl } from '../utils/appUrl'

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default defineEventHandler(async (event) => {
  const base = appUrl()
  const catalog = await loadCatalog()
  const lastmod = catalog.meta?.syncedAt.slice(0, 10)
  const paths = [
    '/',
    '/papers',
    ...catalog.families.map(f => `/papers/${familyCode(f.number)}`),
    ...[...new Set([...catalog.digests.values()].map(d => d.slug))].map(slug => `/${slug}`)
  ]
  const urls = paths.map(p => `  <url><loc>${escapeXml(base + p)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
})
