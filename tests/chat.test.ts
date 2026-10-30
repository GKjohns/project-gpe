import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { splitCitations, toChatMarkdown } from '../app/utils/chatText'
import { toyDigest } from '../server/fixtures/toy-digest'
import type { PaperFigure } from '#shared/types'
import { resolveRef } from '../app/utils/refs'
import { chatInstructions, citedIds, figureLine, figureLines, serializeDigest, trimHistory } from '../server/utils/chat'

const user = (text: string): ModelMessage => ({ role: 'user', content: text })
const assistant = (text: string): ModelMessage => ({ role: 'assistant', content: [{ type: 'text', text }] })

describe('chat instructions', () => {
  it('serializes every node with its id, deps and used-by', () => {
    const s = serializeDigest(toyDigest)
    for (const n of toyDigest.nodes) {
      expect(s).toContain(`[${n.id} · ${n.kind}`)
    }
    expect(s).toContain('used by: ')
    expect(chatInstructions(toyDigest)).toContain('[[thm-main]]')
  })

  it('extracts cited ids once each', () => {
    expect(citedIds('see [[a]] and [[b-1]], again [[a]]; not [[ x ]]')).toEqual(['a', 'b-1'])
  })
})

const figure = (extra: Partial<PaperFigure> = {}): PaperFigure => ({
  id: 'fig-intervals', label: 'fig:intervals', number: '2', caption: 'The intervals $I_-$ and $I_+$.', section: '1', file: 'main.tex', line: 40,
  page: 7, graphics: [], tikz: true, kind: 'schematic', description: 'Two intervals on a line.\n  The left one is shaded.', node_ids: ['lem-roots', 'thm-main'], confidence: 0.9, ...extra
})

describe('figures in the digest', () => {
  it('writes one compact line per figure: number, cite key, kind, page, section, description, supports', () => {
    expect(figureLine(figure())).toBe('Figure 2 · \\ref{fig:intervals} · schematic · p. 7 · §1 · Two intervals on a line. The left one is shaded. · supports [[lem-roots]], [[thm-main]]')
    // No label → cited by id; no page; caption stands in for a missing description.
    expect(figureLine(figure({ label: undefined, page: undefined, description: '', node_ids: [] }))).toBe('Figure 2 · \\ref{fig-intervals} · schematic · §1 · The intervals $I_-$ and $I_+$.')
  })

  it('trims long descriptions at a word and caps the figures block', () => {
    const long = figureLine(figure({ description: 'word '.repeat(200) }))
    expect(long).toMatch(/word…/)
    expect(long.length).toBeLessThan(400)
    const many = { ...toyDigest, figures: Array.from({ length: 60 }, (_, i) => figure({ id: `fig-${i}`, label: undefined, number: String(i + 1), description: 'x'.repeat(290) })) }
    const lines = figureLines(many)
    expect(lines.join('\n').length).toBeLessThan(8_200)
    expect(lines.at(-1)).toMatch(/^… \d+ more figures/)
  })

  it('puts figures in the instructions only when the paper has them', () => {
    const withFigs = { ...toyDigest, figures: [figure()] }
    expect(serializeDigest(withFigs)).toContain('Figures (')
    expect(chatInstructions(withFigs)).toContain('\\ref{fig:intervals}')
    expect(serializeDigest(toyDigest)).not.toContain('Figures (')
    expect(chatInstructions(toyDigest)).toContain('no figures')
  })

  it('resolves a figure chip by label (via labels) and by id (unlabeled figures)', () => {
    const d = { ...toyDigest, figures: [figure(), figure({ id: 'fig-3', label: undefined, number: '3' })], labels: { 'fig:intervals': { kind: 'figure' as const, number: '2', target: 'fig-intervals' } } }
    expect(resolveRef(d, 'fig:intervals')).toMatchObject({ kind: 'figure', text: 'Figure 2' })
    expect(resolveRef(d, 'fig-3')).toMatchObject({ kind: 'figure', text: 'Figure 3' })
    expect(resolveRef(d, 'fig-9').kind).toBe('unknown')
  })
})

describe('trimHistory', () => {
  it('keeps everything under the ceiling', () => {
    const msgs = [user('q1'), assistant('a1'), user('q2')]
    expect(trimHistory(msgs, 100)).toEqual(msgs)
  })

  it('drops the oldest turns at user boundaries and always keeps the last question', () => {
    const msgs = [user('x'.repeat(50)), assistant('y'.repeat(50)), user('q2'), assistant('a2'), user('q3')]
    const out = trimHistory(msgs, 20)
    expect(out[0]).toEqual(user('q2'))
    expect(trimHistory(msgs, 1)).toEqual([user('q3')])
  })
})

describe('chat markdown', () => {
  it('leaves complete citations for the Comark citations plugin', () => {
    expect(toChatMarkdown('By ([[lem-hash]], [[thm-main]]).', true)).toBe('By ([[lem-hash]], [[thm-main]]).')
  })

  it('keeps math that starts with a digit as math and converts \\(…\\)', () => {
    expect(toChatMarkdown('time $2^{n/\\sqrt{\\log n}}$ vs $n$')).toBe('time ${}2^{n/\\sqrt{\\log n}}$ vs $n$')
    expect(toChatMarkdown('\\(x^2\\)')).toBe('$x^2$')
  })

  it('hides a half-streamed citation only while streaming', () => {
    expect(toChatMarkdown('uses [[lem-sp', true)).toBe('uses ')
    expect(toChatMarkdown('uses [[lem-sp')).toBe('uses [[lem-sp')
  })

  it('splits user text around citations', () => {
    expect(splitCitations('Explain [[lem-hash]] please')).toEqual([{ text: 'Explain ' }, { id: 'lem-hash' }, { text: ' please' }])
  })
})
