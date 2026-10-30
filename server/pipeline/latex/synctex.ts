// SyncTeX → a compact source-line ↔ PDF-box index, and the lookups the reader needs (where a statement or a figure
// sits on the page). Pure, no Nitro imports. Format: https://github.com/jlaurens/synctex (records are
// `[tag,line:h,v:W,H,D` vbox, `(…` hbox, `x/k/g/$/r…` leaves inside the current box; units are TeX sp from the
// page's top-left corner, at Magnification/1000 · Unit).

/** One rectangle on a PDF page, in PDF points with a top-left origin. */
export interface PageRect { page: number, x: number, y: number, w: number, h: number }

/**
 * A box the index keeps. `leaf`: an hbox whose glyphs/kerns/glue came from lines l0..l1 of `file` (a typeset line,
 * or a piece of one); `own`: an hbox created while `line` was being read (the box graphicx wraps an image in, a
 * TikZ picture).
 */
export interface SyncBox extends PageRect { file: number, l0: number, l1: number, own: boolean }

export interface SyncIndex {
  files: string[] // project-relative paths; box.file indexes this
  pages: number
  pageSize?: { w: number, h: number } // the first page's, when known
  boxes: SyncBox[]
  /**
   * Per page, the text body's vertical extent (the output box: text, floats, footnotes). Running heads and page
   * numbers sit outside it, and their glyphs carry whatever line TeX was reading at shipout, so they are ignored.
   */
  bodies?: Record<number, { y0: number, y1: number }>
}

const SP_PER_BP = 65536 * 72.27 / 72

/** Strips the compile directory so tags read like the stored sources ('sections/a.tex'). Null for system files. */
export function projectPath(path: string, root: string): string | null {
  const r = root.endsWith('/') ? root : `${root}/`
  if (!path.startsWith(r)) {
    return null
  }
  const rel = path.slice(r.length).replace(/^(\.\/)+/, '').replace(/\/\.\//g, '/')
  return rel && !rel.startsWith('../') ? rel : null
}

type Lines = Map<number, [number, number]>
// leaf: every glyph/math leaf; other: those not tagged with the box's own tag/line (see the leaf comment below).
interface Open { kind: 'h' | 'v', tag: number, line: number, x: number, y: number, w: number, h: number, d: number, leaf: Lines, other: Lines }

const widen = (map: Lines, file: number, l0: number, l1: number) => {
  const cur = map.get(file)
  map.set(file, cur ? [Math.min(cur[0], l0), Math.max(cur[1], l1)] : [l0, l1])
}

/**
 * Parses an uncompressed .synctex. `root` is the directory the paper was compiled in (tags outside it are TeX's own
 * files and are dropped). Leaf lines propagate up through enclosing hboxes (not vboxes), so a typeset line's box
 * carries the source lines of everything printed on it, inline math included.
 */
export function parseSynctex(text: string, root: string): SyncIndex {
  const tags = new Map<number, number>() // synctex tag → index in files
  const files: string[] = []
  const fileIdx = new Map<string, number>()
  let unit = 1
  let mag = 1
  let xOff = 0
  let yOff = 0
  let page = 0
  let pages = 0
  const boxes: SyncBox[] = []
  const vboxes: PageRect[] = []
  const stack: Open[] = []
  const scale = () => unit * mag / SP_PER_BP

  const close = () => {
    const box = stack.pop()
    if (!box) {
      return
    }
    const s = scale()
    const rect = { page, x: (box.x + xOff) * s, y: (box.y - box.h + yOff) * s, w: box.w * s, h: (box.h + box.d) * s }
    if (box.kind === 'v' && rect.h > 0.5) {
      vboxes.push(rect)
    }
    // A typeset line's box is tagged with the line that ended its paragraph, and so is its first glyph record; when
    // the box has leaves from other lines, those are the truth (else "…logarithm.\n\begin{theorem}" would credit the
    // paragraph's last line to the theorem).
    const lines = box.other.size ? box.other : box.leaf
    if (rect.w > 0.5 && rect.h > 0.5) {
      for (const [file, [l0, l1]] of lines) {
        boxes.push({ ...rect, file, l0, l1, own: false })
      }
      // Only hboxes count as "own": vboxes are pages, columns and floats, tagged with whatever line was current.
      const own = box.kind === 'h' ? tags.get(box.tag) : undefined
      if (own !== undefined && box.line > 0) {
        boxes.push({ ...rect, file: own, l0: box.line, l1: box.line, own: true })
      }
    }
    const parent = stack[stack.length - 1]
    if (box.kind === 'h' && parent?.kind === 'h') {
      for (const [file, [l0, l1]] of lines) {
        widen(parent.leaf, file, l0, l1)
        widen(parent.other, file, l0, l1)
      }
    }
  }

  const head = /^([[(xkg$rvh])(\d+),(-?\d+):(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/
  for (const raw of text.split('\n')) {
    const c = raw[0]
    if (!c) {
      continue
    }
    if (c === 'I' && raw.startsWith('Input:')) {
      const m = /^Input:(\d+):(.*)$/.exec(raw)
      const rel = m ? projectPath(m[2]!.trim(), root) : null
      if (m && rel) {
        let i = fileIdx.get(rel)
        if (i === undefined) {
          i = files.length
          files.push(rel)
          fileIdx.set(rel, i)
        }
        tags.set(Number(m[1]), i)
      }
      continue
    }
    if (c === '{') {
      page = Number(raw.slice(1))
      pages = Math.max(pages, page)
      stack.length = 0
      continue
    }
    if (c === '}') {
      while (stack.length) {
        close()
      }
      continue
    }
    if (c === ']' || c === ')') {
      close()
      continue
    }
    if (!page) {
      if (raw.startsWith('Unit:')) {
        unit = Number(raw.slice(5)) || 1
      } else if (raw.startsWith('Magnification:')) {
        mag = (Number(raw.slice(14)) || 1000) / 1000
      } else if (raw.startsWith('X Offset:')) {
        xOff = Number(raw.slice(9)) || 0
      } else if (raw.startsWith('Y Offset:')) {
        yOff = Number(raw.slice(9)) || 0
      }
      continue
    }
    const m = head.exec(raw)
    if (!m) {
      continue
    }
    const tag = Number(m[2])
    const line = Number(m[3])
    if (c === '[' || c === '(') {
      stack.push({ kind: c === '[' ? 'v' : 'h', tag, line, x: Number(m[4]), y: Number(m[5]), w: Number(m[6] ?? 0), h: Number(m[7] ?? 0), d: Number(m[8] ?? 0), leaf: new Map(), other: new Map() })
      continue
    }
    // A glyph or math leaf: credit its line to the innermost open hbox. Glue and kerns are skipped: the space after
    // \end{figure} lands in the next paragraph's first line with the figure file's tag.
    if (c !== 'x' && c !== '$') {
      continue
    }
    const file = tags.get(tag)
    const top = stack[stack.length - 1]
    if (file === undefined || !top || line <= 0) {
      continue
    }
    const target = top.kind === 'h' ? top : null
    if (target) {
      widen(target.leaf, file, line, line)
      if (tag !== target.tag || line !== target.line) {
        widen(target.other, file, line, line)
      }
    }
  }
  while (stack.length) {
    close()
  }
  return { files, pages, boxes, bodies: bodyExtents(vboxes) }
}

/**
 * The body of each page: the tall vboxes (≥ 60% of the page's tallest) that contain no other tall vbox, i.e. the
 * output box or its columns, not the page box around head and foot.
 */
function bodyExtents(vboxes: PageRect[]): Record<number, { y0: number, y1: number }> {
  const out: Record<number, { y0: number, y1: number }> = {}
  const byPage = new Map<number, PageRect[]>()
  for (const v of vboxes) {
    (byPage.get(v.page) ?? byPage.set(v.page, []).get(v.page)!).push(v)
  }
  for (const [page, list] of byPage) {
    const tallest = Math.max(...list.map(v => v.h))
    const tall = list.filter(v => v.h >= tallest * 0.6)
    const inner = tall.filter(v => !tall.some(o => o !== v && o.h < v.h - 0.5 && o.y >= v.y - 0.5 && o.y + o.h <= v.y + v.h + 0.5 && o.x >= v.x - 0.5 && o.x + o.w <= v.x + v.w + 0.5))
    if (inner.length) {
      out[page] = { y0: Math.min(...inner.map(v => v.y)), y1: Math.max(...inner.map(v => v.y + v.h)) }
    }
  }
  return out
}

/** Rounds to 0.1 pt so the stored JSON stays small. */
export function roundRect<T extends PageRect>(r: T): T {
  const k = (n: number) => Math.round(n * 10) / 10
  return { ...r, x: k(r.x), y: k(r.y), w: k(r.w), h: k(r.h) }
}

/**
 * Merges rects page by page into blocks: two rects join when their horizontal ranges overlap and the vertical gap is
 * under `gap` pt, so a statement in a two-column paper stays one block per column, not one smeared across both.
 */
export function mergeRects(rects: PageRect[], gap = 8): PageRect[] {
  // A block can grow into one made earlier; repeat until nothing joins.
  let cur = mergeOnce(rects, gap)
  for (let next = mergeOnce(cur, gap); next.length < cur.length; next = mergeOnce(cur, gap)) {
    cur = next
  }
  return cur
}

function mergeOnce(rects: PageRect[], gap: number): PageRect[] {
  const out: PageRect[] = []
  const byPage = new Map<number, PageRect[]>()
  for (const r of rects) {
    (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r)
  }
  for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const blocks: PageRect[] = []
    for (const r of [...list].sort((a, b) => a.y - b.y)) {
      const hit = blocks.find(b => r.x < b.x + b.w && b.x < r.x + r.w && r.y <= b.y + b.h + gap && b.y <= r.y + r.h + gap)
      if (hit) {
        const x1 = Math.max(hit.x + hit.w, r.x + r.w)
        const y1 = Math.max(hit.y + hit.h, r.y + r.h)
        hit.x = Math.min(hit.x, r.x)
        hit.y = Math.min(hit.y, r.y)
        hit.w = x1 - hit.x
        hit.h = y1 - hit.y
      } else {
        blocks.push({ page, x: r.x, y: r.y, w: r.w, h: r.h })
      }
    }
    out.push(...blocks.sort((a, b) => a.y - b.y || a.x - b.x))
  }
  return out
}

interface Span { file: string, start: number, end: number }

/** A box whose vertical middle lies in its page's body (true when the body is unknown). */
function inBody(index: SyncIndex, b: PageRect): boolean {
  const body = index.bodies?.[b.page]
  const mid = b.y + b.h / 2
  return !body || (mid >= body.y0 - 2 && mid <= body.y1 + 2)
}

function fileIndex(index: SyncIndex, file: string): number {
  const norm = file.replace(/^(\.\/)+/, '')
  return index.files.indexOf(norm)
}

/**
 * Where source lines start..end of `file` were typeset: the typeset lines (leaf boxes) whose glyphs came from that
 * span, merged into blocks. Own boxes are left out: a page's or paragraph's box is tagged with whatever line TeX was
 * reading when it was built, which says nothing about its contents.
 */
export function rectsForLines(index: SyncIndex, file: string, start: number, end: number): PageRect[] {
  const f = fileIndex(index, file)
  if (f < 0) {
    return []
  }
  const hits = index.boxes.filter(b => !b.own && b.file === f && b.l1 >= start && b.l0 <= end && inBody(index, b))
  return mergeRects(hits).map(roundRect)
}

/**
 * The region a figure environment occupies: its typeset lines (caption, TikZ labels) plus the boxes created while
 * its lines were read (the image's hbox, the TikZ picture), on the page where most of it landed (a float moves as
 * a unit). `spans` are the environment's source lines per file (its body may be \input from another file);
 * `exclude` is the caption's span. Boxes
 * the size of a page or text block are ignored (shipout boxes inherit the current line). Null when nothing matched.
 */
export function figureRect(index: SyncIndex, spans: Span[], page?: { w: number, h: number }, exclude?: Span): PageRect | null {
  const maxArea = (page ? page.w * page.h : 612 * 792) * 0.55
  let hits: SyncBox[] = []
  for (const s of spans) {
    const f = fileIndex(index, s.file)
    if (f >= 0) {
      hits.push(...index.boxes.filter(b => b.file === f && b.l1 >= s.start && b.l0 <= s.end && b.w * b.h < maxArea && inBody(index, b)))
    }
  }
  // Leave the caption out (the reader shows it as text) unless nothing else of the figure was recorded.
  const ex = exclude ? fileIndex(index, exclude.file) : -1
  const kept = ex >= 0 ? hits.filter(b => !(b.file === ex && b.l0 >= exclude!.start && b.l1 <= exclude!.end)) : hits
  if (kept.length) {
    hits = kept
  }
  if (!hits.length) {
    return null
  }
  const area = new Map<number, number>()
  for (const b of hits) {
    area.set(b.page, (area.get(b.page) ?? 0) + b.w * b.h)
  }
  const best = [...area].sort((a, b) => b[1] - a[1])[0]![0]
  // A float is one block; keep the biggest cluster so a stray box elsewhere on the page can't stretch the crop.
  const blocks = mergeRects(hits.filter(b => b.page === best), 24)
  const block = blocks.sort((a, b) => b.w * b.h - a.w * a.h)[0]!
  return roundRect(block)
}
