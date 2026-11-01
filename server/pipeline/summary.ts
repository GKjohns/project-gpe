// The paper's summary (headline + three-sentence "what it proves") for the overview page, cards and agent rows:
// one call over the finished digest, run by finalize and by the backfill (POST /api/papers/:slug/summary).
// Pure prompt helper, then the call.
import { familyCode } from '#shared/catalog'
import { summarySchema } from '#shared/schemas'
import type { PaperDigest, PaperSummary } from '#shared/types'
import { must, useSupabase } from '../utils/supabase'
import { callObject } from './llm'
import SUMMARY_INSTRUCTIONS from './prompts/summary.md'

/** The catalog fields the prompt reads (a subset of PaperResponse['catalog']). */
export interface SummaryCatalog {
  family: { code: string, title: string, description: string }
  manuscript: { title: string, abstract: string }
}

export const HEADLINE_MAX = 140
export const PROVES_MAX = 700
/** Novel steps shown to the model; the rest of the map is out of scope for three sentences. */
export const SUMMARY_NOVEL = 8

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Title, catalog text when linked, the main theorem, up to SUMMARY_NOVEL novel steps, and the section titles. */
export function summaryPrompt(digest: Pick<PaperDigest, 'title' | 'nodes' | 'root_ids' | 'sections'>, catalog?: SummaryCatalog | null): string {
  const byId = new Map(digest.nodes.map(n => [n.id, n]))
  const main = byId.get(digest.root_ids[0] ?? '')
  const novel = digest.nodes.filter(n => n.classification === 'novel' && n.id !== main?.id).slice(0, SUMMARY_NOVEL)
  const parts = [`Paper: ${digest.title}`]
  if (catalog) {
    parts.push(`Catalog family ${catalog.family.code}: ${catalog.family.title}\n${oneLine(catalog.family.description)}`)
    parts.push(`Manuscript abstract (${catalog.manuscript.title}):\n${catalog.manuscript.abstract.trim()}`)
  }
  if (main) {
    parts.push([
      `## Main theorem · ${main.kind}${main.paper_ref.label ? ` · ${main.paper_ref.label}` : ''} · ${main.classification}`,
      `name: ${main.name}`,
      `statement (paper, LaTeX): ${main.statement_paper.trim()}`,
      `statement (plain): ${oneLine(main.statement_plain)}`,
      `why it matters: ${oneLine(main.explanation)}`
    ].join('\n'))
  }
  if (novel.length) {
    parts.push(`## Novel steps (${novel.length})\n${novel.map(n => `- ${n.name}${n.headline ? ` — ${oneLine(n.headline)}` : ''}: ${oneLine(n.statement_plain)}`).join('\n')}`)
  }
  const sections = digest.sections.filter(s => s.level === 1).map(s => s.title)
  if (sections.length) {
    parts.push(`## Sections\n${sections.join(' · ')}`)
  }
  return parts.join('\n\n')
}

/** The family + manuscript text for a paper's `manuscript_dir`, or null when it isn't catalogued. */
export async function loadSummaryCatalog(dir: string | null | undefined): Promise<SummaryCatalog | null> {
  if (!dir) {
    return null
  }
  // Two reads instead of a join (no FK embedding needed for one row each).
  const supa = useSupabase()
  const m = must(await supa.from('manuscripts').select('family_number, title, abstract').eq('dir', dir).maybeSingle())
  const f = m ? must(await supa.from('families').select('number, title, description').eq('number', m.family_number).maybeSingle()) : null
  return m && f
    ? { family: { code: familyCode(f.number), title: f.title, description: f.description }, manuscript: { title: m.title, abstract: m.abstract } }
    : null
}

/** One call on `model`; usage lands on `runId` (stage finalize) when given. */
export async function runSummary(digest: PaperDigest, opts: { model: string, catalog?: SummaryCatalog | null, runId?: string }): Promise<{ summary: PaperSummary, cost_usd: number }> {
  const { object, usage } = await callObject({
    model: opts.model,
    schema: summarySchema,
    instructions: SUMMARY_INSTRUCTIONS,
    prompt: summaryPrompt(digest, opts.catalog),
    reasoning: 'medium',
    runId: opts.runId,
    stage: opts.runId ? 'finalize' : undefined
  })
  const headline = oneLine(object.headline).replace(/\.$/, '')
  const proves = oneLine(object.proves)
  if (!headline || !proves) {
    throw new Error('the model returned an empty summary')
  }
  return { summary: { headline, proves, model: opts.model, generated_at: new Date().toISOString() }, cost_usd: usage.cost_usd }
}
