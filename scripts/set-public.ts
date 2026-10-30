// npm run paper:public                       lists every paper with its public flag
// npm run paper:public -- eth pfr            makes those papers public on the agent API
// npm run paper:public -- --off eth-agent    makes them private again
// The agent API caches per instance for a minute, so a flip shows up within that.
import { asc, inArray } from 'drizzle-orm'
import { papers } from '../server/db/schema'
import { openDb } from './db'

const args = process.argv.slice(2)
const off = args.includes('--off')
const slugs = args.filter(a => !a.startsWith('--'))

const { db, close } = await openDb()
try {
  if (slugs.length) {
    const changed = await db.update(papers).set({ public: !off }).where(inArray(papers.slug, slugs)).returning({ slug: papers.slug })
    const missing = slugs.filter(s => !changed.some(c => c.slug === s))
    console.log(`${off ? 'private' : 'public'}: ${changed.map(c => c.slug).join(', ') || '(none)'}`)
    if (missing.length) {
      console.log(`no such paper: ${missing.join(', ')}`)
      process.exitCode = 1
    }
  } else {
    const rows = await db.select({ slug: papers.slug, public: papers.public, title: papers.title }).from(papers).orderBy(asc(papers.slug))
    for (const r of rows) {
      console.log(`${r.public ? 'public ' : 'private'}  ${r.slug.padEnd(28)}  ${r.title}`)
    }
  }
} finally {
  await close()
}
