// The loaders behind the public agent API (/api/mcp, /api/v1, /llms.txt). Digests and sources are cached per function
// instance for a minute: Fluid reuses instances and an agent's calls come in bursts on one paper; a re-run shows up
// within that minute.
import { desc, isNotNull, sql } from 'drizzle-orm'
import type { PaperDigest } from '#shared/types'
import { useDb } from '../db'
import { papers } from '../db/schema'
import { toyDigest } from '../fixtures/toy-digest'
import { loadChatSources } from './chatSources'
import type { ChatSources } from './chatTools'
import { loadDigest, loadFigureImage } from './digests'
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

async function listDigestedPapers(): Promise<McpPaperRow[]> {
  const db = await useDb()
  const rows = await db.select({
    slug: papers.slug,
    title: papers.title,
    authors: papers.authors,
    source: papers.sourceRef,
    nodes: sql<number>`jsonb_array_length(${papers.digest}->'nodes')`.mapWith(Number)
  }).from(papers).where(isNotNull(papers.digest)).orderBy(desc(papers.createdAt))
  // Dev: the toy fixture stands in as a digested paper, as on the library page.
  if (import.meta.dev && !rows.some(r => r.slug === 'toy')) {
    rows.push({ slug: toyDigest.slug, title: toyDigest.title, authors: toyDigest.authors ?? [], source: toyDigest.source.ref, nodes: toyDigest.nodes.length })
  }
  return rows
}

export function agentApiDeps(): McpDeps {
  return {
    listPapers: listDigestedPapers,
    loadDigest: slug => digestCache(slug, () => loadDigest(slug)),
    loadSources: (slug, digest) => sourcesCache(`${slug}@${digest.run_id}`, () => loadChatSources(slug, digest)),
    loadFigureImage,
    appUrl: useRuntimeConfig().public.appUrl.replace(/\/$/, '')
  }
}
