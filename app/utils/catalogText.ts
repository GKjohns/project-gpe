// The openai/math index text carries markdown links (normalized to absolute URLs by the sync), which NodeMathText
// would show raw. The public pages drop them from prose and surface the Lean doc link on its own.
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const LEAN_LINK = /\s*\(\[Lean\]\((https?:\/\/[^)\s]+)\)\)/

/** Prose without markdown links: a parenthesized "([Lean](…))" goes entirely, any other link keeps its text. */
export function indexProse(text: string): string {
  return text.replace(LEAN_LINK, '').replace(MD_LINK, '$1').trim()
}

/** The family's lean/docs/<n>.md URL when the description links one. */
export function leanDocUrl(text: string): string | undefined {
  return text.match(LEAN_LINK)?.[1]
}

export function formatDay(iso?: string): string | undefined {
  if (!iso) {
    return undefined
  }
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
