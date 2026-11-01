// Parsers for the openai/math index files (CONTENTS.md, overview.tex, lean/formalization.yaml, README.md). Pure and
// on relative imports (unit-tested without Nitro). Formats: docs/20261101_openai_explorer/
// implementation_plan.md § Data model. Anything that doesn't fit is reported, never guessed at.

export interface IndexManuscript { dir: string, pdfFile: string, title: string, abstract: string }
export interface IndexFamily { number: number, title: string, description: string, members: IndexManuscript[] }
export interface OverviewEntry { number: number, discipline: string, dirs: string[] }

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&emsp;': ' ', '&nbsp;': ' ' }

/**
 * GitHub-flavoured index text → what `<NodeMathText>` renders: `$…$` math, no HTML, paragraphs kept. Repo-relative
 * links (`[Lean](lean/docs/378.md)` in descriptions) become absolute, since the text is shown off GitHub.
 */
export function normalizeIndexText(s: string): string {
  return s
    .replace(/\]\((?!https?:)([^)\s]+)\)/g, '](https://github.com/openai/math/blob/main/$1)')
    .replace(/\$`([^`]*)`\$/g, '$$$1$$')
    .replace(/<\/?(?:i|em|b|strong)>/g, '')
    .replace(/<sub>(.*?)<\/sub>/g, '$$_{$1}$$')
    .replace(/<sup>(.*?)<\/sup>/g, '$$^{$1}$$')
    .replace(/&(?:amp|lt|gt|quot|#39|emsp|nbsp);/g, m => ENTITIES[m]!)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

const FAMILY_CELL = /^\*\*(\d{3})\. (.+?)\*\*\s*(.*)$/s
const MEMBER_CELL = /^&emsp;\[(.+?)\]\(preprints\/([^/]+)\/([^)]+)\)\s*(.*)$/s

/** CONTENTS.md: a bold `NNN. Title.` cell starts a family; each `&emsp;[title](preprints/<dir>/<pdf>)` cell after it is a member. */
export function parseContents(md: string): { families: IndexFamily[], errors: string[] } {
  const families: IndexFamily[] = []
  const errors: string[] = []
  for (const [, raw] of md.matchAll(/<td>([\s\S]*?)<\/td>/g)) {
    const cell = raw!.trim()
    const fam = FAMILY_CELL.exec(cell)
    const mem = fam ? null : MEMBER_CELL.exec(cell)
    if (fam) {
      families.push({
        number: Number(fam[1]),
        title: normalizeIndexText(fam[2]!).replace(/\.$/, ''),
        description: normalizeIndexText(fam[3]!),
        members: []
      })
    } else if (mem && families.length) {
      families.at(-1)!.members.push({ title: normalizeIndexText(mem[1]!), dir: mem[2]!, pdfFile: mem[3]!, abstract: normalizeIndexText(mem[4]!) })
    } else {
      errors.push(`CONTENTS.md: unrecognized cell "${cell.slice(0, 80)}"`)
    }
  }
  return { families, errors }
}

const HREF_DIR = /\\href\{https:\/\/github\.com\/openai\/math\/blob\/main\/preprints\/([^/}]+)\/[^}]+\}/g

/** overview.tex: `\cataloguesection{<Discipline>}` sets the discipline for the `\resultentry{NNN}…` lines after it. */
export function parseOverview(tex: string): OverviewEntry[] {
  const entries: OverviewEntry[] = []
  let discipline = ''
  for (const line of tex.split('\n')) {
    const section = /^\\cataloguesection\{([^}]+)\}/.exec(line)
    if (section) {
      discipline = section[1]!.trim()
      continue
    }
    const entry = /^\\resultentry\{(\d{3})\}/.exec(line)
    if (entry) {
      entries.push({ number: Number(entry[1]), discipline, dirs: [...line.matchAll(HREF_DIR)].map(m => m[1]!) })
    }
  }
  return entries
}

/** lean/formalization.yaml: manuscript dirs with a formalized result (`id: ../preprints/<dir>/…` under `sources:`). */
export function parseLeanDirs(yaml: string): Set<string> {
  const start = yaml.search(/^sources:/m)
  const end = yaml.search(/^related_formalizations:/m)
  const block = start < 0 ? '' : yaml.slice(start, end > start ? end : undefined)
  return new Set([...block.matchAll(/^\s*-?\s*id:\s*["']?\.\.\/preprints\/([^/\s"']+)\//gm)].map(m => m[1]!))
}

/** README.md's reasoning-trace table: family number → 'reasoning_traces/<file>.pdf'. */
export function parseReasoningTraces(md: string): Map<number, string> {
  return new Map([...md.matchAll(/^\| (\d{3}) \| \[(.+?)\]\((reasoning_traces\/[^)]+)\) \|$/gm)].map(m => [Number(m[1]), m[3]!]))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 'The-…-October-25-2026' → '2026-10-25'; null when the dir carries no date. */
export function publishedOnFromDir(dir: string): string | null {
  const m = /-([A-Z][a-z]+)-(\d{1,2})-(\d{4})$/.exec(dir)
  const month = m ? MONTHS.indexOf(m[1]!) + 1 : 0
  return m && month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null
}

/** CONTENTS and overview must describe the same families with the same members; parse errors count as problems. */
export function validateCatalog(contents: { families: IndexFamily[], errors: string[] }, overview: OverviewEntry[]): { ok: boolean, problems: string[] } {
  const problems = [...contents.errors]
  const byNumber = new Map(overview.map(e => [e.number, e]))
  if (contents.families.length !== overview.length) {
    problems.push(`CONTENTS.md has ${contents.families.length} families, overview.tex ${overview.length} \\resultentry lines`)
  }
  if (byNumber.size !== overview.length) {
    problems.push('overview.tex lists a family number twice')
  }
  for (const e of overview.filter(e => !e.discipline)) {
    problems.push(`overview.tex: ${e.number} comes before any \\cataloguesection`)
  }
  const seenFamilies = new Set<number>()
  const seenDirs = new Set<string>()
  for (const f of contents.families) {
    if (seenFamilies.has(f.number)) {
      problems.push(`CONTENTS.md lists family ${f.number} twice`)
    }
    seenFamilies.add(f.number)
    if (!f.members.length) {
      problems.push(`family ${f.number} has no manuscripts`)
    }
    for (const m of f.members) {
      if (seenDirs.has(m.dir)) {
        problems.push(`manuscript ${m.dir} appears twice`)
      }
      seenDirs.add(m.dir)
    }
    const o = byNumber.get(f.number)
    if (!o) {
      problems.push(`family ${f.number} is in CONTENTS.md but not overview.tex`)
      continue
    }
    const a = [...new Set(f.members.map(m => m.dir))].sort().join('|')
    const b = [...new Set(o.dirs)].sort().join('|')
    if (a !== b) {
      problems.push(`family ${f.number}: members differ between CONTENTS.md and overview.tex`)
    }
  }
  return { ok: !problems.length, problems }
}
