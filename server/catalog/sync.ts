// Fills families / manuscripts / catalog_meta from the openai/math index at a pinned commit. Zero model calls; rows are
// upserted, never deleted (a family that leaves the index is reported as stale and kept). Runs from
// `npm run catalog:sync` and POST /api/admin/catalog/sync. Relative imports only.
//
// No transaction: families, then manuscripts (they reference families), then catalog_meta, then the paper links, each
// an idempotent upsert, so a sync that fails half way converges when re-run.
import { familyRow, manuscriptRow } from '../utils/rows'
import type { DbInsert, FamilyRow, ManuscriptRow } from '../utils/rows'
import { must, selectAll, useSupabase } from '../utils/supabase'
import { disciplineSlug } from '../../shared/catalog'
import { parseContents, parseLeanDirs, parseOverview, parseReasoningTraces, publishedOnFromDir, validateCatalog } from './parse'

export const CATALOG_KEY = 'openai-math'
const REPO = 'openai/math'
const FILES = ['CONTENTS.md', 'overview.tex', 'lean/formalization.yaml', 'README.md'] as const

export interface SyncReport {
  sha: string
  families: number
  manuscripts: number
  disciplines: number
  /** Families with at least one formalized manuscript. */
  lean: number
  leanManuscripts: number
  byDiscipline: Record<string, number>
  /** Rows written because they were new or differed; 0 and 0 on a re-sync of the same commit. */
  written: { families: number, manuscripts: number }
  /** In the DB but no longer in the index: kept, never deleted. */
  stale: { families: number[], manuscripts: string[] }
  /** Slugs whose manuscript_dir this sync set. */
  linked: string[]
  /** Validation problems ignored under `force`, and Lean ids that name no manuscript. */
  warnings: string[]
}

export class CatalogInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(`openai/math index failed validation (${problems.length} problems): ${problems.slice(0, 5).join('; ')}`)
  }
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

async function fetchIndex(fetchImpl: FetchImpl): Promise<{ sha: string, files: Record<typeof FILES[number], string> }> {
  const token = process.env.GITHUB_TOKEN
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: { 'accept': 'application/vnd.github.sha', 'user-agent': 'proofmap-catalog', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  })
  const sha = (await res.text()).trim()
  if (!res.ok || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Resolving ${REPO}@main failed: ${res.status} ${sha.slice(0, 120)}`)
  }
  const files = {} as Record<typeof FILES[number], string>
  await Promise.all(FILES.map(async (path) => {
    const r = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`)
    if (!r.ok) {
      throw new Error(`Fetching ${path}@${sha.slice(0, 7)} failed: ${r.status}`)
    }
    files[path] = await r.text()
  }))
  return { sha, files }
}

const same = (a: object, b: object) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort())

/** PostgREST request bodies stay well under the gateway limit at this size (721 manuscripts → 2 requests). */
const CHUNK = 500

const familyInsert = (r: FamilyRow): DbInsert<'families'> => ({
  number: r.number,
  title: r.title,
  description: r.description,
  discipline: r.discipline,
  discipline_slug: r.disciplineSlug,
  position: r.position,
  member_count: r.memberCount,
  has_lean: r.hasLean,
  reasoning_trace: r.reasoningTrace
})

const manuscriptInsert = (r: ManuscriptRow): DbInsert<'manuscripts'> => ({
  dir: r.dir,
  family_number: r.familyNumber,
  position: r.position,
  title: r.title,
  abstract: r.abstract,
  pdf_file: r.pdfFile,
  published_on: r.publishedOn,
  has_lean: r.hasLean
})

/** Sets papers.manuscript_dir from source_ref (`…/preprints/<dir>/…`) where it is unset and the dir is catalogued. */
export async function linkPapers(): Promise<string[]> {
  const supa = useSupabase()
  const [dirRows, rows] = await Promise.all([
    selectAll((from, to) => supa.from('manuscripts').select('dir').order('dir').range(from, to)),
    selectAll((from, to) => supa.from('papers').select('id, slug, source_ref').is('manuscript_dir', null).order('id').range(from, to))
  ])
  const dirs = new Set(dirRows.map(r => r.dir))
  const linked: string[] = []
  for (const r of rows) {
    const dir = /\/preprints\/([^/]+)/.exec(r.source_ref)?.[1]
    if (dir && dirs.has(dir)) {
      // Conditional on still-unset, so a concurrent link or manual set isn't overwritten.
      must(await supa.from('papers').update({ manuscript_dir: dir }).eq('id', r.id).is('manuscript_dir', null))
      linked.push(r.slug)
    }
  }
  return linked.sort()
}

export async function syncCatalog(opts: { force?: boolean, fetchImpl?: FetchImpl } = {}): Promise<SyncReport> {
  const { sha, files } = await fetchIndex(opts.fetchImpl ?? fetch)
  const contents = parseContents(files['CONTENTS.md'])
  const overview = parseOverview(files['overview.tex'])
  const leanDirs = parseLeanDirs(files['lean/formalization.yaml'])
  const traces = parseReasoningTraces(files['README.md'])
  const { problems } = validateCatalog(contents, overview)
  if (problems.length && !opts.force) {
    throw new CatalogInvalidError(problems)
  }

  const disciplineOf = new Map(overview.map(e => [e.number, e.discipline]))
  const familyRows: FamilyRow[] = []
  const manuscriptRows: ManuscriptRow[] = []
  contents.families.forEach((f, i) => {
    const discipline = disciplineOf.get(f.number) ?? 'Uncategorized'
    familyRows.push({
      number: f.number,
      title: f.title,
      description: f.description,
      discipline,
      disciplineSlug: disciplineSlug(discipline),
      position: i,
      memberCount: f.members.length,
      hasLean: f.members.some(m => leanDirs.has(m.dir)),
      reasoningTrace: traces.get(f.number) ?? null
    })
    f.members.forEach((m, j) => manuscriptRows.push({
      dir: m.dir,
      familyNumber: f.number,
      position: j,
      title: m.title,
      abstract: m.abstract,
      pdfFile: m.pdfFile,
      publishedOn: publishedOnFromDir(m.dir),
      hasLean: leanDirs.has(m.dir)
    }))
  })
  const indexDirs = new Set(manuscriptRows.map(m => m.dir))
  const indexNumbers = new Set(familyRows.map(f => f.number))
  const warnings = [...problems, ...[...leanDirs].filter(d => !indexDirs.has(d)).map(d => `lean/formalization.yaml names ${d}, which CONTENTS.md does not list`)]

  const supa = useSupabase()
  const [oldFamilyRows, oldManuscriptRows] = await Promise.all([
    selectAll((from, to) => supa.from('families').select('*').order('number').range(from, to)),
    selectAll((from, to) => supa.from('manuscripts').select('*').order('dir').range(from, to))
  ])
  const oldFamilies = new Map(oldFamilyRows.map(familyRow).map(r => [r.number, r]))
  const oldManuscripts = new Map(oldManuscriptRows.map(manuscriptRow).map(r => [r.dir, r]))
  const newFamilies = familyRows.filter(r => !oldFamilies.has(r.number) || !same(r, oldFamilies.get(r.number)!))
  const newManuscripts = manuscriptRows.filter(r => !oldManuscripts.has(r.dir) || !same(r, oldManuscripts.get(r.dir)!))
  // Families first: manuscripts reference them.
  for (let i = 0; i < newFamilies.length; i += CHUNK) {
    must(await supa.from('families').upsert(newFamilies.slice(i, i + CHUNK).map(familyInsert), { onConflict: 'number' }))
  }
  for (let i = 0; i < newManuscripts.length; i += CHUNK) {
    must(await supa.from('manuscripts').upsert(newManuscripts.slice(i, i + CHUNK).map(manuscriptInsert), { onConflict: 'dir' }))
  }
  const counts = {
    families: familyRows.length,
    manuscripts: manuscriptRows.length,
    disciplines: new Set(familyRows.map(f => f.disciplineSlug)).size,
    lean: familyRows.filter(f => f.hasLean).length,
    leanManuscripts: manuscriptRows.filter(m => m.hasLean).length,
    traces: traces.size
  }
  const value = { sha, syncedAt: new Date().toISOString(), counts }
  must(await supa.from('catalog_meta').upsert({ key: CATALOG_KEY, value }, { onConflict: 'key' }))
  const linked = await linkPapers()
  const byDiscipline: Record<string, number> = {}
  for (const f of familyRows) {
    byDiscipline[f.discipline] = (byDiscipline[f.discipline] ?? 0) + 1
  }
  return {
    sha,
    families: counts.families,
    manuscripts: counts.manuscripts,
    disciplines: counts.disciplines,
    lean: counts.lean,
    leanManuscripts: counts.leanManuscripts,
    byDiscipline,
    written: { families: newFamilies.length, manuscripts: newManuscripts.length },
    stale: {
      families: [...oldFamilies.keys()].filter(n => !indexNumbers.has(n)).sort((a, b) => a - b),
      manuscripts: [...oldManuscripts.keys()].filter(d => !indexDirs.has(d)).sort()
    },
    linked,
    warnings
  }
}
