import { describe, expect, it } from 'vitest'
import { chunkLatex } from '../server/pipeline/latex/chunk'
import { extractFigures, graphicsPaths, resolveGraphic } from '../server/pipeline/latex/figures'
import { citedBy, logErrors, nodeSpans, pickEngine } from '../server/pipeline/stages/render'

const MAIN = String.raw`\documentclass{article}
\usepackage{graphicx,tikz,subcaption}
\graphicspath{{figs/}{img/}}
\numberwithin{figure}{section}
\newtheorem{lemma}{Lemma}
\begin{document}
\section{Intro}
Text before. % \begin{figure}\caption{commented out}\end{figure}
\begin{figure}[t]
  \centering
  \includegraphics[width=0.5\textwidth]{plot}
  \caption[Short]{Error against $n$; see \cref{lem:a}.}
  \label{fig:plot}
\end{figure}
\begin{lemma}\label{lem:a}
As \cref{fig:plot} shows, it decays.
\end{lemma}
\begin{proof}
Compare Figure~\ref{fig:pair} and Figure~\ref{fig:tikz}.
\end{proof}
\section{More}
\begin{figure*}
  \begin{subfigure}{0.4\textwidth}\includegraphics{left.png}\caption{Left}\label{fig:pair-a}\end{subfigure}
  \begin{subfigure}{0.4\textwidth}\includegraphics{right}\caption{Right}\end{subfigure}
  \caption{A pair.}\label{fig:pair}
\end{figure*}
\input{tikzfig}
\begin{figure}\centering\includegraphics{missing}\end{figure}
\end{document}
`
const TIKZ = String.raw`\begin{figure}
\begin{tikzpicture}\draw (0,0) -- (1,1) node {$x$};\end{tikzpicture}
\caption{Drawn in TeX.}
\label{fig:tikz}
\end{figure}
`
const files = [{ path: 'main.tex', content: MAIN }, { path: 'tikzfig.tex', content: TIKZ }]
const assets = ['figs/plot.pdf', 'img/left.png', 'img/right.jpg', 'plot.png']

describe('graphics resolution', () => {
  it('reads \\graphicspath and resolves extensionless refs the way pdfLaTeX would (.pdf before .png)', () => {
    expect(graphicsPaths(MAIN)).toEqual(['figs/', 'img/'])
    expect(resolveGraphic('plot', assets, 'main.tex', ['figs/', 'img/'])).toBe('plot.png') // the main dir wins over \graphicspath
    expect(resolveGraphic('plot', ['figs/plot.pdf', 'figs/plot.png'], 'main.tex', ['figs/'])).toBe('figs/plot.pdf')
    expect(resolveGraphic('right', assets, 'main.tex', ['figs/', 'img/'])).toBe('img/right.jpg')
    expect(resolveGraphic('fig.png', ['paper/fig.png'], 'paper/main.tex')).toBe('paper/fig.png')
    expect(resolveGraphic('nope', assets, 'main.tex', ['figs/'])).toBeUndefined()
  })
})

describe('extractFigures', () => {
  const { skeleton } = chunkLatex(files)
  const figs = extractFigures(files, skeleton, assets)

  it('finds every figure environment, \\input ones included, and skips commented-out ones', () => {
    expect(figs.map(f => f.id)).toEqual(['fig-plot', 'fig-pair', 'fig-tikz', 'fig-4'])
  })

  it('numbers figures within sections (\\numberwithin), only when captioned', () => {
    expect(figs.map(f => f.number)).toEqual(['1.1', '2.1', '2.2', undefined])
  })

  it('keeps the main caption, subcaptions apart, and every label', () => {
    const [plot, pair] = figs
    expect(plot!.caption).toBe('Error against $n$; see \\cref{lem:a}.')
    expect(pair!.caption).toBe('A pair.')
    expect(pair!.subcaptions).toEqual(['Left', 'Right'])
    expect(pair!.label).toBe('fig:pair')
    expect(pair!.labels).toEqual(['fig:pair-a', 'fig:pair'])
  })

  it('resolves graphics, flags TeX-drawn figures, and records source spans across files', () => {
    expect(figs[0]!.graphics).toEqual([{ ref: 'plot', path: 'plot.png' }])
    expect(figs[1]!.graphics.map(g => g.path)).toEqual(['img/left.png', 'img/right.jpg'])
    expect(figs[3]!.graphics).toEqual([{ ref: 'missing' }])
    expect(figs.map(f => f.tikz)).toEqual([false, false, true, false])
    expect(figs[2]!.file).toBe('tikzfig.tex')
    expect(figs[2]!.spans).toEqual([{ file: 'tikzfig.tex', start: 1, end: 5 }])
    expect(figs[2]!.caption_span).toEqual({ file: 'tikzfig.tex', start: 3, end: 3 })
    expect(figs[0]!.caption_span).toEqual({ file: 'main.tex', start: 12, end: 12 })
    expect(figs[0]!.section).toBe(skeleton.sections[0]!.id)
  })

  it('gives the vision prompt the prose around the figure and its \\refs', () => {
    expect(figs[0]!.context).toContain('Text before.')
    expect(figs[0]!.context).toContain('As \\cref{fig:plot} shows')
    expect(figs[2]!.body).toContain('\\draw (0,0) -- (1,1)')
  })

  it('links a figure to the nodes whose statement or proof cites it', () => {
    const nodes = skeleton.statements.map(s => ({ id: s.label.replace(':', '-'), paper_ref: { file: s.file, line: s.startLine, section: s.sectionId }, parent_id: undefined }))
    const spans = nodeSpans(nodes as never, skeleton, null)
    expect(citedBy(figs[0]!, files, spans)).toEqual(['lem-a'])
    expect(citedBy(figs[1]!, files, spans)).toEqual(['lem-a']) // cited from the proof
    expect(citedBy(figs[3]!, files, spans)).toEqual([])
  })
})

describe('render helpers', () => {
  it('picks the engine the source asks for', () => {
    expect(pickEngine('\\documentclass{article}', '')).toBe('pdflatex')
    expect(pickEngine('% !TEX program = xelatex\n\\documentclass{article}', '')).toBe('xelatex')
    expect(pickEngine('', '\\usepackage{fontspec}')).toBe('xelatex')
    expect(pickEngine('', '\\usepackage[math-style=ISO]{unicode-math}')).toBe('xelatex')
    expect(pickEngine('', '\\directlua{tex.print(1)}')).toBe('lualatex')
  })

  it('pulls the error lines out of a LaTeX log', () => {
    const log = 'This is pdfTeX\n./main.tex:12: Undefined control sequence.\nl.12 \\foo\n! Emergency stop.\n<*> main.tex\nnoise'
    expect(logErrors(log)).toEqual(['./main.tex:12: Undefined control sequence. l.12 \\foo', '! Emergency stop. <*> main.tex'])
  })
})

describe('figure assets in sources', async () => {
  const { isAsset, capAssets, summarize, MAX_ASSET_BYTES } = await import('../server/pipeline/sources/main')
  const { filesFromUpload } = await import('../server/pipeline/sources/upload')
  const { zipSync, strToU8 } = await import('fflate')

  it('keeps graphics and compile helpers as binary assets, not text sources', () => {
    expect(['figs/a.PNG', 'b.pdf', 'c.eps', 'd.svg', 'e.tikz', 'f.dat', 'g.bst'].every(isAsset)).toBe(true)
    expect(['main.tex', 'refs.bib', '__MACOSX/x.png', 'dir/.DS_Store.png', 'notes.docx'].some(isAsset)).toBe(false)
  })

  it('caps asset sizes and counts only LaTeX toward the size estimate', () => {
    const big = { path: 'huge.png', content: '', data: new Uint8Array(MAX_ASSET_BYTES + 1) }
    const small = { path: 'a.png', content: '', data: new Uint8Array(10) }
    expect(capAssets([big, small])).toEqual({ kept: [small], skipped: ['huge.png'] })
    const s = summarize([{ path: 'main.tex', content: 'x'.repeat(3100) }, small])
    expect(s.estTokens).toBe(1000)
    expect(s.files).toEqual([{ path: 'main.tex', bytes: 3100 }, { path: 'a.png', bytes: 10 }])
  })

  it('takes images out of an uploaded zip', () => {
    const zip = zipSync({ 'main.tex': strToU8('\\documentclass{article}'), 'figs/a.png': new Uint8Array([1, 2, 3]), 'notes.txt': strToU8('x') })
    const files = filesFromUpload([{ filename: 'paper.zip', data: zip }])
    expect(files.map(f => [f.path, !!f.data])).toEqual([['main.tex', false], ['figs/a.png', true]])
  })
})

describe('figure refs (app/utils/refs.ts)', async () => {
  const { resolveRef } = await import('../app/utils/refs')
  const { figureLabels } = await import('../server/pipeline/stages/finalize')
  const figure = { id: 'fig-pair', number: '2.1', caption: 'A pair.', section: '2', file: 'main.tex', line: 20, graphics: [], tikz: false, kind: 'plot' as const, description: 'd', node_ids: [], confidence: 0.8 }
  const labels: Record<string, { kind: 'figure' | 'other', target?: string, number?: string }> = { 'fig:pair': { kind: 'other' }, 'fig:pair-a': { kind: 'other' } }
  figureLabels(labels as never, [figure], new Map([['fig-pair', ['fig:pair-a', 'fig:pair']]]))
  const digest = { nodes: [], sections: [], labels, figures: [figure] } as never

  it('classifies every label inside a figure as that figure, numbered', () => {
    expect(labels['fig:pair-a']).toEqual({ kind: 'figure', target: 'fig-pair', number: '2.1' })
  })

  it('renders "Figure 2.1", or the bare number after "Figure~"', () => {
    expect(resolveRef(digest, 'fig:pair', 'ref')).toMatchObject({ kind: 'figure', text: 'Figure 2.1', figure: { id: 'fig-pair' } })
    expect(resolveRef(digest, 'fig:pair', 'ref', true).text).toBe('2.1')
    expect(resolveRef(digest, 'fig:pair', 'Cref').text).toBe('Figure 2.1')
  })
})
