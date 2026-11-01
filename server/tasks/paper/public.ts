// npm run paper:public                                   lists every paper with its public flag
// npm run paper:public -- --payload.on=eth,pfr           makes those papers public on the agent API
// npm run paper:public -- --payload.off=eth-agent        makes them private again
// Clears this instance's catalog cache; other instances pick the flip up within their 60-s TTL. Dev server up.
import { invalidateCatalog } from '../../utils/agentApi'
import { must, selectAll, useSupabase } from '../../utils/supabase'
import { payloadList } from '../../utils/taskPayload'

export default defineTask({
  meta: { name: 'paper:public', description: 'List papers and their public flag, or flip it (payload on / off)' },
  async run({ payload }) {
    const supa = useSupabase()
    const lines: string[] = []
    let missing = 0
    for (const [key, value] of [['on', true], ['off', false]] as const) {
      const slugs = payloadList(payload[key])
      if (!slugs.length) {
        continue
      }
      const changed = must(await supa.from('papers').update({ public: value }).in('slug', slugs).select('slug')) ?? []
      const absent = slugs.filter(s => !changed.some(c => c.slug === s))
      missing += absent.length
      lines.push(`${value ? 'public' : 'private'}: ${changed.map(c => c.slug).sort().join(', ') || '(none)'}`)
      if (absent.length) {
        lines.push(`no such paper: ${absent.join(', ')}`)
      }
    }
    if (lines.length) {
      invalidateCatalog()
      if (missing) {
        throw new Error(lines.join('\n'))
      }
      return { result: lines.join('\n') }
    }
    const rows = await selectAll((from, to) => supa.from('papers').select('slug, public, title').order('slug').range(from, to))
    return { result: rows.map(r => `${r.public ? 'public ' : 'private'}  ${r.slug.padEnd(28)}  ${r.title}`).join('\n') || '(no papers)' }
  }
})
