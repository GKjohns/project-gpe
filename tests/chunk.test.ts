import { describe, expect, it } from 'vitest'
import { chunkLatex, stripComment } from '../server/pipeline/latex/chunk'
import { detectMainFile } from '../server/pipeline/sources/main'
import { ensureEthFixture, readFixtureDir } from './fixtures/fetch-fixtures'

describe('chunker: toy with \\input', () => {
  const { skeleton: s, warnings } = chunkLatex(readFixtureDir('toy'))

  it('inlines \\input and keeps per-file line numbers', () => {
    expect(s.mainFile).toBe('main.tex')
    expect(warnings).toEqual([])
    const def = s.statements.find(x => x.label === 'def:poly')!
    expect(def).toMatchObject({ file: 'sections/prelim.tex', startLine: 1, endLine: 3, title: 'Polynomial', sectionId: '1' })
    expect(s.statements.find(x => x.label === 'lem:roots')!.proof).toEqual({ file: 'sections/prelim.tex', startLine: 10, endLine: 13, lines: 4 })
    expect(s.statements.find(x => x.label === 'thm:main')).toMatchObject({ file: 'main.tex', startLine: 13, sectionId: '2', number: '1' })
  })

  it('strips comments but not \\%', () => {
    expect(stripComment('100\\% sure % gone')).toBe('100\\% sure ')
    expect(s.statements.map(x => x.label)).not.toContain('lem:commented')
    expect(s.statements.find(x => x.label === 'thm:main')!.body).toContain('100\\%')
    expect(s.refs.map(r => r.toLabel)).not.toContain('lem:bogus')
  })

  it('collects sections, macros, refs and unresolved', () => {
    expect(s.sections.map(x => [x.id, x.title, x.level])).toEqual([['1', 'Preliminaries', 1], ['2', 'Main result', 1]])
    expect(s.macros).toEqual({ '\\F': '\\mathbb{F}', '\\norm': '\\lVert #1 \\rVert', '\\rank': '\\operatorname{rank}' })
    expect(s.refs.map(r => `${r.fromLabel}>${r.toLabel}`)).toEqual(['lem:roots>def:poly', 'thm:main>lem:roots', 'thm:main>def:poly'])
    expect(s.unresolved).toEqual([{ fromLabel: 'thm:main', target: 'eq:deg' }, { fromLabel: 'thm:main', target: 'sec:prelim' }])
  })

  it('labels unlabeled statements synthetically, never from a nested equation', () => {
    expect(s.statements.find(x => x.label === 'lem:roots')).toBeTruthy()
    expect(s.statements.at(-1)!.label).toBe('unlabeled-2-1')
    expect(s.statements.at(-1)!.proof).toBeUndefined()
  })
})

describe('chunker: shared \\newtheorem counters', () => {
  const { skeleton: s } = chunkLatex(readFixtureDir('shared-counter'))
  const num = (label: string) => s.statements.find(x => x.label === label)?.number

  it('emulates shared, independent, per-section and appendix numbering', () => {
    expect([num('def:a'), num('lem:a'), num('thm:a'), num('cl:a')]).toEqual(['1.1', '1.2', '1.3', '1'])
    expect([num('lem:b'), num('cl:b'), num('cor:b')]).toEqual(['2.1', '2', '2.2'])
    expect(num('lem:app')).toBe('A.1')
    expect(s.statements.find(x => x.env === 'remark*')).toMatchObject({ label: 'unlabeled-2.1-1' })
    expect(s.statements.find(x => x.env === 'remark*')!.number).toBeUndefined()
    expect(s.sections.map(x => x.id)).toEqual(['1', '2', '2.1', 'A'])
    expect(s.sections.find(x => x.id === '2.1')!.parent_id).toBe('2')
  })

  it('attaches "Proof of Theorem~\\ref{x}" to x and scans nested proofs separately', () => {
    expect(s.statements.find(x => x.label === 'thm:a')!.proof).toBeTruthy()
    expect(s.statements.find(x => x.label === 'cor:b')!.proof).toBeUndefined()
    const edges = s.refs.map(r => `${r.fromLabel}>${r.toLabel}`)
    expect(edges).toEqual(['lem:a>def:a', 'thm:a>lem:a', 'thm:a>lem:b', 'thm:a>cl:a', 'cl:inner>cor:b', 'lem:app>thm:a'])
  })
})

describe('chunker: ETH (openai/math #378)', async () => {
  const files = await ensureEthFixture()
  const { skeleton: s, warnings } = chunkLatex(files)

  it('finds the main file and every include', () => {
    expect(detectMainFile(files)).toBe('main_full_version.tex')
    expect(s.files).toHaveLength(4)
    expect(warnings).toEqual(['thm:main has a second proof at quantitative-reduction.tex:317; keeping the first span'])
  })

  // The plan's 10 / 44 / 161 came from the storyboard; these are the real source's counts (see plan § Sprint 2 deviations).
  it('has 10 top-level sections, 36 statements (35 labeled), 40 statement refs inside proofs', () => {
    expect(s.sections.filter(x => x.level === 1)).toHaveLength(10)
    expect(s.sections.filter(x => x.level === 1).map(x => x.id)).toEqual(['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D'])
    expect(s.statements).toHaveLength(36)
    expect(s.statements.filter(x => !x.label.startsWith('unlabeled-'))).toHaveLength(35)
    expect(s.refs).toHaveLength(40)
  })

  it('attaches proofs, including across files', () => {
    expect(s.statements.find(x => x.label === 'lem:sparse-checks')!.proof).toMatchObject({ file: 'main_full_version.tex', startLine: 3280, lines: 158 })
    expect(s.statements.find(x => x.label === 'thm:tensor-contraction')!.proof).toMatchObject({ file: 'quantitative-contraction.tex', startLine: 560 })
    // lem:sparsify is proved by Appendix A as a whole, not by a proof environment.
    expect(s.statements.find(x => x.label === 'lem:sparsify')!.proof).toBeUndefined()
    expect(s.statements.filter(x => (x.proof?.lines ?? 0) >= 60).length).toBeGreaterThanOrEqual(8)
  })

  it('numbers statements like amsart does and reads the preamble macros', () => {
    expect(s.statements.find(x => x.label === 'thm:main')!.number).toBe('1.1')
    expect(s.statements.find(x => x.label === 'lem:sparsify')!.number).toBe('6.3')
    expect(s.statements.find(x => x.label === 'thm:tensor-contraction')!.number).toBe('D.1')
    expect(s.macros).toMatchObject({ '\\poly': '\\operatorname{poly}', '\\Prob': '\\mathbb P', '\\Bin': '\\operatorname{Bin}' })
  })
})

describe('chunker: a section titled "Proof of Lemma \\ref{x}" is x\'s proof (Sprint 8)', () => {
  const tex = [
    '\\documentclass{article}',
    '\\newtheorem{lemma}{Lemma}',
    '\\begin{document}',
    '\\section{Intro}',
    '\\begin{lemma}\\label{lem:a}A.\\end{lemma}',
    '\\begin{lemma}\\label{lem:b}B.\\end{lemma}',
    '\\begin{proof}Uses Lemma~\\ref{lem:a}.\\end{proof}',
    '\\section{Proof of Lemma \\ref{lem:a}}',
    'We use Lemma~\\ref{lem:c}.',
    '\\begin{lemma}\\label{lem:c}C.\\end{lemma}',
    '\\begin{proof}Direct, by Lemma~\\ref{lem:b}.\\end{proof}',
    'Hence the claim.',
    '\\section{Other}',
    'Text mentioning \\ref{lem:b}.',
    '\\end{document}'
  ].join('\n')
  const { skeleton: s } = chunkLatex([{ path: 'p.tex', content: tex }])
  const st = (l: string) => s.statements.find(x => x.label === l)!

  it('attaches the section body as the proof and scans its refs, skipping nested proofs', () => {
    expect(st('lem:a').proof).toMatchObject({ startLine: 8, endLine: 12 })
    expect(st('lem:c').proof?.startLine).toBe(11)
    expect(s.refs.map(r => `${r.fromLabel}>${r.toLabel}`).sort()).toEqual(['lem:a>lem:c', 'lem:b>lem:a', 'lem:c>lem:b'])
  })
})
