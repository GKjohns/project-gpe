// The loaders behind the public agent API (/api/mcp, /api/v1, /llms.txt). Digests and sources are cached per function
// instance for a minute: Fluid reuses instances and an agent's calls come in bursts on one paper; a re-run shows up
// within that minute, and so does flipping a paper's `public` flag.
//
// Only public papers exist here: a private slug is listed nowhere and is the same 404 as a missing one. In dev the toy
// fixture (slug `toy`) counts as public, as it stands in for a digested paper on the library page.
import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import type { PaperDigest } from '#shared/types'
import { useDb } from '../db'
import { papers } from '../db/schema'
import { toyDigest } from '../fixtures/toy-digest'
import { loadChatSources } from './chatSources'
import type { ChatSources } from './chatTools'
import { loadFigureImage } from './digests'
import type { McpDeps, McpPaperRow } from './mcpTools'

const CACHE_MS = 60_000
const CACHE_ENTRIES = 16

function ttlCache<T>() {
  const entries = new Map<string, { at: number, value: Promise<T> }>()
  return (key: string, load: () => Promise<T>) => {
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
}
const digestCache = ttlCache<PaperDigest | null>()
const sourcesCache = ttlCache<ChatSources | null>()

const devToy = (slug: string) => !!import.meta.dev && slug === 'toy'

export async function listPublicPapers(): Promise<McpPaperRow[]> {
  const db = await useDb()
  const visible = import.meta.dev ? or(eq(papers.public, true), eq(papers.slug, 'toy')) : eq(papers.public, true)
  const rows = await db.select({
    slug: papers.slug,
    title: papers.title,
    authors: papers.authors,
    source: papers.sourceRef,
    nodes: sql<number>`jsonb_array_length(${papers.digest}->'nodes')`.mapWith(Number)
  }).from(papers).where(and(isNotNull(papers.digest), visible)).orderBy(desc(papers.createdAt))
  // Dev: the toy fixture stands in as a digested paper, as on the library page.
  if (import.meta.dev && !rows.some(r => r.slug === 'toy')) {
    rows.push({ slug: toyDigest.slug, title: toyDigest.title, authors: toyDigest.authors ?? [], source: toyDigest.source.ref, nodes: toyDigest.nodes.length })
  }
  return rows
}

/** A public paper's digest, or null for one that is missing, undigested or private. */
export async function loadPublicDigest(slug: string): Promise<PaperDigest | null> {
  const db = await useDb()
  const [row] = await db.select({ digest: papers.digest, public: papers.public }).from(papers).where(eq(papers.slug, slug))
  if (row) {
    return row.public || devToy(slug) ? row.digest ?? null : null
  }
  return devToy(slug) ? toyDigest : null
}

export function agentApiDeps(): McpDeps {
  return {
    listPapers: listPublicPapers,
    loadDigest: slug => digestCache(slug, () => loadPublicDigest(slug)),
    loadSources: (slug, digest) => sourcesCache(`${slug}@${digest.run_id}`, () => loadChatSources(slug, digest)),
    loadFigureImage,
    appUrl: useRuntimeConfig().public.appUrl.replace(/\/$/, '')
  }
}
