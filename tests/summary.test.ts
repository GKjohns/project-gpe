import { describe, expect, it } from 'vitest'
import type { PaperDigest } from '#shared/types'
import { toyDigest } from '../server/fixtures/toy-digest'
import { attachSummary } from '../server/pipeline/stages/finalize'
import { SUMMARY_NOVEL, summaryPrompt } from '../server/pipeline/summary'

const toy = (): PaperDigest => structuredClone(toyDigest)
const catalog = {
  family: { code: '378', title: 'Disproof of ETH', description: 'Counts  k-CNF\nsolutions fast.' },
  manuscript: { title: 'ETH is false', abstract: 'We count.\n\nSecond paragraph.' }
}

describe('summaryPrompt', () => {
  it('leads with the title, then the main theorem in full', () => {
    const d = toy()
    const p = summaryPrompt(d)
    const main = d.nodes.find(n => n.id === d.root_ids[0])!
    expect(p.startsWith(`Paper: ${d.title}`)).toBe(true)
    const block = p.split('\n\n').find(b => b.startsWith('## Main theorem'))!
    expect(block).toContain(`name: ${main.name}`)
    expect(block).toContain('statement (paper, LaTeX):')
    expect(block).toContain('statement (plain):')
    expect(block).toContain('why it matters:')
    expect(p).not.toContain('Catalog family')
  })

  it('adds the family and abstract when linked, keeping abstract paragraphs', () => {
    const p = summaryPrompt(toy(), catalog)
    expect(p).toContain('Catalog family 378: Disproof of ETH\nCounts k-CNF solutions fast.')
    expect(p).toContain('We count.\n\nSecond paragraph.')
  })

  it('lists novel steps other than the main theorem, capped', () => {
    const d = toy()
    const extra = Array.from({ length: SUMMARY_NOVEL + 3 }, (_, i) => ({ ...d.nodes[1]!, id: `lem-x${i}`, name: `Novel ${i}`, classification: 'novel' as const }))
    d.nodes.push(...extra)
    const block = summaryPrompt(d).split('\n\n').find(b => b.startsWith('## Novel steps'))!
    const lines = block.split('\n').slice(1)
    expect(lines.length).toBe(SUMMARY_NOVEL)
    expect(block).not.toContain(`- ${d.nodes.find(n => n.id === d.root_ids[0])!.name}`)
  })

  it('names the top-level sections only', () => {
    const d = toy()
    const top = d.sections.filter(s => s.level === 1).map(s => s.title)
    expect(summaryPrompt(d)).toContain(`## Sections\n${top.join(' · ')}`)
  })
})

describe('attachSummary (finalize)', () => {
  it('writes the summary and returns its cost', async () => {
    const d = toy()
    const warnings: string[] = []
    const cost = await attachSummary(d, async () => ({ summary: { headline: 'h', proves: 'p', model: 'm', generated_at: 't' }, cost_usd: 0.02 }), async m => warnings.push(m))
    expect(cost).toBe(0.02)
    expect(d.summary?.headline).toBe('h')
    expect(warnings).toEqual([])
  })

  it('skips on failure: warns, leaves no summary, never throws', async () => {
    const d = toy()
    d.summary = { headline: 'stale', proves: 'stale', model: 'm', generated_at: 't' }
    const warnings: string[] = []
    const cost = await attachSummary(d, async () => {
      throw new Error('gateway 503')
    }, async m => warnings.push(m))
    expect(cost).toBe(0)
    expect(d.summary).toBeUndefined()
    expect(warnings).toEqual(['finalize · summary skipped: gateway 503'])
  })
})
