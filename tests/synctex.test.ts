import { describe, expect, it } from 'vitest'
import { figureRect, mergeRects, parseSynctex, projectPath, rectsForLines } from '../server/pipeline/latex/synctex'
import { anchorsFromSynctex } from '../server/pipeline/stages/render'

// sp → PDF points
const bp = (sp: number) => sp / 65536 * 72 / 72.27

// A two-page synctex: paragraph lines with glyph/math leaves, a kern-only line, an image hbox and a caption in a
// figure file, a nested hbox, a system-file leaf, a page number set at shipout, and page vboxes tagged with
// whatever line was current.
const SYNCTEX = `SyncTeX Version:1
Input:1:/vercel/sandbox/render/src/./main.tex
Input:2:/usr/share/texlive/texmf-dist/tex/latex/base/size11.clo
Input:3:/vercel/sandbox/render/src/./figs/f.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,40:4736286,49092118:30549036,44355832,0
(1,12:4736286,6000000:30000000,600000,200000
x1,12:4900000,6000000
x1,10:5000000,6000000
$1,11:6000000,6000000
x2,99:7000000,6000000
)
(1,12:4736286,7000000:30000000,600000,200000
x1,12:5000000,7000000
k1,13:5000000,7000000:100000
)
(1,13:4736286,9000000:30000000,600000,200000
g1,13:5000000,9000000
)
(3,2:10000000,16000000:9000000,6000000,0
)
(1,30:4736286,17000000:30000000,600000,200000
x3,4:5000000,17000000
)
]
(1,10:30000000,50500000:1000000,500000,0
x1,10:30000000,50500000
)
}1
{2
[1,50:4736286,49092118:30549036,44355832,0
(1,20:4736286,6000000:30000000,600000,200000
(1,20:5000000,6000000:1000000,600000,0
x1,21:5000000,6000000
)
)
]
}2
Postamble:
`
const index = parseSynctex(SYNCTEX, '/vercel/sandbox/render/src')

describe('parseSynctex', () => {
  it('keeps project files only, relative to the compile root', () => {
    expect(index.files).toEqual(['main.tex', 'figs/f.tex'])
    expect(index.pages).toBe(2)
    expect(projectPath('/vercel/sandbox/render/src/build/./sections/a.tex', '/vercel/sandbox/render/src')).toBe('build/sections/a.tex')
    expect(projectPath('/usr/share/texlive/x.sty', '/vercel/sandbox/render/src')).toBeNull()
  })

  it('maps source lines to the typeset lines that carry their glyphs, in PDF points from the top-left', () => {
    const [r] = rectsForLines(index, 'main.tex', 10, 10)
    expect(r!.page).toBe(1)
    expect(r!.x).toBeCloseTo(bp(4736286), 0)
    expect(r!.y).toBeCloseTo(bp(6000000 - 600000), 0)
    expect(r!.w).toBeCloseTo(bp(30000000), 0)
    expect(r!.h).toBeCloseTo(bp(800000), 0)
    // math leaves count too
    expect(rectsForLines(index, 'main.tex', 11, 11)).toHaveLength(1)
  })

  it('does not credit a line box to the paragraph-ending line its first glyph is tagged with', () => {
    // box 1 is tagged 12 (where its paragraph ended) but its other leaves say 10–11; box 2 is all line 12
    const rects = rectsForLines(index, 'main.tex', 12, 12)
    expect(rects).toHaveLength(1)
    expect(rects[0]!.y).toBeCloseTo(bp(7000000 - 600000), 0)
  })

  it('merges adjacent lines into one block and ignores kerns, glue and page boxes', () => {
    expect(rectsForLines(index, 'main.tex', 10, 12)).toHaveLength(1)
    expect(rectsForLines(index, 'main.tex', 13, 13)).toEqual([]) // kern + glue only
    expect(rectsForLines(index, 'main.tex', 40, 50)).toEqual([]) // page vboxes inherit the current line
    // the page number below the body carries line 10 too (set at shipout) and is ignored
    expect(rectsForLines(index, 'main.tex', 10, 10)).toHaveLength(1)
    expect(index.bodies![1]).toEqual({ y0: expect.closeTo(bp(4736286), 1), y1: expect.closeTo(bp(49092118), 1) })
  })

  it('credits a nested box\'s lines to the typeset line around it', () => {
    const rects = rectsForLines(index, 'main.tex', 21, 21)
    expect(rects).toHaveLength(1)
    expect(rects[0]!.page).toBe(2)
    expect(rects[0]!.w).toBeCloseTo(bp(30000000), 0)
  })

  it('anchors nodes: statement and proof parts, nothing for an untypeset span', () => {
    const anchors = anchorsFromSynctex(index, new Map([
      ['lem-a', { statement: { file: 'main.tex', start: 10, end: 11 }, proof: { file: 'main.tex', start: 12, end: 12 } }],
      ['claim-x', { statement: { file: 'main.tex', start: 21, end: 21 } }],
      ['ghost', { statement: { file: 'main.tex', start: 500, end: 510 } }]
    ]))
    expect(anchors['lem-a']!.map(a => a.part)).toEqual(['statement', 'proof'])
    expect(anchors['claim-x']![0]!.page).toBe(2)
    expect(anchors.ghost).toBeUndefined()
  })
})

describe('figureRect', () => {
  const spans = [{ file: 'figs/f.tex', start: 1, end: 5 }]

  it('covers the image box created at \\includegraphics and the caption', () => {
    const r = figureRect(index, spans)!
    expect(r.page).toBe(1)
    expect(r.y).toBeCloseTo(bp(16000000 - 6000000), 0)
    expect(r.y + r.h).toBeCloseTo(bp(17000000 + 200000), 0)
  })

  it('leaves the caption out when asked, unless nothing else was recorded', () => {
    const r = figureRect(index, spans, undefined, { file: 'figs/f.tex', start: 4, end: 4 })!
    expect(r.x).toBeCloseTo(bp(10000000), 0)
    expect(r.h).toBeCloseTo(bp(6000000), 0)
    expect(figureRect(index, [{ file: 'figs/f.tex', start: 4, end: 4 }], undefined, { file: 'figs/f.tex', start: 4, end: 4 })).not.toBeNull()
    expect(figureRect(index, [{ file: 'nope.tex', start: 1, end: 9 }])).toBeNull()
  })
})

describe('mergeRects', () => {
  it('joins vertically adjacent rects per column, not across columns or pages', () => {
    const out = mergeRects([
      { page: 1, x: 50, y: 100, w: 200, h: 10 },
      { page: 1, x: 50, y: 112, w: 200, h: 10 },
      { page: 1, x: 320, y: 100, w: 200, h: 10 },
      { page: 2, x: 50, y: 100, w: 200, h: 10 }
    ])
    expect(out).toEqual([
      { page: 1, x: 50, y: 100, w: 200, h: 22 },
      { page: 1, x: 320, y: 100, w: 200, h: 10 },
      { page: 2, x: 50, y: 100, w: 200, h: 10 }
    ])
  })
})
