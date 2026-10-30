# Paper reader and figures: design

**Date:** October 29, 2026 · **Status:** built (see the plan's § Post-v1: paper reader and figures)

The owner asked for the paper's home view to be the paper itself, rendered with a real engine, with figures extracted and actually looked at. This note records the choices and why.

## 1. Renderer: compile the sources with TeX Live, keep SyncTeX

| Option | Fidelity | Node linking | Cost / risk | Verdict |
|---|---|---|---|---|
| **latexmk + pdfLaTeX (TeX Live 2025) in a Vercel Sandbox, `-synctex=1`** | Exact: the engine and packages arXiv itself uses | SyncTeX maps every source line to boxes on the page, so a statement's `file:line` span becomes rectangles | One-time ~2 min snapshot build; ~10–20 s per paper; sandbox is no-network | **Chosen** |
| Tectonic (XeTeX, on-demand bundle) | Close, but a different engine: font, `inputenc`/`fontenc` and microtype differences on pdfLaTeX papers | SyncTeX works | Needs network at compile time for missing packages | Not built: TeX Live from Ubuntu's archive installs in ~2.5 min, is the engine arXiv uses, and compiled every paper tried |
| arXiv's PDF (`arxiv.org/pdf/<id>`) | Exact | None (no SyncTeX); only page-level location by text search | Free; arXiv sources only | **Fallback** when compiling fails |
| LaTeXML HTML (ar5iv-style) | Reflowable but lossy (TikZ becomes SVG or an image, custom macros and alignments degrade) | Good (ids per element) | Heavy install; arXiv's own HTML lists many papers with conversion errors | Not built (weighed, not run): the owner asked for a good renderer and the PDF is the paper as its authors typeset it; a reflowable HTML view could come later from the same sources |
| Hand-rolled LaTeX → HTML | Poor | Good | — | Ruled out by the owner |

Probe results (Oct 29, sandbox): ETH (67 pp) compiles in 5–9 s, unit-distance (53 pp, two TikZ figures) in 6–9 s, Rao's *Coding for Sunflowers* (journal class files from 2019, two PDF figures) compiles with one recoverable `hyperxmp` error. `latexmk -f -interaction=nonstopmode` keeps going past recoverable errors; the PDF is accepted when it has pages and the error lines are logged and shown on the run page.

The image is a snapshot of `vercel/sandbox/universal` (Ubuntu 26.04) plus `texlive-latex-extra`, `-science`, `-pictures`, `-publishers`, `-fonts-recommended`, `-fonts-extra`, `-bibtex-extra`, `-xetex`, `-luatex`, `cm-super`, `lmodern`, `latexmk`, `biber`, `poppler-utils`, `ghostscript`, `librsvg2-bin`, `python3-pil` (`server/pipeline/sandbox/tex.ts`, cached in `.data/sandbox-tex-snapshot.json` or `SANDBOX_TEX_SNAPSHOT_ID`). Engine choice: pdfLaTeX unless the source names XeLaTeX/LuaLaTeX (`% !TEX program`, `fontspec`, `unicode-math`, `\directlua`). Render sandboxes run with `networkPolicy: 'deny-all'`.

## 2. Storage: content-addressed blobs in Postgres

PDFs (~0.5–1 MB), SyncTeX files and figure PNGs (~50–150 KB) go into a `blobs` table (`sha` primary key, `bytea`), served by `GET /api/blobs/:sha` with immutable caching and HTTP Range support. Binary source assets (figure images, TikZ inputs, `.bst`) are `source_assets` rows pointing at blobs.

Why not Vercel Blob: it is a second service with its own token, it does not exist under PGlite, and these sizes are small. Content addressing makes retries and re-renders idempotent for free. Range support keeps every response small (PDF.js streams in 256 KB chunks), so the 4.5 MB function response cap never bites. Moving to Blob or Supabase Storage later is a change inside `server/utils/blobs.ts`.

## 3. Viewer: PDF.js with SyncTeX overlays

`pdfjs-dist` 6 (`PDFViewer` + `PDFLinkService` + `PDFFindController`), loaded client-side only. Text layer (selection, copy), the paper's own hyperlinks, find with match counts, zoom, page nav, an invert option for dark mode (the chrome follows the color mode; the page stays white by default).

**Node linking.** The render stage parses the SyncTeX file server-side (`server/pipeline/latex/synctex.ts`, a small parser, ~20 ms for 67 pages) and stores, per node, the PDF rectangles of its statement (and proof) span: `PaperRender.anchors`. Only glyph and math leaves count (glue after `\end{figure}` lands in the next paragraph's first line), leaf lines propagate up through enclosing hboxes, page vboxes are ignored (they carry whatever line was current at shipout), and so are running heads and page numbers (outside the page's body box). Rectangles are merged per column and page.

The reader draws them as percentage-positioned overlays inside PDF.js's page divs (zoom needs no redraw), plus a thin margin marker per statement. Overlays are `pointer-events: none`, so text selection works everywhere; a click that is not a drag-selection hit-tests the anchors (statements beat proofs, smaller beats bigger) and selects the node. Selecting a node anywhere else scrolls the PDF to its first statement box and flashes it.

**Routing.** `/[paper]` lands on `/[paper]/<main theorem>?view=paper&page=1` when the paper is rendered (the node page otherwise). The view switch is Paper / Node / Graph; `/[paper]/[node]` without `view` is still the node page, so old deep links keep working. `?figure=<id>` scrolls the reader to a figure.

## 4. Figures

**Fetch.** All three fetchers keep `\includegraphics` targets and compile helpers (`.png .jpg .jpeg .gif .pdf .eps .ps .svg .tikz .pgf .dat .csv .tsv .bst .clo .def .cfg …`, 15 MB per file, 60 MB per paper). Papers fetched before this get their assets fetched once by the render stage. Uploads: 4.4 MB on Vercel (the platform's request cap), 32 MB elsewhere; zips may contain images.

**Extract** (`server/pipeline/latex/figures.ts`, deterministic): every `figure`, `figure*`, `wrapfigure` environment, through `\input`: labels (subfigures' too), main caption vs subcaptions, display number (`\numberwithin{figure}`), section, file/line and the per-file source spans, graphics resolved against the assets (`\graphicspath`, extensionless refs in pdfLaTeX's order), whether it is drawn in TeX (TikZ, pgfplots, tikz-cd, xy), the LaTeX body, and the prose around it and its `\ref`s. The figure's labels become `PaperLabel { kind: 'figure' }`.

**Rasterize from the compiled PDF.** The figure's box is the union of SyncTeX boxes created while its lines were read (the image's hbox, the TikZ picture, the typeset labels) on the page where most of it landed, minus the caption lines, clustered so a stray box can't stretch it. `pdftoppm` renders that region at 200 dpi; Pillow trims to the ink, pads, caps at 1600 px, writes PNG (`server/pipeline/sandbox/render_figures.py`). So TikZ and vector figures work exactly like images. When the paper doesn't compile, figures fall back to their own graphics files (PDF via `pdftoppm`, EPS via Ghostscript, SVG via `rsvg-convert`, bitmaps as is; subfigures side by side).

**Look at them.** Stage `figures`: one call per figure with an image to `anthropic/claude-opus-5.5` (careful and standard; Sonnet 5.5 on quick) through `callObject` with the PNG attached. Opus 5.5 is the strongest vision model on the gateway at a sane price ($4 / $20 per M; GPT-6 Sol is cheaper but the project's careful profile is Opus and misreading a chart is worse than missing one). Measured: **$0.015–0.035 per figure**. The prompt carries the caption, the TikZ source when drawn in TeX (authoritative for labels), the surrounding prose, the nodes that cite the figure first, then all nodes. The schema forces a transcription of every readable label first (`readable_text`), then `kind`, a 2–5 sentence `description`, `data_summary` (plots only: axes, series, trend, legible values), `node_ids`, `confidence`. The instructions say to write "unreadable" rather than guess, and never to take numbers from the caption; code drops invented node ids and non-plot data summaries.

## 5. Pipeline

`render` and `figures` sit between `classify` and `finalize`, so **Re-render** on the run page is just "re-run from render": every structural stage is reused, and finalize writes `digest.render` and `digest.figures`. Both follow the step rules: side effects inside the step, small return values (figure counts), big outputs to blobs and `stage_outputs`, skip-if-present, cost through `callObject`. The sandbox is stopped in a `finally`, by `failRun`, and by the dev boot sweep. Render never fails the run: any error becomes `status: 'unavailable'` (or `'arxiv_pdf'` with arXiv's PDF, located by page via `pdftotext`), and the reader shows the fallback.
