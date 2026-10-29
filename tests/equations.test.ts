import { describe, expect, it } from 'vitest'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { extractLabels, splitRows } from '../server/pipeline/latex/equations'
import { humanizeLabel, isPrefixed, resolveRef, texWithRefs } from '../app/utils/refs'
import type { PaperDigest } from '#shared/types'
import { ensureEthFixture, readFixtureDir } from './fixtures/fetch-fixtures'

const run = (files: { path: string, content: string }[]) => extractLabels(files, chunkLatex(files).skeleton)

describe('equation extraction: toy', () => {
  const { equations, labels } = run(readFixtureDir('toy'))

  it('finds the equation inside a lemma, with its number, section and location', () => {
    expect(equations['eq:deg']).toEqual({ latex: '\\#\\{x : p(x) = 0\\} \\le d .', number: '1', section: '1', file: 'sections/prelim.tex', line: 6 })
  })

  it('classifies statement and section labels', () => {
    expect(labels['lem:roots']).toMatchObject({ kind: 'statement', target: 'lem-roots' })
    expect(labels['sec:prelim']).toEqual({ kind: 'section', target: '1' })
    expect(labels['eq:deg']).toEqual({ kind: 'equation' })
  })
})

describe('equation extraction: numbering rules', () => {
  const tex = String.raw`\documentclass{amsart}
\numberwithin{equation}{section}
\newtheorem{theorem}[equation]{Theorem}
\begin{document}
\section{One}\label{sec:one}\label{sec:uno}
\begin{equation}\label{eq:a} a = b \end{equation}
\begin{theorem}\label{thm:t} x \end{theorem}
\begin{align}
x &= y \label{eq:row1} \\
  &= z \nonumber \\
  &= w \label{eq:row3}
\end{align}
\begin{equation*} c \tag{$\star$}\label{eq:star} \end{equation*}
\begin{align*} u &= v \label{eq:none} \end{align*}
\section{Two}
\begin{subequations}\label{eq:group}
\begin{gather} p \label{eq:p} \\ q \label{eq:q} \end{gather}
\end{subequations}
\begin{alignat}{2} m &= n &\quad& k \label{eq:at} \end{alignat}
\begin{figure}\label{fig:f}\end{figure}
\end{document}`
  const { equations, labels } = run([{ path: 'main.tex', content: tex }])
  const num = (l: string) => equations[l]?.number

  it('numbers per section, shares the counter with theorems, and walks align rows', () => {
    expect(num('eq:a')).toBe('1.1')
    expect(labels['thm:t']).toMatchObject({ kind: 'statement', number: '1.2' })
    expect(num('eq:row1')).toBe('1.3')
    expect(num('eq:row3')).toBe('1.4')
  })

  it('honours \\tag and leaves starred environments unnumbered', () => {
    expect(num('eq:star')).toBe('$\\star$')
    expect(equations['eq:none']).toBeDefined()
    expect(num('eq:none')).toBeUndefined()
  })

  it('subequations get letters; the group label gets the parent number and all the math', () => {
    expect(num('eq:group')).toBe('2.1')
    expect(num('eq:p')).toBe('2.1a')
    expect(num('eq:q')).toBe('2.1b')
    expect(equations['eq:group']!.latex).toContain('p')
    expect(num('eq:at')).toBe('2.2')
    expect(equations['eq:at']!.latex).toMatch(/^\\begin\{alignedat\}\{2\}/)
  })

  it('strips bookkeeping from the renderable latex and keeps every section label', () => {
    expect(equations['eq:row1']!.latex).toMatch(/^\\begin\{aligned\}/)
    expect(equations['eq:row1']!.latex).not.toMatch(/\\label|\\nonumber/)
    expect(labels['sec:one']).toEqual({ kind: 'section', target: '1' })
    expect(labels['sec:uno']).toEqual({ kind: 'section', target: '1' })
    expect(labels['fig:f']).toEqual({ kind: 'other' })
  })

  it('splits rows only at top-level \\\\', () => {
    expect(splitRows(String.raw`a \\ \substack{x\\y} \\ \begin{cases} 1 \\ 2 \end{cases}`)).toHaveLength(3)
  })
})

describe('equation extraction: ETH', async () => {
  const files = await ensureEthFixture()
  const { equations, labels } = run(files)

  it('resolves every \\ref target in the source, and numbers eq:solution-count (1.1)', () => {
    const targets = new Set(files.flatMap(f => [...f.content.matchAll(/\\(?:eq|c|C|auto)?ref\{([^}]*)\}/g)].flatMap(m => m[1]!.split(',').map(s => s.trim()))))
    expect([...targets].filter(t => !labels[t])).toEqual([])
    expect(equations['eq:solution-count']).toMatchObject({ number: '1.1', section: '1', file: 'main_full_version.tex', line: 67 })
    expect(Object.keys(equations).length).toBeGreaterThan(80)
  })
})

describe('client ref resolution', () => {
  const digest = {
    sections: [{ id: '3', title: 'Reduction', level: 1, order: 0, file: 'm.tex', line: 1 }],
    nodes: [{ id: 'lem-x', name: 'Sparsification', kind: 'lemma', paper_ref: { label: 'lem:x', section: '3', file: 'm.tex', line: 4 } }],
    equations: { 'eq:a': { latex: 'a=b', number: '3.2', section: '3', file: 'm.tex', line: 9 } },
    labels: { 'lem:x': { kind: 'statement', target: 'lem-x', number: '3.1' }, 'sec:r': { kind: 'section', target: '3' } }
  } as unknown as PaperDigest

  it('formats equations, statements, sections and unknown labels', () => {
    expect(resolveRef(digest, 'eq:a', 'eqref').text).toBe('(3.2)')
    expect(resolveRef(digest, 'eq:a', 'ref').text).toBe('3.2')
    expect(resolveRef(digest, 'lem:x', 'ref').text).toBe('Lemma 3.1')
    expect(resolveRef(digest, 'lem:x', 'ref', true).text).toBe('3.1')
    expect(resolveRef(digest, 'sec:r', 'ref')).toMatchObject({ text: '§3', nodeId: 'lem-x' })
    expect(resolveRef(digest, 'eq:solution-count', 'eqref')).toMatchObject({ kind: 'unknown', text: '(solution count)' })
    expect(humanizeLabel('subsec:related-sat')).toBe('related sat')
  })

  it('detects a kind word before the ref, and rewrites refs inside math', () => {
    expect(isPrefixed('by Lemma~')).toBe(true)
    expect(isPrefixed('Lemmas~\\ref{a} and~')).toBe(true)
    expect(isPrefixed('as defined in ')).toBe(false)
    expect(texWithRefs('x \\eqref{eq:a}', digest)).toBe('x \\text{(3.2)}')
  })
})
