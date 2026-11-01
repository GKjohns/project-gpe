// npm run catalog:sync                              reads the openai/math index at main's current commit into Supabase
// npm run catalog:sync -- --payload.force=true      writes even when CONTENTS.md and overview.tex disagree
// npm run catalog:sync -- --payload.json=true       returns the report as JSON
// Zero model calls. GITHUB_TOKEN (optional) raises the GitHub rate limit for resolving the commit. Dev server up.
import { CatalogInvalidError, syncCatalog } from '../../catalog/sync'
import type { SyncReport } from '../../catalog/sync'
import { invalidateCatalog } from '../../utils/agentApi'
import { payloadFlag } from '../../utils/taskPayload'

export default defineTask<SyncReport | string>({
  meta: { name: 'catalog:sync', description: 'Sync the openai/math catalog (families, manuscripts) into Supabase' },
  async run({ payload }) {
    try {
      const r = await syncCatalog({ force: payloadFlag(payload.force) })
      invalidateCatalog()
      if (payloadFlag(payload.json)) {
        return { result: r }
      }
      const lines = [
        `openai/math @ ${r.sha}`,
        `${r.families} families, ${r.manuscripts} manuscripts, ${r.disciplines} disciplines; Lean: ${r.lean} families, ${r.leanManuscripts} manuscripts`,
        `written: ${r.written.families} families, ${r.written.manuscripts} manuscripts`,
        ...Object.entries(r.byDiscipline).map(([d, n]) => `  ${String(n).padStart(3)}  ${d}`),
        `stale (kept): ${r.stale.families.length} families, ${r.stale.manuscripts.length} manuscripts${r.stale.families.length ? ` (${r.stale.families.join(', ')})` : ''}`,
        `linked: ${r.linked.join(', ') || '(none)'}`,
        ...r.warnings.map(w => `warning: ${w}`)
      ]
      return { result: lines.join('\n') }
    } catch (err) {
      if (err instanceof CatalogInvalidError) {
        throw new Error(`The index failed validation (rerun with --payload.force=true to write anyway):\n${err.problems.map(p => `  ${p}`).join('\n')}`, { cause: err })
      }
      throw err
    }
  }
})
