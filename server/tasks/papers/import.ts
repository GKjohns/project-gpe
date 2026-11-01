// npm run papers:import -- --payload.slugs=eth,logspace     loads .data/export/<slug>.json (+ blobs/) into Supabase
// npm run papers:import -- --payload.all=true               every .json in .data/export (the 4.1 archive)
// Dev server must be up (nuxt task run talks to it). New papers keep the file's public flag; check with paper:public.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { linkPapers } from '../../catalog/sync'
import { importPaper } from '../../utils/paperImport'
import type { ImportResult } from '../../utils/paperImport'
import { invalidateCatalog } from '../../utils/agentApi'
import { payloadFlag, payloadList } from '../../utils/taskPayload'

const DIR = '.data/export'

export default defineTask({
  meta: { name: 'papers:import', description: 'Import papers:export JSON files from .data/export into Supabase' },
  async run({ payload }) {
    const slugs = payloadFlag(payload.all)
      ? (await readdir(DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
      : payloadList(payload.slugs)
    if (!slugs.length) {
      return { result: 'usage: npm run papers:import -- --payload.slugs=<slug>,<slug> | --payload.all=true' }
    }
    const lines: string[] = []
    const results: ImportResult[] = []
    for (const slug of slugs) {
      const r = await importPaper(join(DIR, `${slug}.json`), join(DIR, 'blobs'))
      results.push(r)
      lines.push(r.status === 'skipped'
        ? `${slug.padEnd(14)} skipped: ${r.reason}`
        : `${slug.padEnd(14)} ${r.status === 'unchanged' ? 'already imported, nothing written' : 'imported'}  ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    }
    const linked = await linkPapers()
    invalidateCatalog()
    lines.push(`linked: ${linked.join(', ') || '(none)'}`)
    return { result: lines.join('\n') }
  }
})
