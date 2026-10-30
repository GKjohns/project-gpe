/**
 * Stage `render`: typeset the stored sources with a real TeX engine (latexmk + pdfLaTeX/XeLaTeX/LuaLaTeX from TeX
 * Live 2025) in a no-network Vercel Sandbox, with SyncTeX on; map every node to its boxes in the PDF; find each figure
 * environment's box and rasterize it (TikZ and vector figures included) to a PNG. Never fails the run: if the paper
 * does not compile, an arXiv paper falls back to arXiv's own PDF (page-level anchors from its text), figures fall
 * back to their own graphics files, and otherwise the reader shows "rendered view unavailable".
 */
import { posix } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { Sandbox } from '@vercel/sandbox'
import type { Outline, Skeleton } from '#shared/pipeline'
import type { PageRect, PaperAnchor, PaperRender } from '#shared/types'
import { useDb } from '../../db'
import { papers, sources } from '../../db/schema'
import { blobStore } from '../../utils/blobs'
import { appendEvent, getRun, patchProgress, setStage } from '../../utils/runs'
import { loadAssets, replaceAssets } from '../../utils/sourceStore'
import { stageOutputs } from '../../utils/stageOutputs'
import { extractFigures } from '../latex/figures'
import type { FigureSource } from '../latex/figures'
import { figureRect, parseSynctex, rectsForLines } from '../latex/synctex'
import type { SyncIndex } from '../latex/synctex'
import { statementIds } from '../nodes'
import { RENDER_DIR, ensureTexSnapshot } from '../sandbox/tex'
import { fetchRemoteSource } from '../sources'
import type { SourceFile } from '../sources'
// Nitro dev doesn't watch `raw:` imports: after editing the script, touch this file.
import RENDER_PY from 'raw:../sandbox/render_figures.py'
import type { ClassifyOutput } from './classify'
import type { StageFn } from './stub'

export interface RenderFigure extends FigureSource {
  cited_by: string[] // nodes whose statement, proof or claim span \refs the figure (or contains it)
  page?: number
  rect?: PageRect
  image?: { sha: string, width: number, height: number, source: 'pdf' | 'file' }
  image_error?: string
}

export interface RenderOutput {
  status: PaperRender['status']
  engine?: string
  pdf?: { sha: string, bytes: number, pages: number, pageSize?: { w: number, h: number } }
  synctex_sha?: string
  anchors: Record<string, PaperAnchor[]>
  figures: RenderFigure[]
  error?: string
  log_tail?: string
  ms: number
  rendered_at: string
}

const SRC = `${RENDER_DIR}/src`
const COMPILE_TIMEOUT_S = 300
const SANDBOX_TIMEOUT_MS = 12 * 60 * 1000
const DPI = 200
const MAX_PROOF_RECTS = 12

type Engine = 'pdflatex' | 'xelatex' | 'lualatex'

/** pdfLaTeX unless the source says otherwise (a `% !TEX program` line, fontspec / unicode-math, Lua code). */
export function pickEngine(main: string, all: string): Engine {
  const magic = /^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(main)?.[1]?.toLowerCase()
  if (magic === 'xelatex' || magic === 'lualatex') {
    return magic
  }
  if (/\\directlua|\\begin\s*\{luacode|\\usepackage(?:\[[^\]]*\])?\{luacode/.test(all)) {
    return 'lualatex'
  }
  if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|unicode-math|polyglossia|xeCJK)\b/.test(all)) {
    return 'xelatex'
  }
  return 'pdflatex'
}

/** The last error lines of a LaTeX log, for the run log and the reader's "why" line. */
export function logErrors(log: string, max = 6): string[] {
  const lines = log.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i]!
    if (/^!\s|^[^\s:]+\.(?:tex|sty|cls):\d+:\s/.test(l)) {
      out.push(`${l.trim()} ${(lines[i + 1] ?? '').trim()}`.trim().slice(0, 240))
    }
  }
  return out
}

interface Span { file: string, start: number, end: number }

/** Statement / proof / claim spans per node id (claims from the outline; the digest's nodes keep only a start line). */
export function nodeSpans(nodes: ClassifyOutput['nodes'], skeleton: Skeleton, outline: Outline | null) {
  const ids = statementIds(skeleton.statements)
  const byId = new Map<string, Skeleton['statements'][number]>()
  for (const s of skeleton.statements) {
    byId.set(ids.get(s.label)!, s)
  }
  const claims = new Map((outline?.claims ?? []).map(c => [c.id, c.span]))
  const out = new Map<string, { statement: Span, proof?: Span }>()
  for (const n of nodes) {
    const st = byId.get(n.id)
    if (st) {
      out.set(n.id, {
        statement: { file: st.file, start: st.startLine, end: st.endLine },
        ...(st.proof ? { proof: { file: st.proof.file, start: st.proof.startLine, end: st.proof.endLine } } : {})
      })
      continue
    }
    const span = claims.get(n.id)
    out.set(n.id, { statement: span ? { file: span.file, start: span.startLine, end: span.endLine } : { file: n.paper_ref.file, start: n.paper_ref.line, end: n.paper_ref.line + 2 } })
  }
  return out
}

/** Node → PDF boxes via SyncTeX. Proofs keep at most a dozen blocks (a ten-page proof is still a handful). */
export function anchorsFromSynctex(index: SyncIndex, spans: ReturnType<typeof nodeSpans>): Record<string, PaperAnchor[]> {
  const out: Record<string, PaperAnchor[]> = {}
  for (const [id, s] of spans) {
    const statement = rectsForLines(index, s.statement.file, s.statement.start, s.statement.end).map(r => ({ ...r, part: 'statement' as const }))
    const proof = s.proof ? rectsForLines(index, s.proof.file, s.proof.start, s.proof.end).slice(0, MAX_PROOF_RECTS).map(r => ({ ...r, part: 'proof' as const })) : []
    if (statement.length || proof.length) {
      out[id] = [...statement, ...proof]
    }
  }
  return out
}

/** Which nodes a figure belongs to by position: \refs to its labels inside a node's spans, or the figure inside one. */
export function citedBy(fig: FigureSource, files: SourceFile[], spans: ReturnType<typeof nodeSpans>): string[] {
  const hits = new Set<string>()
  const inside = (file: string, line: number) => {
    for (const [id, s] of spans) {
      for (const sp of [s.statement, s.proof]) {
        if (sp && sp.file === file && line >= sp.start && line <= sp.end) {
          hits.add(id)
        }
      }
    }
  }
  inside(fig.file, fig.line)
  if (fig.labels.length) {
    const re = new RegExp(`\\\\(?:c|C|auto|sub)?ref\\*?\\s*\\{[^}]*(?:${fig.labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[^}]*\\}`)
    for (const f of files) {
      f.content.split('\n').forEach((line, i) => {
        if (re.test(line)) {
          inside(f.path, i + 1)
        }
      })
    }
  }
  return [...hits]
}

/** Page of each figure / statement in a PDF we have only text for (arXiv's): first page whose text names it. */
export function approxPages(pagesText: string[], needles: Map<string, RegExp>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, re] of needles) {
    const i = pagesText.findIndex(t => re.test(t))
    if (i >= 0) {
      out.set(id, i + 1)
    }
  }
  return out
}

const KIND_NAME: Record<string, string> = { theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition', claim: 'Claim', remark: 'Remark' }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function run(sb: Sandbox, script: string, timeoutMs = 120_000) {
  const r = await sb.runCommand({ cmd: 'bash', args: ['-lc', script], timeoutMs } as Parameters<Sandbox['runCommand']>[0])
  return { code: r.exitCode, out: await r.stdout(), err: await r.stderr() }
}

async function fetchArxivPdf(id: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`https://arxiv.org/pdf/${id}`, { headers: { 'User-Agent': 'gpe-ingest' }, redirect: 'follow' })
    const buf = res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    return buf && new TextDecoder().decode(buf.subarray(0, 5)) === '%PDF-' ? buf : null
  } catch {
    return null
  }
}

function pdfInfo(text: string): { pages: number, pageSize?: { w: number, h: number } } {
  const pages = Number(/^Pages:\s+(\d+)/m.exec(text)?.[1] ?? 0)
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(text)
  return { pages, ...(size ? { pageSize: { w: Number(size[1]), h: Number(size[2]) } } : {}) }
}

/** Stops the run's render sandbox if one is recorded and still up (failure paths; its own 12-min timeout is the backstop). */
export async function stopRenderSandbox(runId: string): Promise<boolean> {
  const run = await getRun(runId)
  const name = run?.progress.render_sandbox
  if (typeof name !== 'string' || run?.progress.render_sandbox_stopped) {
    return false
  }
  const sb = await Sandbox.get({ name }).catch(() => null)
  if (sb && ['pending', 'running'].includes(sb.status)) {
    await sb.stop().catch(() => {})
  }
  await patchProgress(runId, { render_sandbox_stopped: true })
  return true
}

export const renderStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'render')
  const reused = await stageOutputs.get<RenderOutput>(ctx.runId, 'render')
  if (reused) {
    await appendEvent(ctx.runId, 'render', 'info', `render · reused (${reused.status}, ${reused.figures.length} figures)`)
    return reused.figures.length
  }
  const t0 = Date.now()
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  const classified = await stageOutputs.get<ClassifyOutput>(ctx.runId, 'classify')
  const outline = await stageOutputs.get<Outline>(ctx.runId, 'outline')
  if (!skeleton || !classified) {
    throw new Error('missing chunk/classify output for this run; re-run from classify')
  }
  const db = await useDb()
  const [paper] = await db.select().from(papers).where(eq(papers.id, ctx.paperId))
  if (!paper) {
    throw new Error('paper row is gone')
  }
  const text: SourceFile[] = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, ctx.paperId))
  let assets = await loadAssets(ctx.paperId)
  // Papers fetched before assets were kept: fetch once more for the figures' files.
  if (!assets.length && paper.sourceKind !== 'upload' && text.some(f => /\\includegraphics|\\input\s*\{[^}]*\.(?:tikz|pgf)\}/.test(f.content))) {
    try {
      const fresh = (await fetchRemoteSource(paper.sourceKind, paper.sourceRef)).filter(f => f.data)
      const stored = await replaceAssets(ctx.paperId, fresh)
      assets = await loadAssets(ctx.paperId)
      await appendEvent(ctx.runId, 'render', 'info', `render · fetched ${stored.stored} figure/asset files the original fetch dropped`)
    } catch (err) {
      await appendEvent(ctx.runId, 'render', 'warn', `render · could not fetch assets: ${(err as Error).message}`)
    }
  }

  const spans = nodeSpans(classified.nodes, skeleton, outline)
  const figures: RenderFigure[] = extractFigures(text, skeleton, assets.map(a => a.path))
    .map(f => ({ ...f, cited_by: citedBy(f, text, spans) }))
  const out: RenderOutput = { status: 'unavailable', anchors: {}, figures, ms: 0, rendered_at: new Date().toISOString() }
  const arxivId = paper.sourceKind === 'arxiv' ? paper.sourceRef : null

  let sb: Sandbox | null = null
  try {
    const snapshotId = await ensureTexSnapshot(msg => appendEvent(ctx.runId, 'render', 'info', msg))
    sb = await Sandbox.create({
      source: { type: 'snapshot', snapshotId },
      resources: { vcpus: 4 },
      timeout: SANDBOX_TIMEOUT_MS,
      persistent: false,
      networkPolicy: 'deny-all',
      tags: { app: 'gpe', run: ctx.runId.slice(0, 8), role: 'render' }
    })
    await patchProgress(ctx.runId, { render_sandbox: sb.name })
    await sb.writeFiles([
      ...text.map(f => ({ path: `${SRC}/${f.path}`, content: f.content })),
      ...assets.map(f => ({ path: `${SRC}/${f.path}`, content: Buffer.from(f.data!) })),
      { path: `${RENDER_DIR}/render_figures.py`, content: RENDER_PY }
    ])

    // --- compile ---
    const main = skeleton.mainFile
    const mainText = text.find(f => f.path === main)?.content ?? ''
    const engine = pickEngine(mainText, text.map(f => f.content).join('\n'))
    const flag = engine === 'pdflatex' ? '-pdf' : engine === 'xelatex' ? '-xelatex' : '-lualatex'
    const dir = posix.dirname(main)
    const base = posix.basename(main, '.tex')
    const cwd = dir === '.' ? SRC : `${SRC}/${dir}`
    await appendEvent(ctx.runId, 'render', 'info', `render · compiling ${main} with latexmk ${flag} (TeX Live 2025, SyncTeX on) in sandbox ${sb.name}`)
    const tc = Date.now()
    const forced = (await getRun(ctx.runId))?.progress.force_render_fail === true
    const compile = forced
      ? { code: 1, out: '1\n', err: '' }
      : await run(sb, `cd '${cwd}' && timeout ${COMPILE_TIMEOUT_S} latexmk ${flag} -synctex=1 -interaction=nonstopmode -file-line-error -f '${base}.tex' > '${RENDER_DIR}/build.log' 2>&1; echo $?; pdfinfo '${base}.pdf' 2>/dev/null`, (COMPILE_TIMEOUT_S + 30) * 1000)
    const log = (await sb.readFileToBuffer({ path: `${cwd}/${base}.log` }).catch(() => null))?.toString('utf8')
      ?? (await sb.readFileToBuffer({ path: `${RENDER_DIR}/build.log` }).catch(() => null))?.toString('utf8') ?? ''
    const errors = logErrors(log)
    out.log_tail = log.slice(-3000)
    const info = pdfInfo(compile.out)
    const pdf = info.pages ? await sb.readFileToBuffer({ path: `${cwd}/${base}.pdf` }) : null
    let index: SyncIndex | null = null

    if (pdf) {
      out.status = 'compiled'
      out.engine = engine
      const sha = await blobStore.put(pdf, 'application/pdf')
      out.pdf = { sha, bytes: pdf.byteLength, ...info }
      const gz = await sb.readFileToBuffer({ path: `${cwd}/${base}.synctex.gz` })
      if (gz) {
        out.synctex_sha = await blobStore.put(gz, 'application/gzip')
        index = parseSynctex(gunzipSync(gz).toString('utf8'), SRC)
        out.anchors = anchorsFromSynctex(index, spans)
      }
      await appendEvent(ctx.runId, 'render', errors.length ? 'warn' : 'info',
        `render · ${info.pages} pages in ${((Date.now() - tc) / 1000).toFixed(1)}s · ${Math.round(pdf.byteLength / 1024)} KB · SyncTeX ${index ? `${index.boxes.length} boxes, ${Object.keys(out.anchors).length}/${classified.nodes.length} nodes anchored` : 'missing'}${errors.length ? ` · ${errors.length} TeX errors (output kept): ${errors[0]}` : ''}`,
        { pages: info.pages, engine, errors })
      if (errors.length) {
        out.error = errors.join('\n')
      }
    } else {
      out.error = forced ? 'compile skipped (forceRenderFail, dev)' : errors.join('\n') || `latexmk exited ${compile.out.trim().split('\n')[0]} with no PDF`
      await appendEvent(ctx.runId, 'render', 'warn', `render · ${main} did not compile: ${errors[0] ?? out.error}`, { errors, engine })
      const fallback = arxivId ? await fetchArxivPdf(arxivId) : null
      if (fallback) {
        out.status = 'arxiv_pdf'
        const sha = await blobStore.put(fallback, 'application/pdf')
        await sb.writeFiles([{ path: `${RENDER_DIR}/arxiv.pdf`, content: Buffer.from(fallback) }])
        const t = await run(sb, `cd '${RENDER_DIR}' && pdfinfo arxiv.pdf; pdftotext -layout arxiv.pdf arxiv.txt`)
        const pagesText = ((await sb.readFileToBuffer({ path: `${RENDER_DIR}/arxiv.txt` }))?.toString('utf8') ?? '').split('\f')
        out.pdf = { sha, bytes: fallback.byteLength, ...pdfInfo(t.out) }
        // Page-level anchors: a statement's heading ("Lemma 2.3.") / a figure's caption ("Figure 2:").
        const ids = statementIds(skeleton.statements)
        const labels = new Map(skeleton.statements.map(s => [ids.get(s.label)!, s]))
        const needles = new Map<string, RegExp>()
        for (const n of classified.nodes) {
          const s = labels.get(n.id)
          if (s?.number && KIND_NAME[n.kind]) {
            needles.set(n.id, new RegExp(`\\b${KIND_NAME[n.kind]}\\s+${esc(s.number)}\\s*[.(]`))
          }
        }
        for (const [id, page] of approxPages(pagesText, needles)) {
          out.anchors[id] = [{ page, x: 0, y: 0, w: 0, h: 0, part: 'statement', approx: true }]
        }
        const figNeedles = new Map(figures.filter(f => f.number).map(f => [f.id, new RegExp(`\\b(?:Figure|Fig\\.)\\s*${esc(f.number!)}\\s*[:.]`)]))
        for (const [id, page] of approxPages(pagesText, figNeedles)) {
          figures.find(f => f.id === id)!.page = page
        }
        await appendEvent(ctx.runId, 'render', 'info', `render · fell back to arXiv's PDF for ${arxivId} (${out.pdf.pages} pages; ${Object.keys(out.anchors).length} nodes located by page)`)
      }
    }

    // --- figures: crop from our PDF when SyncTeX found them, else rasterize their own graphics files ---
    const pdfPath = `${cwd}/${base}.pdf`
    const jobs: Record<string, unknown>[] = []
    for (const f of figures) {
      const rect = index && out.status === 'compiled' ? figureRect(index, f.spans, out.pdf?.pageSize, f.caption_span) : null
      if (rect) {
        f.page = rect.page
        f.rect = rect
        jobs.push({ id: f.id, page: rect.page, rect: [rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8] })
      } else {
        const paths = f.graphics.map(g => g.path).filter((p): p is string => !!p)
        if (paths.length) {
          jobs.push({ id: f.id, files: paths.map(p => `${SRC}/${p}`) })
        }
      }
    }
    if (jobs.length) {
      await sb.writeFiles([{ path: `${RENDER_DIR}/jobs.json`, content: JSON.stringify({ pdf: pdfPath, dpi: DPI, out: `${RENDER_DIR}/figs`, jobs }) }])
      const r = await run(sb, `cd '${RENDER_DIR}' && python3 render_figures.py jobs.json`, 300_000)
      for (const line of r.out.split('\n').filter(Boolean)) {
        let res: { id: string, ok: boolean, w?: number, h?: number, error?: string }
        try {
          res = JSON.parse(line)
        } catch {
          continue
        }
        const f = figures.find(x => x.id === res.id)
        if (!f) {
          continue
        }
        if (!res.ok) {
          f.image_error = res.error
          continue
        }
        const png = await sb.readFileToBuffer({ path: `${RENDER_DIR}/figs/${res.id}.png` })
        if (png) {
          f.image = { sha: await blobStore.put(png, 'image/png'), width: res.w!, height: res.h!, source: f.rect ? 'pdf' : 'file' }
        }
      }
      const made = figures.filter(f => f.image).length
      await appendEvent(ctx.runId, 'render', made < jobs.length ? 'warn' : 'info',
        `render · ${made}/${figures.length} figures rasterized (${figures.filter(f => f.image?.source === 'pdf').length} cropped from the PDF, ${figures.filter(f => f.image?.source === 'file').length} from their own files)${made < jobs.length ? ` · failed: ${figures.filter(f => f.image_error).map(f => `${f.id}: ${f.image_error}`).join('; ').slice(0, 300)}` : ''}`)
    } else if (figures.length) {
      await appendEvent(ctx.runId, 'render', 'warn', `render · ${figures.length} figures found but none could be rasterized`)
    }
  } catch (err) {
    // Rendering is an extra: whatever went wrong, the digest still finalizes and the reader falls back.
    out.error = out.error ?? (err as Error).message
    await appendEvent(ctx.runId, 'render', 'warn', `render · failed: ${(err as Error).message.slice(0, 300)}`)
    if (out.status === 'unavailable' && arxivId) {
      const fallback = await fetchArxivPdf(arxivId)
      if (fallback) {
        out.status = 'arxiv_pdf'
        out.pdf = { sha: await blobStore.put(fallback, 'application/pdf'), bytes: fallback.byteLength, pages: 0 }
      }
    }
  } finally {
    if (sb) {
      await sb.stop().catch(() => {})
      await patchProgress(ctx.runId, { render_sandbox_stopped: true })
    }
  }

  out.ms = Date.now() - t0
  await stageOutputs.put(ctx.runId, 'render', out)
  await patchProgress(ctx.runId, {
    render_status: out.status,
    render_pages: out.pdf?.pages ?? 0,
    render_anchored: Object.keys(out.anchors).length,
    figures_found: figures.length,
    figures_rasterized: figures.filter(f => f.image).length
  })
  await appendEvent(ctx.runId, 'render', out.status === 'unavailable' ? 'warn' : 'info',
    `render · ${out.status === 'compiled' ? `compiled (${out.engine})` : out.status === 'arxiv_pdf' ? 'using arXiv\'s PDF' : 'rendered view unavailable'} · ${figures.length} figures · ${(out.ms / 1000).toFixed(1)}s`)
  return figures.length
}
