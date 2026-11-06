import { describe, expect, it } from 'vitest'
import { plainMath } from '../app/utils/headline'

describe('plainMath', () => {
  it('turns the ETH headline into readable text', () => {
    expect(plainMath('For fixed k, counts k-CNF solutions deterministically in $2^{O_k(n\\log\\log n/\\sqrt{\\log n})}$ time, refuting ETH'))
      .toBe('For fixed k, counts k-CNF solutions deterministically in 2^(O_k(n log log n/√(log n))) time, refuting ETH')
  })

  it('maps symbols, blackboard letters and single-character scripts', () => {
    expect(plainMath('$x_{i} \\le \\varepsilon$ over $\\mathbb{R}^n$')).toBe('x_i ≤ ε over ℝ^n')
    expect(plainMath('$\\Omega(n^{2})$ steps')).toBe('Ω(n^2) steps')
  })

  it('leaves prose without math alone', () => {
    expect(plainMath('No math here.')).toBe('No math here.')
  })
})
