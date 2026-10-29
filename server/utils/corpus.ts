/**
 * The checked-in corpus (Sprint 8): manifest + goldens, imported statically so they're bundled
 * (Vercel's filesystem has no corpus/ at runtime).
 */
import type { CorpusEntry, CorpusManifest, Golden } from '#shared/corpus'
import { corpusPaperSlugs } from '#shared/corpus'
import type { StructureMethod } from '#shared/types'
import manifestJson from '../../corpus/manifest.json'
import sensitivityGolden from '../../corpus/golden/sensitivity.json'
import toyGolden from '../../corpus/golden/toy.json'

export const corpusManifest = manifestJson as CorpusManifest

// Keyed by the manifest's `golden` path. A new golden needs a line here.
const GOLDENS: Record<string, Golden> = {
  'corpus/golden/sensitivity.json': sensitivityGolden as Golden,
  'corpus/golden/toy.json': toyGolden as Golden
}

export function corpusEntry(slug: string): CorpusEntry | undefined {
  return corpusManifest.entries.find(e => e.slug === slug)
}

/** The corpus entry and method whose runs live on this paper row, if any. */
export function corpusEntryForPaper(paperSlug: string): { entry: CorpusEntry, method: StructureMethod } | undefined {
  for (const entry of corpusManifest.entries) {
    for (const method of ['pipeline', 'agent'] as const) {
      if (corpusPaperSlugs(entry, method).includes(paperSlug)) {
        return { entry, method }
      }
    }
  }
  return undefined
}

/** The golden for a paper row: its corpus entry's golden. */
export function goldenForPaper(paperSlug: string): Golden | undefined {
  const golden = corpusEntryForPaper(paperSlug)?.entry.golden
  return golden ? GOLDENS[golden] : undefined
}

export function goldenByPath(path: string): Golden | undefined {
  return GOLDENS[path]
}
