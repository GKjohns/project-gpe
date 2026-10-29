import type { InjectionKey } from 'vue'
import type { PaperResponse } from '#shared/api'
import type { PaperDigest, PaperSection, ProofNode } from '#shared/types'

export interface DigestIndex {
  byId: Map<string, ProofNode>
  /** Reverse edges over deps_paper ∪ deps_inferred. */
  usedBy: Record<string, string[]>
  /** Claims grouped under the statement whose proof contains them, in source order. */
  children: Record<string, ProofNode[]>
  sectionById: Map<string, PaperSection>
  /** Section of each node; claims fall back to their parent's section. */
  sectionOf: Record<string, PaperSection | undefined>
}

function buildIndex(digest: PaperDigest | null | undefined): DigestIndex {
  const byId = new Map<string, ProofNode>()
  const usedBy: Record<string, string[]> = {}
  const children: Record<string, ProofNode[]> = {}
  const sectionById = new Map<string, PaperSection>()
  const sectionOf: Record<string, PaperSection | undefined> = {}
  if (!digest) {
    return { byId, usedBy, children, sectionById, sectionOf }
  }
  for (const s of digest.sections) {
    sectionById.set(s.id, s)
  }
  for (const n of digest.nodes) {
    byId.set(n.id, n)
  }
  for (const n of digest.nodes) {
    for (const dep of new Set([...n.deps_paper, ...n.deps_inferred])) {
      (usedBy[dep] ??= []).push(n.id)
    }
    if (n.parent_id) {
      (children[n.parent_id] ??= []).push(n)
    }
  }
  for (const list of Object.values(children)) {
    list.sort((a, b) => a.paper_ref.line - b.paper_ref.line)
  }
  for (const n of digest.nodes) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined
    sectionOf[n.id] = sectionById.get(n.paper_ref.section) ?? (parent ? sectionById.get(parent.paper_ref.section) : undefined)
  }
  return { byId, usedBy, children, sectionById, sectionOf }
}

/** Fetches a paper + digest once per slug (keyed, so every caller shares it) and indexes it. */
export function useDigest(slug: MaybeRefOrGetter<string>) {
  const fetched = useFetch<PaperResponse>(() => `/api/papers/${toValue(slug)}`, {
    key: computed(() => `paper:${toValue(slug)}`)
  })
  const digest = computed(() => fetched.data.value?.digest ?? null)
  const paper = computed(() => fetched.data.value?.paper ?? null)
  const index = computed(() => buildIndex(digest.value))
  // `await ready` in a page's setup so SSR renders with the digest.
  const ready: Promise<void> = fetched.then(() => undefined)
  return { paper, digest, index, error: fetched.error, status: fetched.status, refresh: fetched.refresh, ready }
}

export type DigestContext = Pick<ReturnType<typeof useDigest>, 'paper' | 'digest' | 'index'>

const DIGEST_KEY: InjectionKey<DigestContext> = Symbol('digest')

export function provideDigest(ctx: DigestContext) {
  provide(DIGEST_KEY, ctx)
}

/** The provided digest, or null outside a paper page. */
export function injectDigest(): DigestContext | null {
  return inject(DIGEST_KEY, null)
}

/** For components under a page that called provideDigest (tree, node page, chips, graph, chat). */
export function useDigestContext(): DigestContext {
  const ctx = injectDigest()
  if (!ctx) {
    throw new Error('useDigestContext() needs a provideDigest() ancestor')
  }
  return ctx
}
