import { describe, expect, it } from 'vitest'
import { flattenLists, liftMathOutOfStyles, normalizeTexProse } from '../app/utils/texProse'
import { renderTex, repairTexEscapes } from '../app/utils/katex'

describe('liftMathOutOfStyles', () => {
  it('moves math out of \\emph so the prose pieces keep their style', () => {
    expect(liftMathOutOfStyles('an \\emph{$(r,\\tau,D)$-design at $t$} consists'))
      .toBe('an $(r,\\tau,D)$\\emph{-design at }$t$ consists')
  })

  it('handles \\(…\\) delimiters and leaves plain \\emph alone', () => {
    expect(liftMathOutOfStyles('the \\emph{true}, unhashed \\textbf{at most \\(t^{9/10}\\) points}'))
      .toBe('the \\emph{true}, unhashed \\textbf{at most }\\(t^{9/10}\\)\\textbf{ points}')
  })

  it('respects nested braces inside the styled group', () => {
    expect(liftMathOutOfStyles('\\emph{$\\mathbb{Q}$-linear {maps}} end')).toBe('$\\mathbb{Q}$\\emph{-linear {maps}} end')
  })
})

describe('flattenLists', () => {
  it('drops list environments and marks each item', () => {
    expect(flattenLists('four conditions:\n\\begin{enumerate}\n\\item \\emph{Small groups.} Partition\n\\item[(b)] Next\n\\end{enumerate}'))
      .toBe('four conditions:\n\n\\item{}\\emph{Small groups.} Partition\n\n\\item{(b)}Next\n')
  })

  it('composes', () => {
    expect(normalizeTexProse('\\begin{itemize}\\item \\emph{$x$ big}\\end{itemize}')).toBe('\n\\item{}$x$\\emph{ big}')
  })
})

describe('repairTexEscapes', () => {
  it('reads control characters back as the commands they came from', () => {
    expect(repairTexEscapes('W_l(\bar x_l)')).toBe('W_l(\\bar x_l)')
    expect(repairTexEscapes('\u0007lpha h+\\beta y=1')).toBe('\\alpha h+\\beta y=1')
    expect(repairTexEscapes('\frac{a}{b} \times \nu \rho')).toBe('\\frac{a}{b} \\times \\nu \\rho')
  })

  it('keeps ordinary line breaks', () => {
    expect(repairTexEscapes('x = y\nand z\n  \\quad w')).toBe('x = y\nand z\n  \\quad w')
  })

  it('renders through KaTeX without an error span', () => {
    expect(renderTex('W_l(\bar x_l)', false)).not.toContain('katex-error')
    expect(renderTex('W_l(\bar x_l)', false)).toContain('ˉ')
  })
})
