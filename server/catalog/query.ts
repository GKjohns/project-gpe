// Read side of the catalog: pure functions over the rows loadCatalog() (server/utils/agentApi.ts) caches. 373 families
// fit in memory, so filtering, search and sorting happen here rather than in SQL.
import type { CatalogStats, DisciplinesResponse, FamiliesQuery, FamiliesResponse, FamilyDetail, FamilyDigest, FamilySummary, ManuscriptItem } from '../../shared/catalog'
import { familyCode } from '../../shared/catalog'
import { FLAGSHIP } from '../../shared/flagship'
import type { FamilyRow, ManuscriptRow } from '../utils/rows'

export const LIMIT_DEFAULT = 50
export const LIMIT_MAX = 400

const REPO = 'https://github.com/openai/math'

export interface Catalog {
  families: FamilyRow[] // CONTENTS.md order
  members: Map<number, ManuscriptRow[]>
  /** Public digests by manuscript dir (the most recently updated paper wins). */
  digests: Map<string, FamilyDigest>
  meta: { sha: string, syncedAt: string } | null
  haystack: Map<number, string>
}

const FLAGSHIP_RANK = new Map(FLAGSHIP.map((f, i) => [f.number, { rank: i + 1, reason: f.reason }]))

export function buildCatalog(families: FamilyRow[], manuscripts: ManuscriptRow[], digests: Map<string, FamilyDigest>, meta: Catalog['meta']): Catalog {
  const members = new Map<number, ManuscriptRow[]>()
  for (const m of [...manuscripts].sort((a, b) => a.position - b.position)) {
    members.set(m.familyNumber, [...members.get(m.familyNumber) ?? [], m])
  }
  const sorted = [...families].sort((a, b) => a.position - b.position)
  const haystack = new Map(sorted.map(f => [f.number, [f.title, f.description, ...(members.get(f.number) ?? []).flatMap(m => [m.title, m.abstract])].join('\n').toLowerCase()]))
  return { families: sorted, members, digests, meta, haystack }
}

function summary(c: Catalog, f: FamilyRow): FamilySummary {
  const flagship = FLAGSHIP_RANK.get(f.number)
  return {
    number: f.number,
    code: familyCode(f.number),
    title: f.title,
    description: f.description,
    discipline: f.discipline,
    disciplineSlug: f.disciplineSlug,
    members: f.memberCount,
    hasLean: f.hasLean,
    ...(f.reasoningTrace ? { reasoningTrace: `${REPO}/blob/main/${f.reasoningTrace}` } : {}),
    digested: (c.members.get(f.number) ?? []).map(m => c.digests.get(m.dir)).filter(d => !!d),
    ...(flagship ? { flagship } : {})
  }
}

function manuscriptItem(c: Catalog, m: ManuscriptRow): ManuscriptItem {
  const digest = c.digests.get(m.dir)
  return {
    dir: m.dir,
    title: m.title,
    abstract: m.abstract,
    ...(m.publishedOn ? { publishedOn: m.publishedOn } : {}),
    pdfUrl: `${REPO}/blob/main/preprints/${m.dir}/${m.pdfFile}`,
    // The URL shape the GitHub fetch stage consumes (corpus/manifest.json).
    sourceUrl: `${REPO}/tree/main/preprints/${m.dir}/build`,
    readmeUrl: `${REPO}/tree/main/preprints/${m.dir}`,
    hasLean: m.hasLean,
    ...(digest ? { digest } : {})
  }
}

const isDigested = (c: Catalog, n: number) => (c.members.get(n) ?? []).some(m => c.digests.has(m.dir))

export function queryFamilies(c: Catalog, q: FamiliesQuery = {}): FamiliesResponse {
  const needle = q.q?.trim().toLowerCase()
  const rows = c.families.filter(f => (!needle || c.haystack.get(f.number)!.includes(needle))
    && (!q.discipline || f.disciplineSlug === q.discipline)
    && (!q.digested || isDigested(c, f.number) === (q.digested === '1'))
    && (!q.lean || f.hasLean === (q.lean === '1')))
  const rank = (f: FamilyRow) => FLAGSHIP_RANK.get(f.number)?.rank ?? Infinity
  const byNumber = (a: FamilyRow, b: FamilyRow) => a.number - b.number
  const sorts: Record<NonNullable<FamiliesQuery['sort']>, (a: FamilyRow, b: FamilyRow) => number> = {
    flagship: (a, b) => (rank(a) - rank(b) || Number(isDigested(c, b.number)) - Number(isDigested(c, a.number)) || byNumber(a, b)),
    number: byNumber,
    title: (a, b) => a.title.localeCompare(b.title) || byNumber(a, b),
    members: (a, b) => b.memberCount - a.memberCount || byNumber(a, b)
  }
  rows.sort(sorts[q.sort ?? 'flagship'])
  const offset = q.offset ?? 0
  const limit = Math.min(q.limit ?? LIMIT_DEFAULT, LIMIT_MAX)
  return { total: rows.length, offset, limit, families: rows.slice(offset, offset + limit).map(f => summary(c, f)) }
}

export function familyDetail(c: Catalog, n: number): FamilyDetail | null {
  const f = c.families.find(x => x.number === n)
  return f ? { ...summary(c, f), manuscripts: (c.members.get(n) ?? []).map(m => manuscriptItem(c, m)) } : null
}

/** The family and manuscript a paper digests, for GET /api/papers/:slug and get_overview. */
export function manuscriptEntry(c: Catalog, dir: string): { family: FamilySummary, manuscript: ManuscriptItem } | null {
  for (const [n, list] of c.members) {
    const m = list.find(x => x.dir === dir)
    const f = m && c.families.find(x => x.number === n)
    if (m && f) {
      return { family: summary(c, f), manuscript: manuscriptItem(c, m) }
    }
  }
  return null
}

/** Disciplines in the order overview.tex introduces them (= their first family's position). */
export function disciplineList(c: Catalog): DisciplinesResponse['disciplines'] {
  const out = new Map<string, DisciplinesResponse['disciplines'][number]>()
  for (const f of c.families) {
    const d = out.get(f.disciplineSlug) ?? { slug: f.disciplineSlug, name: f.discipline, families: 0, digested: 0 }
    d.families++
    d.digested += Number(isDigested(c, f.number))
    out.set(f.disciplineSlug, d)
  }
  return [...out.values()]
}

export function catalogStats(c: Catalog): CatalogStats {
  return {
    families: c.families.length,
    manuscripts: [...c.members.values()].reduce((sum, l) => sum + l.length, 0),
    disciplines: new Set(c.families.map(f => f.disciplineSlug)).size,
    digested: c.families.filter(f => isDigested(c, f.number)).length,
    lean: c.families.filter(f => f.hasLean).length,
    sha: c.meta?.sha ?? '',
    syncedAt: c.meta?.syncedAt ?? ''
  }
}
