import { describe, expect, it } from 'vitest'
import { boundsOf, centerView, constrainView, fitView, focusZoom, lodFor, visibleWorld } from '../app/utils/viewport'

describe('viewport math', () => {
  it('fit centers the box and caps the zoom', () => {
    const v = fitView({ x: 0, y: 0, w: 4000, h: 600 }, 1000, 600, { pad: 0, maxK: 1 })
    expect(v.k).toBeCloseTo(0.25)
    // the box's center lands on the viewport's center
    expect(2000 * v.k + v.x).toBeCloseTo(500)
    expect(300 * v.k + v.y).toBeCloseTo(300)
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, 1000, 600, { maxK: 1 }).k).toBe(1)
  })

  it('center puts a world point mid-viewport, and visibleWorld inverts the view', () => {
    const v = centerView({ x: 300, y: 200 }, 2, 800, 400)
    expect(300 * v.k + v.x).toBe(400)
    expect(visibleWorld(v, 800, 400)).toEqual({ x: 100, y: 100, w: 400, h: 200 })
  })

  it('bounds of rects, and null for none', () => {
    expect(boundsOf([{ x: 10, y: 5, w: 10, h: 10 }, { x: -5, y: 20, w: 5, h: 5 }])).toEqual({ x: -5, y: 5, w: 25, h: 20 })
    expect(boundsOf([])).toBeNull()
  })

  it('level of detail drops the role, then everything but the label', () => {
    expect(lodFor(1)).toBe('full')
    expect(lodFor(0.45)).toBe('compact')
    expect(lodFor(0.2)).toBe('label')
    expect(focusZoom(0.2)).toBe(0.9)
    expect(focusZoom(1.4)).toBe(1.4)
  })

  it('constrain keeps part of the drawing on screen and never changes the zoom', () => {
    const lost = constrainView({ x: -10_000, y: 5000, k: 1 }, 2000, 500, 800, 600, 80)
    expect(lost.k).toBe(1)
    expect(lost.x + 2000).toBe(80) // right edge 80px into the viewport
    expect(lost.y).toBe(600 - 80) // top edge 80px above the bottom
    const fine = { x: -300, y: 20, k: 1 }
    expect(constrainView(fine, 2000, 500, 800, 600)).toEqual(fine)
  })
})
