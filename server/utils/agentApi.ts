// The loaders behind the public agent API (/api/mcp, /api/v1, /llms.txt). Digests and sources are cached per function
// instance for a minute: Fluid reuses instances and an agent's calls come in bursts on one paper; a re-run shows up
// within that minute, and so does flipping a paper's `public` flag.
//
// Only public papers exist here: a private slug is listed nowhere and is the same 404 as a missing one. In dev the toy
// fixture (slug `toy`) counts as public, as it stands in for a digested paper on the library page.
import type { PublicPaperItem } from '#shared/api'
import { familyCode } from '#shared/catalog'
import type { FamilyDigest } from '#shared/catalog'
import { FLAGSHIP } from '#shared/flagship'
import type { PaperDigest } from '#shared/types'
import { buildCatalog, manuscriptEntry } from '../catalog/query'
import type { Catalog } from '../catalog/query'
import { CATALOG_KEY } from '../catalog/sync'
import { toyDigest } from '../fixtures/toy-digest'
import { appUrl } from './appUrl'
import { loadChatSources } from './chatSources'
import type { ChatSources } from './chatTools'
import { loadFigureImage } from './digests'
import type { McpDeps, McpPaperRow } from './mcpTools'
import { isOperator } from './operator'
import { catalogMetaRow, familyRow, manuscriptRow } from './rows'
import type { FamilyRow, ManuscriptRow } from './rows'
import { must, selectAll, useSupabase } from './supabase'

const CACHE_MS = 60_000
const CACHE_ENTRIES = 16

function ttlCache<T>() {
  const entries = new Map<string, { at: number, value: Promise<T> }>()
  const get = (key: string, load: () => Promise<T>) => {
    const hit = entries.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return hit.value
    }
    if (entries.size >= CACHE_ENTRIES) {
      entries.delete(entries.keys().next().value!)
    }
    const value = load()
    // A failed load isn't cached.
    value.catch(() => entries.delete(key))
    entries.set(key, { at: Date.now(), value })
    return value
  }
  return Object.assign(get, { clear: () => entries.clear() })
}
const digestCache = ttlCache<PaperDigest | null>()
const sourcesCache = ttlCache<ChatSources | null>()
const catalogCache = ttlCache<Catalog>()

const devToy = (slug: string) => !!import.meta.dev && slug === 'toy'

/** One paper_digest_stats row (db_migrations/0004): the digest's counts, computed in SQL so no digest is loaded. */
const STATS_COLS = 'slug, title, authors, source_ref, public, manuscript_dir, created_at, updated_at, nodes, sections, novel, friction, pages, headline'

/** Public, digested papers with their catalog family, newest first. The family join is in memory over the cached catalog. */
async function publicDigestRows() {
  let query = useSupabase().from('paper_digest_stats').select(STATS_COLS).eq('has_digest', true)
  if (!import.meta.dev) {
    query = query.eq('public', true)
  }
  const stats = must(await query.order('created_at', { ascending: false }).order('id'))
  // Dev: the toy fixture counts as public (see the header).
  const visible = import.meta.dev ? stats.filter(r => r.public || r.slug === 'toy') : stats
  const catalog = await loadCatalog()
  const manuscriptsByDir = new Map<string, ManuscriptRow>([...catalog.members.values()].flat().map(m => [m.dir, m]))
  const familiesByNumber = new Map<number, FamilyRow>(catalog.families.map(f => [f.number, f]))
  return visible.map((r) => {
    const m = r.manuscript_dir ? manuscriptsByDir.get(r.manuscript_dir) : undefined
    return {
      slug: r.slug!,
      title: r.title!,
      authors: r.authors ?? [],
      source: r.source_ref!,
      dir: r.manuscript_dir,
      updatedAt: new Date(r.updated_at!),
      nodes: r.nodes ?? 0,
      sections: r.sections ?? 0,
      novel: r.novel ?? 0,
      friction: r.friction ?? 0,
      pages: r.pages,
      headline: r.headline,
      pdfFile: m?.pdfFile ?? null,
      hasLean: m?.hasLean ?? null,
      family: (m && familiesByNumber.get(m.familyNumber)) ?? null
    }
  })
}

export async function listPublicPapers(): Promise<McpPaperRow[]> {
  const rows: McpPaperRow[] = (await publicDigestRows()).map(r => ({
    slug: r.slug,
    title: r.title,
    authors: r.authors,
    source: r.source,
    nodes: r.nodes,
    ...(r.family ? { family: { number: r.family.number, code: familyCode(r.family.number), title: r.family.title, discipline: r.family.discipline } } : {}),
    ...(r.dir && r.pdfFile ? { pdf_url: `https://github.com/openai/math/blob/main/preprints/${r.dir}/${r.pdfFile}` } : {}),
    ...(r.family ? { has_lean: !!r.hasLean } : {}),
    ...(r.headline ? { headline: r.headline } : {})
  }))
  // Dev: the toy fixture stands in as a digested paper, as on the library page.
  if (import.meta.dev && !rows.some(r => r.slug === 'toy')) {
    rows.push({ slug: toyDigest.slug, title: toyDigest.title, authors: toyDigest.authors ?? [], source: toyDigest.source.ref, nodes: toyDigest.nodes.length })
  }
  return rows
}

const FLAGSHIP_RANK = new Map(FLAGSHIP.map((f, i) => [f.number, i]))

/** `GET /api/papers`: public digests, flagship families first, then newest. */
export async function listPublicPaperItems(): Promise<PublicPaperItem[]> {
  const rows = await publicDigestRows()
  const rank = (r: (typeof rows)[number]) => r.family ? FLAGSHIP_RANK.get(r.family.number) ?? Infinity : Infinity
  const items: PublicPaperItem[] = [...rows].sort((a, b) => rank(a) - rank(b)).map(r => ({
    slug: r.slug,
    title: r.title,
    authors: r.authors,
    counts: { nodes: r.nodes, sections: r.sections, novel: r.novel, friction: r.friction },
    ...(r.family ? { family: { number: r.family.number, code: familyCode(r.family.number), title: r.family.title, discipline: r.family.discipline, disciplineSlug: r.family.disciplineSlug } } : {}),
    ...(r.pages ? { pages: r.pages } : {}),
    ...(r.family ? { hasLean: !!r.hasLean } : {}),
    ...(r.headline ? { headline: r.headline } : {}),
    updatedAt: r.updatedAt.toISOString()
  }))
  if (import.meta.dev && !rows.some(r => r.slug === 'toy')) {
    const t = toyDigest
    items.push({
      slug: t.slug,
      title: t.title,
      authors: t.authors ?? [],
      counts: { nodes: t.nodes.length, sections: t.sections.length, novel: t.nodes.filter(n => n.classification === 'novel').length, friction: t.nodes.reduce((sum, n) => sum + n.friction.length, 0) },
      updatedAt: t.generated_at
    })
  }
  return items
}

/** The openai/math catalog plus which manuscripts have a public digest, cached like the digests. */
export function loadCatalog(): Promise<Catalog> {
  return catalogCache('catalog', async () => {
    const supa = useSupabase()
    const [familyRows, manuscriptRows, meta, digested] = await Promise.all([
      selectAll((from, to) => supa.from('families').select('*').order('number').range(from, to)),
      selectAll((from, to) => supa.from('manuscripts').select('*').order('dir').range(from, to)),
      supa.from('catalog_meta').select('*').eq('key', CATALOG_KEY).maybeSingle().then(must),
      supa.from('paper_digest_stats').select('slug, manuscript_dir, nodes, sections, novel, friction, pages, headline')
        .eq('public', true).eq('has_digest', true).not('manuscript_dir', 'is', null)
        .order('updated_at').order('id')
        .then(must)
    ])
    // Ascending, so the most recently updated paper per manuscript is the one left in the map.
    const digests = new Map<string, FamilyDigest>(digested.map(d => [d.manuscript_dir!, {
      slug: d.slug!,
      dir: d.manuscript_dir!,
      counts: { nodes: d.nodes ?? 0, sections: d.sections ?? 0, novel: d.novel ?? 0, friction: d.friction ?? 0 },
      ...(d.pages ? { pages: d.pages } : {}),
      ...(d.headline ? { headline: d.headline } : {})
    }]))
    const m = meta ? catalogMetaRow(meta).value : null
    return buildCatalog(familyRows.map(familyRow), manuscriptRows.map(manuscriptRow), digests, m ? { sha: m.sha, syncedAt: m.syncedAt } : null)
  })
}

/** After a sync or a public-flag flip, so this instance serves the change at once (others within the TTL). */
export function invalidateCatalog() {
  catalogCache.clear()
}

/** A public paper's family and manuscript, or null when it digests no catalogued manuscript. */
export async function catalogForSlug(slug: string) {
  const c = await loadCatalog()
  const dir = [...c.digests.values()].find(d => d.slug === slug)?.dir
  return dir ? manuscriptEntry(c, dir) : null
}

/** A public paper's digest, or null for one that is missing, undigested or private. */
export async function loadPublicDigest(slug: string): Promise<PaperDigest | null> {
  const row = must(await useSupabase().from('papers').select('digest, public').eq('slug', slug).maybeSingle())
  if (row) {
    return row.public || devToy(slug) ? (row.digest as unknown as PaperDigest | null) ?? null : null
  }
  return devToy(slug) ? toyDigest : null
}

/**
 * Whether this request may see a paper on the site (page, digest, chat): public, the dev toy, or the operator.
 * Callers answer a hidden paper with the same 404 as a missing one.
 */
export async function canSeePaper(event: Parameters<typeof isOperator>[0], row: { slug: string, public: boolean }) {
  return row.public || devToy(row.slug) || await isOperator(event)
}

export function agentApiDeps(): McpDeps {
  return {
    listPapers: listPublicPapers,
    loadDigest: slug => digestCache(slug, () => loadPublicDigest(slug)),
    loadSources: (slug, digest) => sourcesCache(`${slug}@${digest.run_id}`, () => loadChatSources(slug, digest)),
    loadFigureImage,
    loadCatalogEntry: catalogForSlug,
    appUrl: appUrl()
  }
}
