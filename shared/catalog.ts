// The openai/math catalog as the pages and /api/v1/families serve it. Contract:
// docs/20261101_openai_explorer/implementation_plan.md § API shapes. Change the plan first.

export interface FamilyDigest {
  slug: string
  dir: string
  counts: { nodes: number, sections: number, novel: number, friction: number }
  pages?: number
  headline?: string
}

export interface FamilySummary {
  number: number
  code: string // '049'
  title: string
  description: string
  discipline: string
  disciplineSlug: string
  members: number
  hasLean: boolean
  reasoningTrace?: string // absolute URL
  digested: FamilyDigest[] // [] = not yet
  flagship?: { rank: number, reason: string }
}

export interface FamiliesQuery {
  q?: string
  discipline?: string
  digested?: '1' | '0'
  lean?: '1' | '0'
  sort?: 'flagship' | 'number' | 'title' | 'members'
  limit?: number
  offset?: number
}

export interface FamiliesResponse { total: number, offset: number, limit: number, families: FamilySummary[] }

export interface CatalogStats { families: number, manuscripts: number, disciplines: number, digested: number, lean: number, sha: string, syncedAt: string }

export interface DisciplinesResponse { stats: CatalogStats, disciplines: { slug: string, name: string, families: number, digested: number }[] }

export interface ManuscriptItem {
  dir: string
  title: string
  abstract: string
  publishedOn?: string
  pdfUrl: string
  sourceUrl: string
  readmeUrl: string
  hasLean: boolean
  digest?: FamilyDigest
}

export interface FamilyDetail extends FamilySummary { manuscripts: ManuscriptItem[] }

export const familyCode = (n: number) => String(n).padStart(3, '0')

export const disciplineSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
