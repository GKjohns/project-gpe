// Validates outline.json against skeleton.json (both in the working directory). No dependencies.
// Usage: node validate_outline.mjs [outline.json]
// Prints "OK: …" or "FAIL: N errors" first, then one line per error / warning. Exit 1 on any error.
// Mirrors the app's normalizeOutline (server/pipeline/stages/outline.ts): what fails here would be dropped there.
import { readFileSync } from 'node:fs'

const CLAIM_PROOF_LINES = 60
const FLAG_KINDS = new Set(['unused_statement', 'ref_to_nonstatement', 'suspect_span', 'possible_restatement', 'other'])

const file = process.argv[2] || 'outline.json'
const skeleton = JSON.parse(readFileSync('skeleton.json', 'utf8'))
const errors = []
const warnings = []

let outline
try {
  outline = JSON.parse(readFileSync(file, 'utf8'))
} catch (err) {
  console.log(`FAIL: 1 error\nerror: cannot read ${file} as JSON: ${err.message}`)
  process.exit(1)
}

const statements = new Map(skeleton.statements.map(s => [s.label, s]))
const fileLines = new Map(skeleton.files.map(f => [f.path, f.lines]))
const isInt = n => Number.isInteger(n)

if (!outline || typeof outline !== 'object' || !Array.isArray(outline.claims) || !Array.isArray(outline.flags)) {
  console.log('FAIL: 1 error\nerror: top level must be { "claims": [...], "flags": [...] }')
  process.exit(1)
}

const claims = outline.claims
const ids = new Map()
claims.forEach((c, i) => {
  const where = `claims[${i}]${c?.id ? ` (${c.id})` : ''}`
  if (!c || typeof c !== 'object') {
    errors.push(`${where}: not an object`)
    return
  }
  if (typeof c.id !== 'string' || !c.id) {
    errors.push(`${where}: id must be a non-empty string`)
  } else if (statements.has(c.id)) {
    errors.push(`${where}: id collides with a statement label; use ids like c1, c2`)
  } else if (ids.has(c.id)) {
    errors.push(`${where}: duplicate id`)
  } else {
    ids.set(c.id, c)
  }
  if (typeof c.nameHint !== 'string' || !c.nameHint.trim()) {
    errors.push(`${where}: nameHint must be a non-empty string`)
  } else if (/^(step|claim|part)\s*\d+$/i.test(c.nameHint.trim())) {
    errors.push(`${where}: nameHint "${c.nameHint}" is not semantic; say what the claim establishes`)
  }
  if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) {
    errors.push(`${where}: confidence must be a number in [0, 1]`)
  }
  if (!Array.isArray(c.restsOn) || c.restsOn.some(r => typeof r !== 'string')) {
    errors.push(`${where}: restsOn must be an array of strings`)
  }
  if (!statements.has(c.parentLabel)) {
    errors.push(`${where}: parentLabel "${c.parentLabel}" is not a statement label in skeleton.json`)
  }
  const s = c.span
  if (!s || typeof s !== 'object' || !fileLines.has(s.file) || !isInt(s.startLine) || !isInt(s.endLine)) {
    errors.push(`${where}: span must be { file: <a path from skeleton.json files>, startLine: int, endLine: int }`)
  } else if (s.startLine < 1 || s.endLine < s.startLine || s.endLine > fileLines.get(s.file)) {
    errors.push(`${where}: span ${s.file}:${s.startLine}-${s.endLine} is out of range (file has ${fileLines.get(s.file)} lines; start ≤ end)`)
  }
})

const validSpan = c => c?.span && fileLines.has(c.span.file) && isInt(c.span.startLine) && isInt(c.span.endLine)
const insideProof = (c) => {
  const p = statements.get(c.parentLabel)?.proof
  return !!p && p.file === c.span.file && c.span.startLine >= p.startLine && c.span.endLine <= p.endLine
}
// A parent with claims outside its recorded proof is one argument across places (second proof, appendix).
const spansElsewhere = new Set(claims.filter(c => statements.has(c?.parentLabel) && validSpan(c) && !insideProof(c)).map(c => c.parentLabel))

for (const c of claims) {
  if (!statements.has(c?.parentLabel) || !validSpan(c)) {
    continue
  }
  const p = statements.get(c.parentLabel).proof
  if (p && insideProof(c) && p.lines < CLAIM_PROOF_LINES && !spansElsewhere.has(c.parentLabel)) {
    errors.push(`${c.id}: ${c.parentLabel}'s proof is ${p.lines} lines (< ${CLAIM_PROOF_LINES}); short proofs get no claims`)
  } else if (!insideProof(c)) {
    warnings.push(`${c.id}: span ${c.span.file}:${c.span.startLine}-${c.span.endLine} is outside ${c.parentLabel}'s recorded proof${p ? ` (${p.file}:${p.startLine}-${p.endLine})` : ' (none recorded)'}; fine only for a second proof or an argument elsewhere, e.g. an appendix`)
  }
}

// Overlapping spans within one parent.
const byParent = new Map()
for (const c of claims) {
  if (validSpan(c) && typeof c.id === 'string') {
    byParent.set(c.parentLabel, [...(byParent.get(c.parentLabel) ?? []), c])
  }
}
for (const [parent, list] of byParent) {
  const sorted = [...list].sort((a, b) => a.span.file.localeCompare(b.span.file) || a.span.startLine - b.span.startLine)
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (a.span.file === b.span.file && b.span.startLine <= a.span.endLine) {
      errors.push(`${a.id} and ${b.id} (${parent}) overlap: ${a.span.startLine}-${a.span.endLine} vs ${b.span.startLine}-${b.span.endLine}`)
    }
  }
}

// restsOn targets, and no cycles among claims.
for (const c of claims) {
  if (!Array.isArray(c?.restsOn)) {
    continue
  }
  for (const r of c.restsOn) {
    if (r === c.id) {
      errors.push(`${c.id}: restsOn contains itself`)
    } else if (r === c.parentLabel) {
      errors.push(`${c.id}: restsOn contains its own parent ${r} (a claim is part of its parent's proof)`)
    } else if (!statements.has(r) && !ids.has(r)) {
      errors.push(`${c.id}: restsOn "${r}" is neither a statement label nor a claim id`)
    }
  }
}
const state = new Map()
const cyclic = new Set()
const visit = (id, stack) => {
  if (state.get(id) === 'done') {
    return
  }
  if (state.get(id) === 'open') {
    cyclic.add(stack.slice(stack.indexOf(id)).concat(id).join(' → '))
    return
  }
  state.set(id, 'open')
  for (const r of ids.get(id)?.restsOn ?? []) {
    if (ids.has(r)) {
      visit(r, [...stack, id])
    }
  }
  state.set(id, 'done')
}
for (const id of ids.keys()) {
  visit(id, [])
}
for (const cyc of cyclic) {
  errors.push(`cycle among claims: ${cyc}`)
}

// Flags.
outline.flags.forEach((f, i) => {
  if (!f || !FLAG_KINDS.has(f.kind) || typeof f.note !== 'string' || !f.note.trim()) {
    errors.push(`flags[${i}]: needs kind ∈ ${[...FLAG_KINDS].join(' | ')} and a non-empty note`)
  } else if (f.label !== undefined && typeof f.label !== 'string') {
    errors.push(`flags[${i}]: label must be a string when present`)
  }
})

// Coverage: every long recorded proof should have claims.
const outlined = new Set(claims.map(c => c?.parentLabel))
const missing = skeleton.statements.filter(s => (s.proof?.lines ?? 0) >= CLAIM_PROOF_LINES && !outlined.has(s.label))
if (missing.length) {
  warnings.push(`no claims yet for long proofs: ${missing.map(s => `${s.label} (${s.proof.lines} lines)`).join(', ')}`)
}

const parents = new Set(claims.map(c => c?.parentLabel)).size
if (errors.length) {
  console.log(`FAIL: ${errors.length} error${errors.length === 1 ? '' : 's'} (${claims.length} claims, ${warnings.length} warnings)`)
} else {
  console.log(`OK: ${claims.length} claims in ${parents} proofs, ${outline.flags.length} flags, ${warnings.length} warnings`)
}
for (const e of errors) {
  console.log(`error: ${e}`)
}
for (const w of warnings) {
  console.log(`warning: ${w}`)
}
process.exit(errors.length ? 1 : 0)
