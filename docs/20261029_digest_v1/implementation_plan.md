# Project GPE (Graphical Proof Explorer) v1 — Implementation Plan

> Renamed from Digest to Project GPE (Graphical Proof Explorer) on Oct 29. The folder keeps its `20261029_digest_v1` name so existing links keep working; sprint notes below still say "Digest" where they were written before the rename. The Inngest app id changed from `digest` to `gpe`, which means a fresh Inngest app on first deploy (fine: nothing was deployed under the old id).

**Created:** October 29, 2026
**Status:** Complete: Sprints 1–9 and 4b, post-sprint polish, and the Phase 5 verification artifact ([verification/index.html](verification/index.html)). Sprint 8 corpus results and the default-method decision are in § Corpus results. Not committed; not deployed.
**Context:** Phase 1 of [docs/BRIEF.md](../BRIEF.md): turn a math paper's LaTeX into a browsable map of its proof. Paper-only; the Lean phases (2–3) are follow-ons. Shaped on Oct 29 by five directions from Kyle: nothing command-line and ingestion UI-driven; serverless-shaped with Postgres now and Supabase later; the dependency DAG is central and the friction report is not; be judicious about which model does which step, with special care for the structural breakdown of long papers; build and compare two structure methods (fixed pipeline vs an agent in a Vercel Sandbox). Inngest is the production runner, mocked in dev behind a step interface.

**Goal:** From the browser, paste a GitHub directory or arXiv id (or upload `.tex`), watch the run, then browse the ETH paper as a tree, a dependency DAG, node pages with deep links, and a chat that cites nodes. Both structure methods run over a tiered corpus from a corpus page, and the numbers decide the default.

**Scope:** LaTeX input only. Nuxt 4 + Nuxt UI 4 app, deployable to Vercel. Pipeline in `server/pipeline/` against a `StepRunner`; `LocalRunner` in dev, `InngestRunner` in prod. Drizzle over PGlite locally, Postgres by `DATABASE_URL` in prod. No auth, no Supabase client, no Lean.

---

## Handoff / Execution Notes (read first — this plan is self-contained)

**Repo & runtime.** App root is the repo root (no `src/`). Nuxt 4.6, Nuxt UI 4.12, Tailwind 4, Node ≥ 22.19, npm. Commands: `npm run dev` (port 3120 via `.claude/launch.json`, use `preview_start {name:"digest"}`), `npm run lint`, `npm run typecheck`. No test runner yet; Sprint 1 adds `vitest`. CI (`.github/workflows/ci.yml`) runs lint + typecheck on push. The gateway key is already in `.env` (`AI_GATEWAY_API_KEY`, verified Oct 29). `.env` is gitignored; `.env.example` lists the variables.

**Conventions to match.**
- Nuxt UI 4 components on their defaults; `app.config.ts` sets primary `indigo`, neutral `zinc`. Dashboard pages use `UDashboardGroup` / `UDashboardSidebar` / `UDashboardPanel` / `UDashboardNavbar`. Existing shell: [app/app.vue](../../app/app.vue) (`UHeader`, `UMain`, `UFooter`); keep it for non-dashboard pages, and give dashboard pages their own layout.
- Server-side model calls: `generateText + Output.object` (or `generateObject`) with a bare `'provider/model'` string through the Vercel AI Gateway. Streaming chat: `streamText` + `useChat`, rendered with Nuxt UI's chat components and Comark for message parts (`ai@7`, `@ai-sdk/vue@4`, Comark).
- One model registry, `server/utils/aiModels.ts`, the standard registry pattern extended with per-step profiles (contract below).
- ESLint stylistic: no trailing commas, 1tbs braces (`nuxt.config.ts`). Typescript strict. Comments: short, why-not-what.
- Nothing is a CLI. Anything an operator does has a page or a button.

**Contracts** are spelled out in § Contracts below: shared types, DB schema, pipeline step runner, stage inputs/outputs (skeleton, outline, digest), API routes, model profiles. They must not drift between sprints; change the contract section first if one has to.

**Execution order.** Sprints 1 → 2 → 3 → 4 are sequential (foundation → ingest + chunk → extract/resolve → annotate/finalize). Sprint 5 (app shell) can start after Sprint 1 against the fixture digest in `server/fixtures/`. Sprint 6 (graph) after 5. Sprint 4b (agent method) after 3, parallel to 5–7. Sprint 7 (chat + friction) after 4 and 5. Sprint 8 (corpus + comparison) last. Sprint 9 (Inngest runner) is independent after 1 and can be done any time before deploy. Two sprints must not edit the same file concurrently; the file lists per sprint are disjoint except `app/pages/[paper]/[node].vue`, which Sprints 5, 6 and 7 touch in that order.

**Per-sprint loop.** Announce → execute (a subagent gets this plan, the sprint section, and the conventions above) → `npm run lint && npm run typecheck && npx vitest run` → browser check with Playwright on `localhost:3120` (screenshot the states that prove the sprint; keepers go to `verification/screenshots/` as WebP, the rest deleted) → update this file (status badge, deviations) → report. Phase 5 verification artifact (`verification/index.html`) is required before reporting done.

**Commit/push policy.** Don't commit or push unless Kyle asks. Never commit `.env`, `.data/`, loose screenshots, or `corpus/sources/`.

---

## Storyboard

[storyboard.html](storyboard.html) — open it in a browser; it is interactive. Frames:

| # | Frame | Builds in |
|---|---|---|
| 00 | New paper form: title, slug, source tab (GitHub dir / arXiv / upload), model profile, structure method, disabled Lean field | Sprint 2 (form), 4b (method select) |
| 00b | Run page: stepper (stages grouped to seven), live log, spend, health; review pause; retry from a stage; agent trace in the log; "Open map" on finish | Sprints 2–4, 4b |
| 01 | Library: one card per paper with run state; New paper and Corpus buttons | Sprints 4 (data), 5 (polish) |
| 02 | Map + node: dashboard shell, `UTree` (section → statement → claim → Lean helpers later), node page, Node/Graph toggle, chat panel, URL per node | Sprint 5 |
| 02b | Graph: layered dependency DAG in the center panel, focus mode, claims toggle, color by class or section, compact node card on the right | Sprint 6 |
| 03 | Chat: answers cite nodes as chips that drive the center panel | Sprint 7 |
| 04 | Friction report: plain table, demoted; v1 rows are paper-internal | Sprint 7 (small) |
| 05 | Deep link + narrow screen | Sprint 5 |
| 06 | Corpus page: tiers, Lean availability, Ingest buttons, per-run metrics per method, golden diffs | Sprint 8 |

The decisions the storyboard commits to are listed at its foot and restated in § Decisions below.

---

## Current State

*As of plan creation (before Sprint 1); the per-sprint notes below describe what was built.*

### What Exists
- Nuxt 4 + Nuxt UI 4 skeleton: [app/app.vue](../../app/app.vue), [app/pages/index.vue](../../app/pages/index.vue) (placeholder hero), [app/components/AppLogo.vue](../../app/components/AppLogo.vue), [app/app.config.ts](../../app/app.config.ts), [nuxt.config.ts](../../nuxt.config.ts) (modules `@nuxt/eslint`, `@nuxt/ui`; `/` prerendered).
- Empty `server/`. `.data/kv/` from Nitro's dev storage (unused).
- `docs/BRIEF.md`, `README.md`, CI workflow, `.claude/launch.json` (dev server on 3120).
- `.env` with `AI_GATEWAY_API_KEY`; `.env.example`.
- `zod` is installed transitively; it becomes a direct dependency.

### What Changes
- New dependencies: `drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite`, `postgres`, `ai`, `@ai-sdk/vue`, `@comark/nuxt`, `katex`, `@dagrejs/dagre`, `zod`, `vitest`, `inngest` (Sprint 9), `@vercel/sandbox` and `@anthropic-ai/claude-agent-sdk` (Sprint 4b, SDK installed inside the sandbox snapshot, not in the app).
- New directories: `shared/` (types), `server/db/`, `server/pipeline/`, `server/api/`, `server/utils/`, `server/fixtures/`, `app/pages/papers/`, `app/pages/[paper]/`, `app/components/{tree,node,graph,chat,run}/`, `app/layouts/dashboard.vue`, `corpus/` (manifest + goldens; sources gitignored).
- `nuxt.config.ts`: remove the `/` prerender rule (the library is dynamic), add `runtimeConfig`, register Comark.
- `app/pages/index.vue` becomes the library.
- `README.md` gets a "How it works" section and the dev steps.

### What Stays
- The brief, the CI workflow, the color scheme, the header/footer shell for non-dashboard pages, `BRIEF.md`'s data model (extended, not replaced: `kind` gains `corollary`, `Friction.kind` gains three paper-internal kinds, nodes gain `parent_id` and `deps_inferred`).

---

## Architecture

```
Browser
  /papers/new ──POST /api/papers──▶ papers + sources + runs rows ──▶ runner.start(runId)
  /papers/[slug]/run ──poll GET /api/runs/:id every 2s; POST retry / cancel / review decisions
  /  (library)   /[paper]/[node]?view=tree|graph   /[paper]/friction   /corpus

server/pipeline/ingest.ts   ingestPaper(ctx, step: StepRunner)
  fetch     GitHub dir (REST) | arXiv e-print (tar.gz) | stored upload
  chunk     deterministic LaTeX → Skeleton (sections, statements, labels, \ref graph, proof spans, macros)
  outline   Method A: 1 whole-paper call (+ per-section variant over 150k tokens)
            Method B: Vercel Sandbox + Claude Agent SDK, waitForEvent('structure/agent.finished')
  extract   fan-out per outlined claim (cached prefix)
  resolve   \ref → mechanical edges; prose → inferred edges (flagged)
  critique  1 whole-DAG call; auto-apply high confidence; review queue → waitForEvent('review/decided')
  annotate  fan-out per dependency level, deps-first, upstream explanations in context
  classify  per node, strong model, must cite
  finalize  metrics, paper-internal friction, PaperDigest → papers.digest

Runners: LocalRunner (dev; in-process, fire-and-forget after the POST) · InngestRunner (prod; /api/inngest)
Storage: Drizzle. PGlite file in .data/pg/ when DATABASE_URL unset; postgres.js otherwise.
Models:  Vercel AI Gateway, one key. Per-step profiles (careful / standard / quick).
Chat:    POST /api/papers/[slug]/chat → streamText with the digest in instructions, gateway caching on.
```

---

## Contracts

### Shared types — `shared/types.ts`

```ts
export type NodeKind = 'definition' | 'lemma' | 'proposition' | 'theorem' | 'corollary' | 'claim' | 'remark'
export type Classification = 'standard' | 'routine' | 'novel' | 'unknown'
export type FrictionKind =
  | 'missing_in_lean' | 'missing_in_paper' | 'statement_mismatch' | 'dep_in_lean_not_paper'
  | 'dep_in_paper_not_lean' | 'weaker_in_lean' | 'unmatched_lean_decl'          // Phase 2–3
  | 'inferred_dep' | 'unresolved_ref' | 'structure_uncertain'                   // v1, paper-internal
export interface Friction { kind: FrictionKind; severity: 'info' | 'warn' | 'high'; note: string }
export interface PaperRef { label?: string; section: string; sectionTitle?: string; page?: number; file: string; line: number }
export interface LeanRef { file: string; decl: string; line?: number }

export interface ProofNode {
  id: string                    // stable slug: label-derived ('lem-sparsify') or 'claim-<parent>-<n>'
  name: string                  // semantic, model-written
  kind: NodeKind
  parent_id?: string            // claims only: the statement whose proof contains them
  statement_paper: string       // verbatim LaTeX from the source
  statement_plain: string
  explanation: string
  headline?: string             // graph card: what it establishes, ≤ ~80 chars, verb-first / "So …" / "Defines …", may hold inline $…$
  role?: string                 // graph card: what it contributes to the results that use it, ≤ ~60 chars (both: annotate's graph-labels pass; absent on older digests → card shows `name`)
  classification: Classification
  classification_cite?: string  // required when classification !== 'unknown'
  paper_ref: PaperRef
  lean_ref?: LeanRef
  deps_paper: string[]          // node ids, from \ref (mechanical)
  deps_inferred: string[]       // node ids, model-inferred from prose; also mirrored as inferred_dep friction
  deps_lean?: string[]
  friction: Friction[]
}

export interface PaperSection { id: string; title: string; level: 1 | 2 | 3; order: number; parent_id?: string; file: string; line: number }
// Additive (Oct 29, cross-ref fix): deterministic from the sources at finalize (server/pipeline/latex/equations.ts).
export interface PaperEquation { latex: string; number?: string; section: string; file: string; line: number } // latex: KaTeX-ready (aligned/gathered wrapper, \label/\tag stripped); number: best-effort display number
export interface PaperLabel { kind: 'equation' | 'section' | 'statement' | 'figure' | 'other'; target?: string; number?: string } // target: section id / node id / figure id ('figure' added with the reader)
// Additive (Oct 29, paper reader; § Post-v1: paper reader and figures):
export interface PageRect { page: number; x: number; y: number; w: number; h: number }      // PDF points, top-left origin
export interface PaperAnchor extends PageRect { part: 'statement' | 'proof'; approx?: boolean } // approx: page-only (arXiv PDF)
export type FigureKind = 'plot' | 'commutative_diagram' | 'graph' | 'diagram' | 'schematic' | 'illustration' | 'table' | 'photo' | 'other'
export interface PaperFigure {
  id: string; label?: string; number?: string; caption: string; section: string; file: string; line: number
  page?: number; rect?: PageRect; image_url?: string; width?: number; height?: number; image_source?: 'pdf' | 'file'
  graphics: string[]; tikz: boolean
  kind: FigureKind; description: string; data_summary?: string; node_ids: string[]; confidence: number; model?: string
}
export interface PaperRender {
  status: 'compiled' | 'arxiv_pdf' | 'unavailable'; engine?: string; pdf_url?: string; pages?: number; page_size?: { w: number; h: number }
  synctex: boolean; anchors?: Record<string, PaperAnchor[]>; error?: string; rendered_at: string
}

export interface PaperDigest {
  slug: string; title: string; authors?: string[]
  source: { kind: 'github' | 'arxiv' | 'upload'; ref: string }
  sections: PaperSection[]
  nodes: ProofNode[]
  root_ids: string[]            // theorems with no usedBy, main theorem first
  macros: Record<string, string> // \newcommand map for KaTeX
  equations?: Record<string, PaperEquation> // by \label; additive, absent on digests finalized before Oct 29
  labels?: Record<string, PaperLabel>       // every \label in the body, classified; additive
  render?: PaperRender                      // additive: the typeset paper (render stage)
  figures?: PaperFigure[]                   // additive: figure environments, rasterized and described (figures stage)
  generated_at: string; run_id: string
  metrics: RunMetrics
}

export type RunStage = 'fetch' | 'chunk' | 'outline' | 'extract' | 'resolve' | 'critique' | 'annotate' | 'classify' | 'render' | 'figures' | 'finalize'
export type RunStatus = 'queued' | 'running' | 'waiting_review' | 'failed' | 'cancelled' | 'complete' | 'structure_partial'
export type Profile = 'careful' | 'standard' | 'quick'
export type StructureMethod = 'pipeline' | 'agent'

export interface RunMetrics {
  statements_in_source: number; statements_extracted: number       // recall = extracted / in_source
  claims: number; refs_mechanical: number; refs_inferred: number
  schema_retries: number; critique_findings: number; review_items: number
  calls: number; tokens_in: number; tokens_out: number; tokens_cached: number; cost_usd: number
  wallclock_ms: number; per_stage: Partial<Record<RunStage, { ms: number; cost_usd: number; calls: number }>>
  golden_diff?: { missing: string[]; extra: string[]; dep_mismatches: number }
}
```

### Stage payloads — `shared/pipeline.ts`

```ts
export interface Skeleton {
  files: { path: string; lines: number }[]; mainFile: string
  macros: Record<string, string>
  sections: PaperSection[]
  statements: {
    label: string; env: string; title?: string; number?: string; sectionId: string   // number: best-effort display number ('6.3', 'A.1'), added Sprint 2
    file: string; startLine: number; endLine: number; body: string
    proof?: { file: string; startLine: number; endLine: number; lines: number }
  }[]
  refs: { fromLabel: string; toLabel: string; file: string; line: number }[]   // \ref inside a proof → edge
  unresolved: { fromLabel: string; target: string }[]                             // \ref to a label that is not a statement
}

export interface Outline {
  method: StructureMethod
  claims: {
    id: string; parentLabel: string; nameHint: string
    span: { file: string; startLine: number; endLine: number }
    restsOn: string[]              // statement labels or claim ids
    confidence: number             // 0–1
  }[]
  flags: { kind: 'unused_statement' | 'ref_to_nonstatement' | 'suspect_span' | 'possible_restatement' | 'other'; label?: string; note: string }[]
  stats: { calls: number; tokens_in: number; tokens_out: number; cost_usd: number; wallclock_ms: number; turns?: number }
}

export interface CritiqueResult {
  fixes: { kind: 'merge' | 'split' | 'drop' | 'reparent' | 'add_edge' | 'remove_edge'; target: string[]; note: string; confidence: number }[]
  ok: boolean
}
```

Proof-length threshold for outlining: proofs with `lines >= 60` get claims; shorter proofs get none. Both methods respect it.

### DB schema — `server/db/schema.ts` (Drizzle, Postgres dialect)

| Table | Columns |
|---|---|
| `papers` | `id uuid pk`, `slug text unique`, `title text`, `authors text[]`, `source_kind text`, `source_ref text`, `tier text null` (corpus), `digest jsonb null` (PaperDigest), `latest_run_id uuid null`, `created_at`, `updated_at` |
| `sources` | `id uuid pk`, `paper_id fk`, `path text`, `content text`, `bytes int` |
| `runs` | `id uuid pk`, `paper_id fk`, `parent_run_id uuid null` (retry lineage), `status text`, `stage text null`, `profile text`, `structure_method text`, `progress jsonb` (per-stage counters plus the `review_done` / `agent_finished` flags), `metrics jsonb null`, `budget_usd numeric`, `cost_usd numeric default 0`, `error text null`, `agent_token text null` (bearer for the sandbox callback), `started_at`, `finished_at null` |
| `run_events` | `id bigserial pk`, `run_id fk`, `ts timestamptz`, `stage text`, `level text` (info/warn/error), `message text`, `data jsonb null` |
| `stage_outputs` | `run_id fk`, `stage text`, `payload jsonb`, `created_at`; pk (`run_id`,`stage`) — what "retry from stage" reuses |
| `review_items` | `id uuid pk`, `run_id fk`, `kind text`, `payload jsonb` (a CritiqueResult fix), `decision text null` (accept/reject), `decided_at null` |
| `blobs` | `sha text pk` (sha256 hex), `content_type text`, `size int`, `data bytea`, `created_at` — content-addressed PDFs, SyncTeX files, figure PNGs, binary source assets (added with the reader, migration `0001_paper_reader`) |
| `source_assets` | `id uuid pk`, `paper_id fk`, `path text`, `blob_sha fk → blobs`, `bytes int` — a paper's non-LaTeX source files (figure images, TikZ inputs, `.bst`…) |

Migrations: `drizzle-kit generate` into `server/db/migrations/`; `server/db/index.ts` runs `migrate()` on first import in dev. Driver choice in `server/db/index.ts`: `process.env.DATABASE_URL ? drizzle(postgres(url)) : drizzle(new PGlite('.data/pg'))`. Nothing else in the codebase knows which.

### Step runner — `server/pipeline/runner.ts`

```ts
export interface StepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>          // plain; stages persist their own outputs to stage_outputs
  waitForEvent<T>(name: string, opts: { match: Record<string, unknown>; timeoutMs: number }): Promise<T | null>
  sleep(ms: number): Promise<void>
}
export interface RunContext { runId: string; paperId: string; profile: Profile; method: StructureMethod; budgetUsd: number }
export type PipelineFn = (ctx: RunContext, step: StepRunner) => Promise<void>
```

Rules every stage follows, so the same code runs under both runners:
- **Side effects only inside `step.run`.** Under Inngest the function body re-executes from the top on every step, so nothing at the top level of `ingestPaper` may write to the DB, call a model, or mint ids/timestamps.
- **`step.run` returns small values** (ids, counts, a stage name), never a Skeleton or source text; Inngest persists return values and they are size-limited. Stages write their big outputs to `stage_outputs` inside the step and later stages read them back by `(run_id, stage)`.
- **Stage reuse on retry:** `POST /api/runs/:id/retry { fromStage }` creates a new run with `parent_run_id` and copies the parent's `stage_outputs` rows for every stage before `fromStage` into the new run; each stage starts by checking for its own row and skips the work if present. No memoization lives in the runner.
- **Signals:** `waitForEvent('review/decided')` resolves when `runs.progress.review_done` is true; `waitForEvent('structure/agent.finished')` when `runs.progress.agent_finished` is true. Routes set those flags (and, under Inngest, also `inngest.send` the event). The LocalRunner polls the flags every 2s.

`LocalRunner`: `run` executes `fn` immediately, writes a `run_events` row before and after, checks `runs.status === 'cancelled'` and throws `BudgetExceeded` if `runs.cost_usd` passes `budget_usd` at a step boundary. Started from `POST /api/papers` with `void runner.start(runId)` after the response is sent; a crash marks the run `failed`. One run at a time: `start` returns immediately if another run is `running` and leaves the new one `queued`; the drainer below picks it up. Dev only; a `console.warn` fires if it is constructed outside `import.meta.dev` and no `INNGEST_EVENT_KEY` exists.

`server/plugins/runner.ts` (Nitro plugin, dev only): on boot, mark every `running` run `failed` with `error: 'dev server restarted'` (Nitro restarts on any `server/` edit, so an in-flight run cannot survive) and start the oldest `queued` run; after each run finishes, start the next `queued` one. Retry-from-stage makes a restart cheap.

Vercel ceiling: under Inngest each `step.run` is one function invocation. A whole-paper Opus `reasoning: 'high'` outline or critique is the longest step; set `maxDuration` on `/api/inngest` to the plan's maximum (Fluid compute allows up to 800 s) and keep the 250k-token whoppers inside it.

`InngestRunner` (Sprint 9): wraps Inngest's `step.run` / `step.waitForEvent` / `step.sleep`; the function is `inngest.createFunction({ id: 'ingest-paper' }, { event: 'paper/ingest.requested' }, ({ event, step }) => ingestPaper(event.data, new InngestRunner(step)))`. Fan-out inside `ingestPaper` is `Promise.all(items.map(i => step.run(...)))`, which is valid under both runners.

### Pipeline stages and their models — `server/pipeline/stages/*.ts`

| Stage | Reads | Writes | Model by profile (careful / standard / quick) |
|---|---|---|---|
| `fetch` | `papers.source_*` | `sources` rows | none |
| `chunk` | `sources` | `stage_outputs.chunk` = Skeleton | none |
| `outline` | Skeleton + all source text | `stage_outputs.outline` = Outline | Method A: opus-5.5 / gpt-6-sol / sonnet-5.5, `reasoning: 'high'`. Method B: the agent (see § Two methods) |
| `extract` | Outline + Skeleton | `stage_outputs.extract` = nodes without prose | sonnet-5.5 / sonnet-5.5 / haiku-5.5; one call per claim with the whole source as cached prefix; labeled statements need **no** model call (body comes from the Skeleton) |
| `resolve` | nodes + Skeleton refs + proof text | nodes with `deps_paper`, `deps_inferred` | mechanical; inferred edges by sonnet-5.5 / sonnet-5.5 / haiku-5.5 per node whose proof mentions a result without a `\ref` |
| `critique` | assembled DAG + source | CritiqueResult; `review_items` | same as outline, `reasoning: 'high'`. Fixes with `confidence >= 0.85` apply; the rest become review items, status → `waiting_review`, `waitForEvent('review/decided')` |
| `annotate` | DAG in topological levels | `name`, `statement_plain`, `explanation` | sonnet-5.5 / sonnet-5.5 / haiku-5.5; one call per node, batched per level, with its deps' finished explanations in context |
| `classify` | node + statement + deps | `classification`, `classification_cite` | opus-5.5 / gpt-6-sol / sonnet-5.5; `novel` must cite why nothing prior covers it |
| `render` | sources + `source_assets`, Skeleton, Outline, classify nodes | `stage_outputs.render` (status, PDF/SyncTeX blob shas, node anchors, figures with crops); blobs | none (TeX Live in a no-network Vercel Sandbox) |
| `figures` | `stage_outputs.render`, nodes | `stage_outputs.figures` = PaperFigure[] + raw vision answers | opus-5.5 / opus-5.5 / sonnet-5.5, image input, one call per figure |
| `finalize` | everything | `papers.digest` (with `render`, `figures`, figure labels when present), `runs.metrics`, `runs.status = complete` | none |

Model registry contract — `server/utils/aiModels.ts`:

```ts
export const PROFILES: Record<Profile, Record<'outline' | 'extract' | 'resolve' | 'critique' | 'annotate' | 'classify' | 'agent' | 'figures', string>> = {  // figures: added with the reader
  careful:  { outline: 'anthropic/claude-opus-5.5', critique: 'anthropic/claude-opus-5.5', classify: 'anthropic/claude-opus-5.5', agent: 'anthropic/claude-opus-5.5',
              extract: 'anthropic/claude-sonnet-5.5', resolve: 'anthropic/claude-sonnet-5.5', annotate: 'anthropic/claude-sonnet-5.5' },
  standard: { outline: 'openai/gpt-6-sol', critique: 'openai/gpt-6-sol', classify: 'openai/gpt-6-sol', agent: 'anthropic/claude-sonnet-5.5',
              extract: 'anthropic/claude-sonnet-5.5', resolve: 'anthropic/claude-sonnet-5.5', annotate: 'anthropic/claude-sonnet-5.5' },
  quick:    { outline: 'anthropic/claude-sonnet-5.5', critique: 'anthropic/claude-sonnet-5.5', classify: 'anthropic/claude-sonnet-5.5', agent: 'anthropic/claude-haiku-5.5',
              extract: 'anthropic/claude-haiku-5.5', resolve: 'anthropic/claude-haiku-5.5', annotate: 'anthropic/claude-haiku-5.5' }
}
export const MODELS = { chat: 'anthropic/claude-sonnet-5.5', titleGen: 'openai/gpt-6-luna' } as const
```

Every model call goes through `server/pipeline/llm.ts` → `callObject({ model, schema, instructions, prompt, reasoning?, cache?: boolean })`, which sets `providerOptions.gateway.caching = 'auto'` when `cache`, retries once on schema failure with the validation error appended, records `usage` (in/out/cached tokens, cost from the gateway's `providerMetadata` or the price table) to `run_events`, and increments `runs.cost_usd`. Prices live in `server/utils/aiModels.ts` as a fallback table (per million tokens, Oct 29: opus-5.5 4/20, sonnet-5.5 2/10, haiku-5.5 0.1/0.5, gpt-6-sol 2/10, gpt-6-luna 0.1/0.5).

Default profile is `careful` when the source is over 30 pages (estimate: source bytes / 3,000) or over 100k tokens, else `standard`. The form shows the estimate and lets the operator override.

### API routes — `server/api/`

| Route | Purpose |
|---|---|
| `GET /api/papers` | Library list: papers joined with latest run (status, stage, metrics summary) |
| `POST /api/papers` | Body (zod): `{ title, slug, source: { kind: 'github', url } \| { kind: 'arxiv', id } \| { kind: 'upload' } , profile, method, budgetUsd }`; multipart when upload. Slug: `^[a-z0-9-]{2,40}$`, not in the reserved set `papers`, `corpus`, `api`, `toy`. Creates paper + sources + run, starts the runner (LocalRunner in dev; `inngest.send` after Sprint 9), returns `{ paperId, runId }` |
| `GET /api/papers/:slug` | Paper row + digest (null until complete) |
| `GET /api/runs/:id` | Run row + last 200 events + pending review items |
| `POST /api/runs/:id/retry` | `{ fromStage }` → new run reusing `stage_outputs` before that stage |
| `POST /api/runs/:id/cancel` | Sets `cancelled`; runners check at step boundaries |
| `POST /api/runs/:id/review` | `{ itemId, decision }`; when none pending, emits `review/decided` |
| `POST /api/runs/:id/events` | Agent callback (Method B). Bearer `runs.agent_token`. Body `{ message, data? }` or `{ finished: true, outline }` |
| `POST /api/papers/preview` | `{ source }` → `{ files: [{ path, bytes }], mainFile, estTokens, estPages }`; drives the profile default and the estimate line on the form |
| `GET /api/papers/toy` | Dev only: serves `server/fixtures/toy-digest.ts` when no `toy` row exists |
| `POST /api/papers/:slug/labels` | Backfill/redo the graph cards' `headline` + `role`: annotate's single graph-labels pass (`server/pipeline/graphLabels.ts`) on the digest's run profile's annotate model, cost recorded on the digest's run; patches `papers.digest`. Returns `{ labeled, total, missing, long, cost_usd, calls, model }`. Button: run page, "Regenerate graph labels" |
| `POST /api/papers/:slug/chat` | `useChat` transport. Body `{ messages }`. `streamText`, digest in instructions, tools `read_node` / `search_paper` / `trace` / `ancestors` (outputs typed in `shared/api.ts`; stream carries `tool-<name>` parts), `stopWhen: isStepCount(5)` with the last step forced to answer, caching on, calm error mapping |
| `GET /api/blobs/:sha` | Content-addressed bytes (PDF, PNG), immutable cache headers, single-range `Range` support (PDF.js streams the PDF) |
| `GET /api/corpus` | Manifest joined with latest run per slug and method |
| `POST /api/corpus/:slug/ingest` | `{ method, profile }` → same as `POST /api/papers` with manifest-filled fields |
| `/api/inngest` | Sprint 9 only |

### Pages and components — `app/`

| Path | Role |
|---|---|
| `pages/index.vue` | Library (frame 01) |
| `pages/papers/new.vue` | New paper form (frame 00) |
| `pages/papers/[slug]/run.vue` | Run page (frame 00b); polls while status is queued/running/waiting_review |
| `pages/[paper]/index.vue` | Redirects to `/[paper]/<root_ids[0]>?view=paper&page=1` when the digest has `render`, else to the node page |
| `pages/[paper]/[node].vue` | Dashboard shell (frame 02 / 02b); `?view=paper\|tree\|graph` (no `view` = node page), `?mode=focus`, `?claims=1`, `?figure=<id>` / `?page=N` (reader) |
| `pages/[paper]/friction.vue` | Friction table (frame 04) |
| `pages/corpus.vue` | Corpus page (frame 06) |
| `layouts/dashboard.vue` | `UDashboardGroup` wrapper, no header/footer |
| `components/tree/PaperTree.vue` | `UTree` over sections → statements → claims; item slot renders kind icon, novel badge, friction dot |
| `components/node/NodePage.vue`, `NodeChip.vue`, `MathText.vue` | Node page (full/compact), dependency chips, KaTeX render with digest macros |
| `components/graph/ProofGraph.vue` | **Custom.** dagre layout → HTML cards over an SVG edge layer in one d3-zoom viewport (zoom, pan, minimap, keyboard); props `nodes, selectedId, mode, showClaims, colorBy, viewKey`; emits `select` |
| `components/reader/PaperReader.vue`, `components/figure/FigureCard.vue` | PDF.js reader with SyncTeX overlays; figure image + caption + vision description (popover, node page, reader dialog) |
| `components/chat/ChatPanel.vue`, `MessageContent.vue`, `NodeLink.vue` | `UChatMessages` + `UChatPrompt`; Comark with a `[[node-id]]` inline component |
| `components/run/RunStepper.vue`, `RunLog.vue`, `ReviewQueue.vue` | `UStepper`, event list, accept/reject per item |
| `composables/useDigest.ts`, `useSelection.ts` | Fetch + index the digest once; selected node id ↔ route |

---

## Model strategy

**Principle: the skeleton comes from the LaTeX, never from the model.** When the source has `\begin{lemma}…\label{}` and `\ref`s, the statement list and the explicit dependency graph are deterministic facts computed in `chunk` with no model call. The model's structural job is only the part the source leaves implicit: the major claims inside long proofs, the dependencies stated in prose, and whether the assembled DAG is coherent. Getting that part wrong poisons annotation (which runs in dependency order) and everything downstream, so it gets the strongest model, the most context, and a critique pass before any prose is written.

**Gateway facts** (verified Oct 29 with the project key): all candidate models have a 1M-token context; the ETH source is ~85k tokens and a 200-page whopper is ~250k, so the structural pass reads the whole paper, and section-level calls carry the whole paper as a cached prefix. A whole-paper Opus 5.5 read costs about $0.35; ten cached calls on top are cents. Careful on ETH is single-digit dollars; Quick is under a dollar.

**Why outline-then-critique rather than one big extract.** Section-by-section extraction with no global view is how a long proof gets chopped at the wrong joints: the model sees a 12-page proof, invents eight "claims" that are really one, misses the one that the next section silently relies on, and annotation then explains a graph that doesn't match the paper. Reading the whole paper first and committing to an outline, then extracting against that outline, then critiquing the assembled DAG before any prose is written, puts the expensive judgment where it's cheap to be wrong (two calls, re-runnable from the run page) and keeps the fan-out steps narrow.

**Scale estimate for ETH, Method A:** 1 outline + ~9 claim extracts + ~10 inferred-dep calls + 1 critique + 53 annotate + 53 classify ≈ 130 calls, most cheap and cached. Method B: unknown going in; capped at 200 turns and the run budget.

### Two structure methods, both built, compared on the corpus

Both produce the same `Outline` and every later stage is identical, so the method is one select on the form and the rest of the pipeline cannot tell which ran.

**Method A — Pipeline.** `stages/outline.ts`. One whole-paper call with the Skeleton and the paper's own overview section (if any) in the prompt; output is the Outline schema. For sources over 150k tokens, the hierarchical variant: one call per top-level section with the whole paper as cached prefix, then one merge call that dedupes and reconciles `restsOn`. Fixed call count, about sections + 2.

**Method B — Agent in a Vercel Sandbox.** `stages/outline-agent.ts`. The step creates a non-persistent sandbox from a snapshot that has Node 24 and `@anthropic-ai/claude-agent-sdk` preinstalled (`persistent: false`, `vcpus: 2`, `timeout` 45 min then `extendTimeout` up to the method's ceiling, `networkPolicy` allowing only `ai-gateway.vercel.sh` and the app's own host for the callback). It writes `/vercel/sandbox/paper/{sources, skeleton.json, TASK.md, validate_outline.mjs}` and runs `node agent.mjs` detached. `agent.mjs` calls the Agent SDK's `query()` with the gateway env as the gateway's coding-agent reference documents it (`ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh/claude-code`, `ANTHROPIC_AUTH_TOKEN=<gateway key>`, `ANTHROPIC_API_KEY=` empty), model from `PROFILES[profile].agent`, built-in Read/Grep/Bash tools, `maxTurns: 200`, and a hook that POSTs each tool use to `/api/runs/:id/events`. The SDK ships its CLI as platform optional deps, so `npm i` at snapshot time is enough and nothing is downloaded at run time through the allow-list. `TASK.md` states the goal (outline the major claims inside every proof of 60+ lines, with spans and what each rests on), the Outline JSON schema, the validator to run before finishing, and where to write `outline.json`. The step then `waitForEvent('structure/agent.finished', { timeoutMs })`; on timeout or budget it reads whatever `outline.json` exists (`readFileToBuffer`), marks the run `structure_partial`, and stops the sandbox in a `finally`. Auth for the Sandbox SDK: `VERCEL_OIDC_TOKEN` from `vercel env pull` locally, automatic on Vercel.

**What the corpus answers.** Per paper × method: claims found, critique findings, review-queue size, golden diff (tier 1), calls, tokens, cost, wallclock, and for B the turn count. ETH runs first; the whoppers after. If B wins on long papers and A on short ones, the default becomes size-dependent, which the profile logic already supports.

---

## Sprint Breakdown

### Sprint 1: Foundation — DB, types, runner, fixture — Foundational [Complete]
**Goal:** The app boots with a Postgres schema, shared types, a working `LocalRunner` that executes a no-op pipeline and records events, and a fixture digest the UI sprints can build against.
**Estimated effort:** 4 hours

#### Tasks
- 1.1 Dependencies and config
  - `npm i drizzle-orm @electric-sql/pglite postgres zod ai @ai-sdk/vue @comark/nuxt katex @dagrejs/dagre` and `npm i -D drizzle-kit vitest` (katex 0.19 ships its own types; no `@types/katex`). `@comark/nuxt` is 0.8.x; check `defineMarkdownComponent` against the installed version rather than copying an older 0.6-era `Comark.ts` blind.
  - `package.json` scripts: add `"test": "vitest run"`, `"db:generate": "drizzle-kit generate"`; `drizzle.config.ts` at root (dialect postgres, schema `server/db/schema.ts`, out `server/db/migrations`)
  - `nuxt.config.ts`: remove `routeRules['/']`, add `runtimeConfig: { public: { appUrl: 'http://localhost:3120' } }` only (`AI_GATEWAY_API_KEY` and `DATABASE_URL` are read from `process.env` by the gateway and `server/db/index.ts`; putting them in `runtimeConfig` would require `NUXT_`-prefixed names), add `@comark/nuxt` module
  - Imports from `shared/` are explicit (`import type { ProofNode } from '#shared/types'`); Nuxt 4 auto-imports only `shared/utils/` and `shared/types/` directories, and this plan uses single files
  - `.env.example`: add `DATABASE_URL`, `NUXT_PUBLIC_APP_URL`, `VERCEL_OIDC_TOKEN` (commented)
- 1.2 Shared types
  - Files: `shared/types.ts`, `shared/pipeline.ts` exactly as § Contracts; `shared/schemas.ts` with zod schemas for `Outline`, `CritiqueResult`, the extract/annotate/classify outputs, and the `POST /api/papers` body
- 1.3 DB
  - Files: `server/db/schema.ts` (§ Contracts), `server/db/index.ts` (driver switch, `migrate()` on first import in dev, `useDb()` export), `server/db/migrations/` generated
  - `server/utils/runs.ts`: `createRun`, `appendEvent`, `setStage`, `setStatus`, `addCost`, `getRunView` (row + events + review items)
- 1.4 Runner and pipeline skeleton
  - Files: `server/pipeline/runner.ts` (interface + `LocalRunner` per § Contracts), `server/plugins/runner.ts` (boot sweep + queue drainer), `server/pipeline/ingest.ts` (`ingestPaper` calling each stage in order inside `step.run`; stages are stubs that log and return a count), `server/pipeline/stages/index.ts`, `server/utils/stageOutputs.ts` (`get`, `put`, `copyForward(parentRunId, runId, beforeStage)`)
  - `server/pipeline/llm.ts`: `callObject` as § Contracts (real gateway call, used from Sprint 3)
  - `server/utils/aiModels.ts`: `PROFILES`, `MODELS`, `PRICES`, `estimateCost(tokens, model)`
- 1.5 Fixture
  - File: `server/fixtures/toy-digest.ts`: a hand-written `PaperDigest` for a 3-section, 8-node toy paper (two theorems, four lemmas, one definition, one claim; one inferred dep; macros `{ '\\F': '\\mathbb{F}' }`), plus `GET /api/papers/toy` serving it when `import.meta.dev` and no row exists. UI sprints build against it.
- 1.6 Health
  - File: `server/api/health.get.ts` → `{ db: 'pglite' | 'postgres', migrations: n, gateway: boolean }` (gateway true when the key is set; no call)
- 1.7 Tests
  - `tests/runner.test.ts`: LocalRunner runs three steps in order, records six events, throws `BudgetExceeded` when `cost_usd > budget_usd`, leaves a second run `queued` while one is `running`; `copyForward` copies only stages before `fromStage`
  - `vitest.config.ts` with an isolated PGlite per test file (in-memory)

#### Verification
- [x] `npm run dev` boots with no `DATABASE_URL`; `.data/pg/` appears; `GET /api/health` returns `db: 'pglite'` (`{ db: 'pglite', migrations: 1, gateway: true }`)
- [x] `npx vitest run` green (10 tests)
- [x] `GET /api/papers/toy` returns the fixture (8 nodes, 3 sections)
- [x] `npm run lint && npm run typecheck` clean

#### Deviations and notes (Oct 29)
- **Installed versions:** `ai` 7.0.156, `@ai-sdk/vue` 4.0.156, `@ai-sdk/gateway` 4.0.129 (transitive), `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.13, `postgres` 3.4.9, `zod` 4.6.7, `@comark/nuxt` 0.8.1 (exports `defineMarkdownComponent`, `defineComarkPlugin`), `katex` **0.18.10** (latest on npm; ships its own types at `types/katex.d.ts`, so still no `@types/katex`), `@dagrejs/dagre` 3.1.3, `vitest` 5.0.5. Added `@types/node@22` (dev): `nuxt typecheck` failed on `process` / `node:fs` without it.
- **`useDb()` is async** (`const db = await useDb()`): it builds and migrates on the first call instead of as an import side effect, so nothing needs top-level await in the Nitro bundle. Also exports `createDb({ memory })` (tests), `setDb(db)` (test injection), `dbDriver()`, `appliedMigrations(db)`. Migrations run for PGlite always and for `DATABASE_URL` only when `import.meta.dev`; prod migrations are a deploy step to settle in Sprint 9 (the migrations folder is read from `process.cwd()/server/db/migrations` and is not bundled into `.output`).
- **`run_events.stage`** is `not null`; lifecycle events outside any stage use `'run'`. **`runs.started_at`** defaults to insert time and is overwritten when the runner claims a queued run; the drainer orders the queue by it. `budget_usd` / `cost_usd` are `numeric` in `mode: 'number'`.
- **Additive shared exports:** `RUN_STAGES` (canonical order), `CLAIM_PROOF_LINES = 60`, `RunProgress` (shape of `runs.progress`) in `shared/pipeline.ts`; `RESERVED_SLUGS`, `slugSchema`, `paperSourceSchema`, `createPaperSchema`, `outlineModelSchema` (claims + flags only; the stage fills `method`/`stats`), `extractClaimSchema`, `inferredDepsSchema`, `annotateSchema`, `classifySchema`, `critiqueSchema`, `outlineSchema` in `shared/schemas.ts`.
- **`stageOutputs`** is exported as a namespace object `{ get, put, copyForward }` so Nitro's server/utils auto-import doesn't put bare `get`/`put` in global scope. `copyForward` returns the stages it copied (for the "reused stage_outputs.X" log line).
- **`server/utils/runs.ts`** also has `getRun`, `patchProgress` (jsonb `||` merge) and `bumpProgress(runId, key, by)` (atomic counter) beyond the listed six; `addCost` is an atomic SQL increment so fan-out steps can't lose spend.
- **Runner API:** `runner.start(runId, { pipeline?, pollMs? })` resolves once the run is claimed and returns `{ result: 'started' | 'queued' | 'skipped', done }` (`done` resolves when this run and any drained after it finish; routes do `void runner.start(id)`). Also `runner.drain()` and `runner.sweep()` (used by `server/plugins/runner.ts`). Default pipeline is `ingestPaper`, loaded by dynamic import to avoid a runner ↔ stages cycle. `LocalRunner.waitForEvent` returns `{ name, data: match }` when the flag is set, `null` on timeout, and throws `RunCancelled` if the run is cancelled while waiting. Step names may be `stage:item` (e.g. `extract:claim-3`); events are logged under the prefix stage. Errors: `BudgetExceeded` → `failed` with `error: 'budget'`; `RunCancelled` → status stays `cancelled`; anything else → `failed` with the message. A run still `running` after the pipeline returns is set `complete` (a stage that set `structure_partial` keeps it).
- **Stages:** one file per stage in `server/pipeline/stages/` (each currently `stubStage(stage)` from `stub.ts`: sets `runs.stage`, logs, returns 0), assembled in `stages/index.ts` as `STAGES: Record<RunStage, StageFn>` with `StageFn = (ctx: RunContext) => Promise<number>`. Later sprints replace a single stage file; the Method B outline will need `outline.ts` to branch on `ctx.method`.
- **`callObject`** takes two additive options, `runId` and `stage` (where usage is recorded), and returns `{ object, usage }`. Verified live against the gateway: `providerMetadata.gateway.cost` is a **string** (e.g. `"0.0000279"`), parsed; the price table is the fallback. On retry it bumps `progress.schema_retries`; every call bumps `progress.calls`, `addCost`s, and logs a `model call <model>` event with tokens/cost. Spend from a failed attempt is still recorded.
- **`GET /api/papers/toy`** returns `{ paper, digest }` (the shape `GET /api/papers/:slug` should also use); `paper.id` is `null` for the fixture. (Later folded into `[slug].get.ts`: a static `toy.get.ts` shadowed every `/api/papers/toy/*` route, including chat.)
- **Tests** call `createDb({ memory: true })` + `setDb(db)` per file; vitest aliases `#shared` (`vitest.config.ts`). `tests/` is not covered by `nuxt typecheck` (not in any generated tsconfig include). Extra tests beyond the plan: waitForEvent flag/timeout, cancel at boundary, the stub `ingestPaper` end to end, boot sweep, `put` upsert.
- Not verified: `nuxt build` with PGlite (WASM) bundled; dev only so far.
- **Sprint 8 fixes (8.7):** (1) `stageOutputs.put` passes payloads through `jsonbSafe` (strips `\u0000` and unpaired surrogates, which Postgres jsonb rejects): the ALWZ agent run failed at its final `stage_outputs.classify` write after 100+ calls. The driver's own message was lost, so the cause is inferred, not confirmed; the retry from classify succeeded. (2) `failRun` records `errorText(err)`: Drizzle's "Failed query: … params: …" message (126 kB there, every param inlined) becomes `<driver cause> (<first 200 chars of the query>)`. Both tested in `tests/runner.test.ts`.

---

### Sprint 2: Ingest UI, source fetch, chunker, run page [Complete]
**Goal:** Submit the New paper form with the ETH GitHub directory URL and watch the run page reach the end of `chunk` with a correct Skeleton (10 sections, 44 labeled statements, 161 refs). *Actual source: 10 sections, 36 statements (35 labeled), 40 statement refs inside proofs; see deviations.*
**Estimated effort:** 6 hours

#### Tasks
- 2.1 Source fetchers
  - Files: `server/pipeline/sources/github.ts` (parse `github.com/<owner>/<repo>/tree/<ref>/<path>`; list via `GET /repos/{owner}/{repo}/contents/{path}?ref=`; download every `.tex`, `.bib`, `.sty`, `.cls`; unauthenticated is fine for public repos, honor `GITHUB_TOKEN` if set), `arxiv.ts` (`GET https://arxiv.org/e-print/<id>` → gunzip + untar in memory with `tar-stream`, or a single `.tex` if not a tarball), `upload.ts` (multipart via `readMultipartFormData`; accept `.tex` files or one `.zip`, unzip with `fflate`; reject over 4 MB total with a clear message)
  - Add `tar-stream`, `fflate` deps
  - Main-file detection: the `.tex` containing `\documentclass`; if several, the one with `\begin{document}`; else error with the candidates listed
- 2.2 Chunker (deterministic)
  - File: `server/pipeline/latex/chunk.ts` → `Skeleton`
  - Inline `\input{}` / `\include{}` (resolve `.tex` extension, keep per-file line numbers in every span). Strip comments (`%` to EOL, not `\%`). Extract `\newcommand`/`\renewcommand`/`\DeclareMathOperator` from the preamble into `macros`.
  - Sections: `\section`, `\subsection`, `\subsubsection` (+ starred), with `\label` on the following line attached. Appendices after `\appendix` get letters.
  - Statements: `\begin{<env>}[title]` … `\end{<env>}` for env ∈ configured set (theorem, lemma, proposition, corollary, definition, claim, remark, conjecture, fact, observation; also `\newtheorem`-declared names). Label = the first `\label{}` inside; unlabeled statements get a synthetic label `unlabeled-<section>-<n>`. Body = inner LaTeX.
  - Proofs: `\begin{proof}` … `\end{proof}` attached to the nearest preceding statement without a proof. `\begin{proof}[Proof of Theorem~\ref{x}]` attaches to `x`.
  - Refs: every `\ref`, `\cref`, `\Cref`, `\eqref`, `\autoref` inside a proof span whose target is a statement label → `refs`; targets that are equations/sections/figures → `unresolved` (informational, not friction)
  - Numbering: best effort. Emulate `\newtheorem` counters (shared `[theorem]` counter vs independent, reset per section) to produce `Theorem 1.1`-style display numbers; where the preamble can't be parsed, fall back to `title ?? label`. Numbering never blocks the statement-count assertions.
- 2.3 `POST /api/papers` + form page
  - Files: `server/api/papers.post.ts`, `app/pages/papers/new.vue`
  - Form per frame 00: `UForm` with zod schema; `UTabs` source kind; `UFileUpload` on the upload tab; `USelectMenu` profile (default from the size estimate once the URL is validated by a `POST /api/papers/preview` that lists the files and byte size); structure method `UTabs` (pipeline default; agent enabled in 4b); disabled Lean field; budget `UInputNumber` default 15; estimate line.
  - On submit: create rows, `void runner.start(runId)`, `navigateTo('/papers/<slug>/run')`
- 2.4 Run page
  - Files: `app/pages/papers/[slug]/run.vue`, `components/run/RunStepper.vue`, `RunLog.vue`, `server/api/runs/[id].get.ts`, `server/api/runs/[id]/cancel.post.ts`, `server/api/runs/[id]/retry.post.ts`
  - `useFetch` + `refreshNuxtData` every 2s while status ∈ queued/running/waiting_review. `UStepper` items from `RunStage[]` with per-stage counters from `runs.progress`. Log is the last 200 events, newest at the bottom, auto-scroll. Spend/Health cards from `progress`. Cancel button; "Re-run from stage…" `UDropdownMenu` after completion or failure; "Open map" when complete.
- 2.5 Stages `fetch` and `chunk` wired into `ingestPaper` with progress counters (`files`, `sections`, `statements`, `refs`)
- 2.6 Tests: `tests/chunk.test.ts` on three fixtures in `tests/fixtures/latex/`: (a) a 40-line toy with `\input`, (b) a `\newtheorem{lemma}[theorem]` shared-counter sample, (c) the real ETH `main_full_version.tex` + includes (downloaded once into `tests/fixtures/latex/eth/`, gitignored, with a `fetch-fixtures` test helper that pulls from GitHub when missing). Assert ETH: 10 top-level sections, 44 labeled statements, 161 statement refs, `lem:sparsify` has a proof span, macros include whatever the preamble defines.

#### Verification
- [x] Submit the ETH GitHub directory URL from the form → run page shows Fetch ✓ (4 files · 258 KB) and Chunk ✓ (10 sections · 36 statements · 40 refs)
- [x] Submit arXiv `1907.00847` → Fetch ✓ (1 file, 20 KB), Chunk ✓ with 8 statements (5 labeled), 3 sections, 4 refs
- [x] Upload the same ETH `.tex` files (form, Upload tab) → identical counters and chunk log line (statements, refs, unresolved, proofs, long proofs, warnings)
- [x] Cancel mid-run flips status to `cancelled` at the next step (cancelled during the arXiv fetch; chunk never started); retry from `chunk` of that run reused `stage_outputs.fetch`
- [x] `tests/chunk.test.ts` green (10 tests; 20 total); lint/typecheck clean
- [x] Screenshots: `sprint2_form_filled.webp`, `sprint2_run_after_chunk.webp`, `sprint2_run_cancelled.webp`. A mid-chunk shot isn't catchable: chunk takes ~17 ms on ETH and fetch ~0.2–0.8 s, faster than the 2 s poll; the cancelled run stands in for an in-flight state.

#### Deviations and notes (Oct 29)
- **ETH source:** `https://github.com/openai/math/tree/main/preprints/The-Exponential-Time-Hypothesis-is-False-October-25-2026/build` (4 files: `main_full_version.tex` 214,857 B + `quantitative-{circuits,contraction,reduction}.tex`; `\input` at lines 4269/4326/4327). The repo's `README` in the parent directory and `paper.pdf` are not sources.
- **Actual ETH counts (trust the source):** 10 top-level sections (1–6, A–D; D is `quantitative-reduction.tex`), 58 subsections; **36 statements, 35 labeled** (3 theorem, 5 corollary, 22 lemma, 3 proposition, 2 definition, 1 unlabeled remark → `unlabeled-4.3-1`); 32 have a proof environment, 9 proofs ≥ 60 lines; **40 statement refs inside proofs** (34 unique edges) + 44 unresolved (refs from proofs to equations/sections). The plan's 44 / 161 came from the storyboard and match nothing in the revised (Oct 25) source: the whole text has 113 `\ref`s to statement labels (40 in proofs, 5 in statement bodies, the rest in intro/overview prose), 180 `\ref` + 98 `\eqref` overall, 178 `\label`s. `tests/chunk.test.ts` asserts the real numbers.
- **`lem:sparsify` has no proof environment** (the text says Appendix A proves it; the appendix lemmas `lem:spar-*` carry the proofs). The test asserts `lem:sparse-checks` (158-line proof) instead and asserts `lem:sparsify` has none. Sprint 3's outline prompt should know that a statement can be proved by a whole appendix.
- **`thm:main` has two titled proofs** in `quantitative-reduction.tex` (lines 67 and 317: "fixed-density bound" / "arbitrary-density bound"). `Skeleton.statements[].proof` is singular, so the first span is kept and both proofs' refs count; the chunker emits a warning (shown in the run log).
- **Contract addition:** `Skeleton.statements[].number?` (display number from emulated `\newtheorem` counters; ETH numbers match amsart, e.g. `lem:sparsify` = 6.3, `thm:tensor-contraction` = D.1). Section ids are the display numbers (`'1'`, `'2.4'`, `'A'`), starred sections `s<n>`, statements before any section get `sectionId: 'front'`.
- **Chunker rules beyond the plan:** a statement's label is the first `\label` *not inside a nested environment* (so an `equation` label never names its statement); refs inside a nested proof are attributed only to the nested proof's statement; self-refs are dropped; `\labelcref`/`\nameref` also count as refs; `\texorpdfstring{a}{b}` titles keep `a`. Statement-body refs are not edges (per contract) — 5 on ETH, a possible Sprint 3 addition. Chunk warnings (missing `\input`, unclosed env, second proof, unattachable proof) go to the run log as `warn` events and `progress.chunk_warnings`.
- **Fetch split:** `POST /api/papers` stores upload sources itself (multipart: a `payload` JSON field + files); GitHub/arXiv download in the `fetch` stage, which replaces the paper's `sources` rows and writes `stage_outputs.fetch` = `{ files, mainFile, estTokens, estPages }` so retry-from-chunk skips it. `POST /api/papers/preview` handles github/arxiv only; uploads are summarized in the browser. Remote downloads are cached in-process for 10 min so preview → submit doesn't fetch twice (this is why fetch after a preview shows ~20 ms).
- **GitHub:** listing via the contents API (recurses 3 levels; 60 req/h unauthenticated, `GITHUB_TOKEN` honored), file bodies from `download_url` (raw, not API-rate-limited). `/blob/` URLs use the file's directory; a bare repo URL uses the root. **arXiv:** gzip → tar (tar-stream) or single `.tex`; PDF-only e-prints are a 422. Only `.tex/.bib/.sty/.cls/.bbl` are kept everywhere (Postgres `text`, NULs stripped).
- **Estimates:** `estTokens = bytes / 3.1` (ETH 264 KB → ~85k, matching the gateway count), `estPages = bytes / 3000` (ETH → 88, so the form defaults to `careful`). The estimate line's cost uses a rough per-profile $/k-token (careful 0.045, standard 0.025, quick 0.006) — replaced in Sprint 8 with measured numbers (careful 0.045, standard 0.03; quick unmeasured).
- **Run page:** route resolves `?run=<id>` or the paper's `latestRunId` via `GET /api/papers/:slug` (Sprint 5's route). Stepper groups nine stages to seven (frame 00b); stages that only logged the Sprint 1 stub message render as "stub · built in Sprint N" instead of a check. `GET /api/runs/:id` adds `paper { slug, title, sourceKind, sourceRef, latestRunId }` and strips `agentToken`; response type in `shared/runs.ts` (additive). Retry and create both set `papers.latest_run_id`. Cancel on a terminal run is a 409; retry on a queued/running run is a 409.
- **Tests:** `tests/runner.test.ts`'s end-to-end case now seeds an upload `sources` row (the real fetch/chunk stages run) and asserts the chunk counters. ETH fixture is downloaded by `tests/fixtures/fetch-fixtures.ts` from raw.githubusercontent.com when missing (gitignored, as is `corpus/sources/`).
- **Corpus note for 8.1 (applied in Sprint 8's corpus table):** arXiv `2311.05330` is *not* the PFR paper (it's an ACM paper with no theorem environments → 0 statements, correctly); PFR is `2311.05762` (ingested in dev as slug `pfr`: 21 statements, 19 labeled, 6 refs).
- Dev DB now holds test papers `eth`, `eth-uploaded`, `sensitivity`, `pfr`, `pfr-cancel-test` (the last is titled "On a conjecture of Marton" but is 2311.05330; delete it when convenient).
- Deps: `tar-stream` 3.2.2, `fflate` 0.8.3, `@types/tar-stream` 3.1.5 (dev).
- **Sprint 8 fix (8.7): sections titled "Proof of Lemma~\ref{x}" are proofs.** Rao's *Coding for Sunflowers* proves its main lemma in `\section{Proof of Lemma \ref{lemma:code}}` and ALWZ proves its main theorem in `\section{Proof of \Cref{thm:robust_sunflower}}` (180 lines with subsections), with no proof environment, so the chunker saw no proof (no refs, no outline). A `\section`/`\subsection`/`\subsubsection` (starred too) whose title starts "Proof(s) of" and `\ref`s a statement now gives that statement a proof span to the next section at the same or a higher level; it attaches like a titled proof environment (a statement that also has a proof environment gets the usual "second proof" warning), and its refs are scanned with nested proofs skipped. Rao: `\ref` edges 1 → 3; ALWZ: the theorem's proof is now outlined (5 claims). Test in `tests/chunk.test.ts`. Not handled: PFR proves `de-prop` across §§4–7 whose titles don't say so ("In this section we conclude the proof of …"), so `de-prop` has no proof span; both PFR runs still outlined 9–10 claims, but that proof's own structure is only as good as the critique and prose edges make it.

---

### Sprint 3: Outline (Method A), extract, resolve [Complete]
**Goal:** The ETH run produces a node list with claims inside the long proofs and a dependency graph with mechanical and inferred edges; statement recall is 44/44. *Actual: 36/36 (the source has 36 statements; see Sprint 2).*
**Estimated effort:** 6 hours

#### Tasks
- 3.1 `stages/outline.ts` (Method A): prompt in `server/pipeline/prompts/outline.md` (instructions: you are given the full LaTeX and the deterministic skeleton; for every proof of ≥ 60 lines list the major claims in order with exact line spans and what each rests on; flag skeleton oddities; never invent a statement that is not in the text; JSON per schema). One call; every candidate model has a 1M context and the largest whopper is ~250k tokens. The per-section hierarchical variant is built only if Sprint 8 shows a single call degrading on the whoppers (8.7). Record `stats`.
- 3.2 `stages/extract.ts`: labeled statements → nodes directly from the Skeleton (id from label: `lem:sparsify` → `lem-sparsify`; `thm:main` → `thm-main`; collisions get `-2`). Claims → one `callObject` each with the span text and the parent statement: output `statement_paper` (verbatim-ish LaTeX of the claim) and `kind: 'claim'`. Cached prefix = whole source.
- 3.3 `stages/resolve.ts`: `deps_paper` from Skeleton refs (label → id). For each node whose proof text mentions a theorem-like word plus a number or a name without a `\ref` (regex: `(Lemma|Theorem|Proposition|Corollary|Claim|Definition)~?\s*[0-9A-Z.]+|by the (standard|usual) argument|as in Section`), one `callObject` with the proof text and the list of candidate nodes (id, display number, name hint) → `deps_inferred` with a one-line reason each; each inferred edge also pushes `{ kind: 'inferred_dep', severity: 'info', note }` to `friction`. Drop self-edges and edges that would create a cycle (log a warn event).
- 3.4 Metrics: `statements_in_source`, `statements_extracted`, `claims`, `refs_mechanical`, `refs_inferred`, `schema_retries` written to `runs.progress` as they happen and copied into `metrics` at finalize.
- 3.5 Tests: `tests/extract.test.ts` with a mocked `callObject` (vi.mock) over the toy fixture: ids, claim parenting, cycle rejection, inferred-edge friction.

#### Verification
- [x] ETH run (careful) reaches end of `resolve`: **36 statements + 53 claims = 89 nodes**; `refs_mechanical` = **34** (unique statement→statement edges from the 40 `\ref`s in proofs; see notes) + 18 claim edges from refs inside claim spans; **55 inferred edges** (50 from the outline's `restsOn`, 5 from prose), each logged with its reason; 0 rejected
- [x] Run page Health card shows recall **36/36**, claims, edges `\ref`/inferred (52 / 55), inferred-dep friction count
- [x] Retry from `extract` logs "reused stage_outputs.chunk, fetch, outline" and "outline · reused stage_outputs.outline (53 claims, pipeline)"; cost **$0.43** (extract $0.35 for 53 Sonnet calls, resolve $0.08 for 6), 33 s
- [x] Tests green (39; `tests/extract.test.ts` 9); lint/typecheck clean
- [x] Screenshot: `sprint3_run_health.webp` (run `0b7aec7d`, outline → resolve)

#### Deviations and notes (Oct 29)
- **ETH numbers (careful, run `0b7aec7d`, re-run from `outline` of the Sprint 2 `eth` paper):** outline = 1 Opus 5.5 call, `reasoning: 'high'`, 151,889 in / 9,927 out, **$0.81**, 115 s → **53 claims in 11 proofs** (the 9 long proofs + `lem:sparsify` via Appendix A + `thm:main` across its two proofs), 10 flags. Whole run $1.34, 2 m 31 s, 60 model calls, 0 schema retries. An earlier run with the first normalizer gave 50 claims / $0.79 (outline-to-outline variance is a few claims).
- **`refs_mechanical` = unique statement→statement edges (34)**, not ref occurrences (40): it is what lands in `deps_paper`. Claim edges from refs inside a claim's span are counted separately as `claim_refs` (18). Mechanical `\ref` cycles are kept (facts of the source) and logged as warnings; ETH has none.
- **Outline prompt** (`server/pipeline/prompts/outline.md`, imported as a string by Nitro's raw plugin; `server/types/raw.d.ts` declares `*.md`, `vitest.config.ts` has a matching raw plugin). The prompt is the whole source with **line-number prefixes** (`123| …`, ~310k chars ≈ 150k tokens, so line numbering costs ~65k tokens over the raw ~85k) + a one-line-per-statement skeleton digest (proof span, length, `outline: yes|no`, refs). It tells the model about statements proved by a whole appendix and statements with several proof environments; on ETH it outlined `lem:sparsify` from Appendix A and `thm:main` across both proofs, and flagged both.
- **Outline normalization** (`normalizeOutline`, in code, not the model): unknown parents/files dropped (warn event); reversed spans swapped and clamped; claim ids renamed to `claim-<parentId>-<n>`; `restsOn` mapped to labels / new claim ids, dropping unknowns, self and the parent; the 60-line rule drops claims inside a short recorded proof *unless* the same parent has claims elsewhere (second proof, appendix), in which case all are kept and spans outside the recorded proof get an informational `suspect_span` flag. Flags go to the run log.
- **Method B branch point:** `outlineStage` checks for a reused `stage_outputs.outline` first, then `if (ctx.method === 'agent')` (currently throws "not built yet (Sprint 4b)"); Sprint 4b replaces the throw with `outlineAgentStage(ctx)`.
- **Extract does not send the whole source as a cached prefix.** With Anthropic through the gateway, `caching: 'auto'` marks the last message, so per-claim prompts with a shared source prefix never hit the cache without an explicit breakpoint, and even with one, 53 × 85k cached reads would break the < $0.50 retry target. Each claim call gets the parent statement + a ±15-line line-numbered window of the proof around the span (≈2k tokens). First cut used the whole parent proof: $0.52 for 50 claims; ±30 lines + duplicated span: $0.46; current: $0.35 for 53. A failed claim call keeps the span text as `statement_paper` with a `structure_uncertain` friction (stage doesn't fail); ETH had 0.
- **Statement nodes:** every skeleton statement (including the unlabeled remark → `unlabeled-4-3-1`, no `paper_ref.label`) becomes a node with `name` = title or "Lemma 6.3" placeholder, empty `statement_plain`/`explanation`, `classification: 'unknown'` (annotate/classify fill them). Kind from env name, with `\newtheorem` aliases by prefix (`thm`, `lem`, …); conjecture → proposition, fact/observation → lemma. Claims' `paper_ref.section` is the section containing the span (so `lem:sparsify`'s claims sit in §A).
- **Resolve, inferred edges, two sources:** (1) the outline's `restsOn` for each claim not already covered by a ref in its span → `deps_inferred` + `inferred_dep` friction ("outline: … rests on …"); (2) prose: a statement whose proof, after masking `\ref{…}`, matches the plan's regex or "the previous lemma"-style phrases or "Appendix", or a proofless statement whose following text says it is proved elsewhere → one Sonnet call with the proof text, already-linked ids and the candidate statements (id, kind + number, label, section, first line). ETH: 6 calls; found `lem:sparsify → lem:spar-{branch,marked-degree,insertion-bound}` from "Appendix~\ref{app:sparsify} proves the lemma", and `prop:count → def:layout, lem:row-coefficients`. Claims get no prose calls (the outline's `restsOn` already covers prose deps). Edges are applied in skeleton order after all calls return so cycle rejection is deterministic.
- **Cycle rule:** an inferred edge `from → to` is rejected (warn event, `inferred_rejected`) if `to` already reaches `from` along `deps_paper ∪ deps_inferred ∪ containment`, where containment means a parent depends on its claims. So a claim can never depend on its own parent or on anything that uses the parent.
- **Progress keys** (all in `runs.progress`, for finalize to copy into `metrics`): `statements_in_source`, `statements_extracted`, `claims`, `claims_extracted`, `extract_failed`, `refs_mechanical`, `claim_refs`, `refs_inferred`, `inferred_outline`, `inferred_prose`, `inferred_rejected`, `resolve_calls`, `resolve_failed`, `outline_flags`, `outline_cost_usd`; `schema_retries`/`calls` from `callObject`.
- **Stage outputs:** `stage_outputs.outline` = `Outline`; `stage_outputs.extract` = `{ nodes: ProofNode[] }` (no deps); `stage_outputs.resolve` = `{ nodes }` with deps and friction — **critique/annotate read `resolve`**. Types `ExtractOutput` / `ResolveOutput` exported from the stage files. Fan-out (extract ×53, resolve ×6) runs inside the single stage step with concurrency 6 (`mapLimit` in `server/pipeline/nodes.ts`), not per-item `step.run`; it finishes in ~30 s, well inside one Vercel invocation. Sprint 9 may split it if needed.
- **Shared helpers:** `server/pipeline/nodes.ts` (pure): `slugifyLabel`, `statementIds`, `claimId`, `envKind`, `sourceLines`/`sliceLines`, `sectionAt`, `textAfter`, `mapLimit`.
- **Run page:** stepper shows `N claims · M nodes` and `34 \ref · 55 inferred edges`; Health card is now Recall, Claims, Refs/unresolved, Edges `\ref`/inferred, Inferred-dep friction, Schema retries. Pre-existing: "Open map" appears on any `complete` run although `papers.digest` stays null until Sprint 4's finalize.
- `tests/runner.test.ts`' end-to-end case now mocks `callObject` (empty outline) since outline/extract/resolve are real.
- **Sprint 8 fix (8.7): a paper's own `\begin{claim}` is kind `lemma`, not `claim`.** `envKind` mapped the `claim` environment to NodeKind `claim`, which everything downstream reads as "outlined claim inside a proof" (tree, graph filter, recall): ALWZ's two Claim environments made recall read 33/35 and dropped them from the graph. They now map to `lemma` (the node name still says "Claim 3.1"); finalize counts statements/claims by `parent_id`, and `goldenDiff` ignores nodes with a `parent_id` rather than kind `claim`.
- **For Sprint 4:** read nodes from `stage_outputs.resolve`. Claims have `parent_id`; the parent does not list its claims in `deps_paper` (containment is implicit, as in the toy fixture and Sprint 6's graph), so annotate's levels should treat parent → claim as a dependency (claims explained before their parent) to match resolve's cycle rule. 89 nodes on ETH → ~89 annotate + ~89 classify calls. The outline's `ref_to_nonstatement` flags (equations, external citations carrying key steps) are good critique input. `thm:main`'s second proof is still invisible to the chunker; its claims carry spans there.

---

### Sprint 4: Critique, annotate, classify, finalize — ETH end to end from the UI [Complete]
**Goal:** Clicking Start digest on the ETH form ends with a complete `PaperDigest` on the paper row, and a review item has been accepted or rejected from the run page along the way.
**Estimated effort:** 5 hours

#### Tasks
- 4.1 `stages/critique.ts`: one `callObject` with the assembled DAG (ids, kinds, names hints, spans, edges) and the source as cached prefix; prompt `prompts/critique.md` (check cycles, orphans, overlapping spans, uncovered proof text, wrong-direction edges, claims that restate a labeled lemma; propose fixes with confidence). Apply fixes ≥ 0.85; create `review_items` for the rest; if any, status → `waiting_review` and `waitForEvent('review/decided', { timeoutMs: 24h })`. On resume, apply accepted fixes, discard rejected, log both. `critique_findings`, `review_items` metrics.
- 4.2 `components/run/ReviewQueue.vue` + `server/api/runs/[id]/review.post.ts`: each item shows the proposed fix, the affected nodes (names + spans) and the model's note; Accept / Reject; when the last pending item is decided the route sets `runs.progress.review_done = true` (and, under Inngest, sends `review/decided`).
- 4.3 `stages/annotate.ts`: topological levels (Kahn over `deps_paper ∪ deps_inferred`); per level, `Promise.all` of one `callObject` per node with: the node's statement, its section title, the finished `name`/`statement_plain`/`explanation` of its deps, and the prompt `prompts/annotate.md` (semantic name ≤ 8 words, plain statement 1–2 sentences, explanation 1–3 sentences on why it is here; assume deps are already explained; no new claims). Progress counter `annotated / total`.
- 4.4 `stages/classify.ts`: per node, `callObject` → `classification` + `classification_cite` (what textbook result or prior paper, or why nothing prior covers it). `novel` requires a non-empty justification; otherwise downgrade to `routine` and log.
- 4.5 `stages/finalize.ts`: build `PaperDigest` (sections from Skeleton, `root_ids` = theorems with no `usedBy`, main theorem first by section order, macros), compute `RunMetrics` incl. `per_stage` and `wallclock_ms`, write `papers.digest`, `papers.latest_run_id`, `runs.status = complete`. Budget check at every step boundary → `failed` with `error: 'budget'`.
- 4.6 Library list reads real rows: `server/api/papers.get.ts` (join latest run); `app/pages/index.vue` replaces the placeholder with frame 01 (cards with status badges, running cards re-poll).
- 4.7 Tests: `tests/annotate.test.ts` (level computation on the toy DAG; a cycle fixture throws), `tests/finalize.test.ts` (root detection, metrics shape).

#### Verification
- [x] Full ETH run from the form completes on `careful`: paper `eth-e2e`, run `266200a5`, **$3.59, 231 model calls, 10 m 54 s wallclock** (includes ~1 min waiting on review; annotate alone was 6.7 min this time vs 1.7 min on the earlier run — gateway latency, same 86 calls). Log shows every stage. The review queue appeared on both real runs without the test flag (7 items on run `30fe0674`, 6 on `266200a5`), decided from the run page
- [x] `GET /api/papers/eth` returns a digest: **36 statements + 53 claims = 89 nodes** (the source has 36, not 44; see Sprint 2), every node has name/plain/explanation/classification, `root_ids = ['thm-main']`, **5 novel**, each with a citation. `eth-e2e`: 36 + 50 claims = 86 nodes, `root_ids = ['thm-main']`, 3 standard / 78 routine / 5 novel / 0 unknown
- [x] Spot-check five nodes against the paper (below)
- [x] Library shows both ETH cards as digested with counts (nodes, sections, novel, friction, wallclock · cost · calls)
- [x] Tests green (61; new `tests/annotate.test.ts` 12, `tests/finalize.test.ts` 10); lint/typecheck clean
- [x] Screenshots: `sprint4_review_queue.webp` (7 items), `sprint4_run_complete.webp`, `sprint4_library.webp`

#### Spot-check (eth-e2e digest vs `main_full_version.tex` / `quantitative-reduction.tex`)
1. **`lem-greedy-hashes`** "Greedy hash rows isolate the true count": plain statement matches the lemma (3n appended rows of list length P, ≤ 3n(2m)^P counts, ≤ 6n equations). Its only use of `lem:sparse-checks` is a `\ref` in the *statement body*, which the chunker doesn't count as an edge; critique added it automatically (0.90). Correct.
2. **`prop-interpolation-bound`**: `\ref` deps `lem-sparsify`, `thm-overview-sparse-polynomials` match the proof; `lem-greedy-hashes` (accepted in review) is right — the proof counts leaves "by the sparse-formula algorithm of Section~\ref{subsec:count-sparse}", whose correctness is "by the greedy lemma". The review also offered `→ lem-sparse-checks` (0.65), also true in the text but transitive; I rejected it.
3. **`claim-thm-main-2`** "Fixed-density CNF counting via tensor contraction": matches quantitative-reduction.tex:86–100 exactly (Theorem D.1 over Z/2^{n+1}, P0 = n+1, ℓ = 1, ×2^u for unused variables, the m ≤ Dn exponent). Deps `thm-tensor-contraction` + the previous claim: correct.
4. **`cor-max-sat-approximation`**: plain statement matches (OPT(F) − εm, probability 1 − 2^{−Ω(n)}, the ρ(n) exponent); dep `thm-main` correct.
5. **`lem-spar-branch`**: summary matches the appendix lemma (children partition the satisfying assignments, inserted widths < c); no deps, correct (it is a base lemma of Appendix A). Classified routine; arguably standard (an IPZ-style branching rule), a judgment call.
- **Overall:** names are semantic and accurate; statement_plain is faithful, with inline math. Two weaknesses: (a) `def-overview-measurement-structure` (§2.4, overview) is an orphan, so dagre draws it on the top rank next to the corollaries; the critique didn't connect it to `def-layout` (it is the overview's informal version); (b) classification is routine-heavy (78/86) because claims are almost all routine; 6 nodes came back novel and the paper-level cap call kept 5 (`thm-overview-sparse-polynomials` → routine, which is right: it restates the §5 count in the overview).

#### Deviations and notes (Oct 29)
- **Pure DAG helpers in `server/pipeline/dag.ts`**: `prerequisites` (deps ∪ parent→claim), `topoLevels(nodes, { onCycle: 'throw' | 'flatten' })` (Kahn in levels; `CycleError`), `hasCycle`, `usedByMap`, `rootIds`. annotate catches a `CycleError` (a `\ref` cycle is a fact of the source) and annotates the stuck nodes in one last level with a warn event rather than failing. ETH: 16 levels.
- **`root_ids`**: theorems nothing builds on, where uses by **corollaries, remarks, or claims inside a corollary/remark's proof** don't count (otherwise `thm-main`, used by `claim-cor-quantitative-circuits-4`, wasn't a root and the fallback put corollaries first — caught on the first ETH finalize and fixed). Main = label/id/name says "main", else the first in section order. No theorems → unused non-claim statements in document order. ETH: `['thm-main']` (the other two theorems are built on).
- **Critique** (`stages/critique.ts`, `prompts/critique.md`): one Opus call, `reasoning: 'high'`, line-numbered source (as outline) + one line per node (id, kind, number, label, statement/proof spans or claim span, `\ref` vs inferred edges) + "automatic checks" computed in code (orphans, overlapping claim spans, ≥ 15-line uncovered stretches of outlined proofs, the outline's flags). ~$0.84, 40–48 s on ETH. Fix target conventions are in the prompt: `add_edge/remove_edge [from, to]`, `merge [keep, ...others]` (same parent), `drop [claim]`, `reparent [claim, statement]`, `split [claim]`. `applyFix` (pure, exported) refuses: unknown ids, removing a `\ref` edge, dropping/merging statements, anything that would create a cycle. **`split` is never applied structurally** (it needs new statement text): accepting it adds `structure_uncertain` friction to the claim. Fixes < 0.85 that `applyFix` would refuse are logged as skipped instead of queued. A dropped claim's deps pass to its users and its parent.
- **Review wait lives in `ingestPaper`**, outside any step: critique returns the pending count; when > 0, `step.waitForEvent('review/decided', { match: { 'data.runId' }, timeoutMs: 24h })` then `step.run('critique:review', …)` applies accepted fixes, discards rejected/undecided (a timeout discards all, logged), sets status back to `running`. `stage_outputs.critique` = `{ nodes, result, applied[{fix,message,by}], skipped, pending, reviewed }`; annotate requires `reviewed`. A re-run that copies an unreviewed critique output re-creates the review items on the new run.
- **`waiting_review` and the dev sweep:** the boot sweep now fails `waiting_review` runs too (their in-process waiter dies with Nitro). Don't edit `server/` while a run is waiting.
- **Test flag:** `DIGEST_FORCE_REVIEW=1` (env) or `POST /api/runs/:id/retry { fromStage, forceReview: true }` (dev only; sets `progress.force_review`) adds one 0.5-confidence item (`remove_edge` on an inferred edge, else `split`) when the model asked nothing. Not needed on ETH: the model queued items on its own both times.
- **`POST /api/runs/:id/review`** `{ itemId, decision }`: 409 unless the run is `waiting_review` and the item is pending on that run; sets `progress.review_done` when none are left. **Contract additions (`shared/runs.ts`):** `ReviewItemPayload` = the fix + `nodes[{ id, name, kind, ref }]` (what the queue shows; `review_items.payload` is typed with it); `RunResponse.paper.hasDigest` ("Open map" now needs `complete && hasDigest`). Review items are listed in uuid order, not critique order (cosmetic).
- **Annotate** (`prompts/annotate.md`, Sonnet): per node, its LaTeX statement (≤ 4k chars), section, parent (claims), its claims and deps with finished name/plain/explanation, and its users (names + first 200 chars). Concurrency 6 within a level; `checkpoint()` between levels; a node failing twice keeps placeholder text + `structure_uncertain` friction (0 on ETH). Names are plain text; `statement_plain`/`explanation` may use inline `$…$` (rendered by `MathText` now; see Sprint 5 note). ~$0.72 for 86–89 calls.
- **Classify** (Opus, no reasoning): per node with paper title + main theorem's plain statement; classes defined in the instructions (novel = abstract-level new ideas, "most new lemmas are routine"). `enforceCites`: novel with a < 20-char cite → routine; any non-unknown without a cite → unknown. **Paper-level cap:** if > 5 novel, one extra call keeps ≤ 5 (`MAX_NOVEL`); the rest → routine with a note. ETH: 6 → 5 on the e2e run. ~$0.84 for 87 calls. Batches of 18 with a `checkpoint()` between.
- **`checkpoint(runId)`** exported from `runner.ts` (cancel + budget), used by the runner at boundaries and by annotate/classify mid-stage, so a 90-call step can't run far past the budget. Budget → `failed` / `error: 'budget'` as before.
- **Finalize**: digest from `stage_outputs.classify` + chunk (sections, macros) + outline flags → friction (`ref_to_nonstatement` → `unresolved_ref` warn; `possible_restatement`/`suspect_span`/`other` → `structure_uncertain` info; 8–10 rows on ETH). `RunMetrics`: counts from the nodes/skeleton themselves (a re-run's reused stages don't repeat their progress counters), tokens/cost/calls per stage from `model call` events, ms from `<stage>[:sub] finished` events, `wallclock_ms` = now − `started_at` (includes any review wait). A re-run's reused stages show ~0 ms / $0: metrics describe that run (the library card says "re-run · earlier stages reused" when a run made no calls). Finalize does **not** set `complete` itself; the runner flips it right after, so the run page catches the final events.
- **Cost on ETH (careful):** outline $0.79, extract $0.33, resolve $0.08, critique $0.83, annotate $0.71, classify $0.84 → **$3.59**. Retry from critique: $2.41, 4 m 19 s.
- **Run page:** stepper shows real counters for critique (`findings · applied · for review`), annotate/classify (`n/total`, novel), finalize (`digest · N nodes`), a hand icon while waiting for review; Health card gains Critique and Novel. Stub detection kept for pre-Sprint-4 runs ("stub (older run)").
- **Library:** cards for pre-Sprint-4 runs that "completed" through stubs now say `complete · no digest`; running cards show `annotate 40/89` / `classify n/total`; digested cards add the call count.
- **Dev DB:** `eth` now has digest run `89f32ea4` (finalize-only re-run of `30fe0674`, which was the critique re-run of Sprint 3's `0b7aec7d` lineage); `eth-e2e` is the fresh form run `266200a5`. `eth-uploaded`, `sensitivity`, `pfr*` still have no digest.

#### For Sprint 7 (chat) and Sprint 4b (agent)
- **Chat:** the digest is in `papers.digest`; `statement_plain` / `explanation` / `classification_cite` contain inline `$…$` LaTeX in the paper's macros (`digest.macros`; `MathText` adds `\mathds`, `\bm` and strips `\label`/`\nonumber`). Chat answers will quote these; render assistant text with math in mind. Node names are plain text. Section titles can contain LaTeX (`plainTitle()` in `app/utils/nodes.ts`). ETH digest ≈ 89 nodes × ~600 chars of prose ≈ 55k chars before ids/deps: fits instructions comfortably. Friction rows now exist for Sprint 7's table: `inferred_dep` (resolve + critique), `unresolved_ref` / `structure_uncertain` (outline flags, critique splits).
- **4b:** everything after `outline` is method-agnostic; critique's prompt uses `outline.claims[].span` for claim spans and `outline.flags` as leads, so the agent's Outline must carry real spans and flags. The review wait pattern (`waitForEvent` outside steps, flag in `runs.progress`) is the same one 4b's `structure/agent.finished` uses. Don't edit `server/` during a waiting or running dev run (the sweep fails it).

---

### Sprint 4b: Agent structure method (Method B) [Complete]
**Goal:** Selecting "Agent (sandbox)" on the form runs the structure step as a Claude Agent SDK agent in a Vercel Sandbox, streams its trace to the run page, and produces an Outline that the rest of the pipeline consumes unchanged.
**Estimated effort:** 6 hours
**Prerequisite:** the repo is linked to a Vercel project and `VERCEL_OIDC_TOKEN` is in `.env` (`vercel link`, `vercel env pull`), or `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` are set.

#### Tasks
- 4b.1 `npm i @vercel/sandbox`. `server/pipeline/sandbox/snapshot.ts`: `ensureSnapshot()` builds (once, cached in `.data/sandbox-snapshot.json` by id) a snapshot from `vercel/sandbox/node:24` with `npm i @anthropic-ai/claude-agent-sdk` done in `/vercel/sandbox/agent/`. Snapshot `keepLastSnapshots: { count: 1 }`.
- 4b.2 `server/pipeline/sandbox/agent.mjs` (copied into the VM) and `TASK.md` template: goal, the Outline JSON schema, the 60-line rule, "run `node validate_outline.mjs outline.json` and fix every error before finishing", write to `/vercel/sandbox/paper/outline.json`, POST progress to `$CALLBACK_URL` with `$CALLBACK_TOKEN` after each tool use (`{ message: '<tool> <summary>' }`) and `{ finished: true, outline }` at the end. `query()` options: model from profile, `maxTurns: 200`, `allowedTools: ['Read','Grep','Glob','Bash']`, `cwd: /vercel/sandbox/paper`, env with `ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh/claude-code`, `ANTHROPIC_AUTH_TOKEN` and empty `ANTHROPIC_API_KEY`.
- 4b.3 `server/pipeline/sandbox/validate_outline.mjs`: schema check, spans inside a proof of the named parent, `restsOn` labels exist, no cycles among claims; prints errors, exit 1 on any.
- 4b.4 `stages/outline-agent.ts`: create sandbox (`persistent: false`, `vcpus: 2`, `timeout: 45 min`, network allow-list `ai-gateway.vercel.sh` + `new URL(appUrl).host`, `env` with callback url/token/gateway vars), `writeFiles` (sources, `skeleton.json`, `TASK.md`, `agent.mjs`, `validate_outline.mjs`), `runCommand({ detached: true })`, then `waitForEvent('structure/agent.finished', { timeoutMs: 90 min })` while extending the sandbox timeout every 30 min; on finish/timeout read `outline.json`, validate, `stop()` in `finally`. Partial → `structure_partial` (the run continues on what exists, and the status shows it).
- 4b.5 `server/api/runs/[id]/events.post.ts`: bearer check against `runs.agent_token`; append events (`stage: 'outline'`, `data.turn`); on `finished` store the outline in `stage_outputs.outline`, set `runs.progress.agent_finished = true` (and send `structure/agent.finished` under Inngest).
- 4b.6 Form: enable the Agent option; run page: the Outline step meta shows `agent · turn N · <last tool>`; log lines render the trace.
- 4b.7 Progress transport: the sandbox is a cloud VM and cannot reach `localhost`, so **polling is the dev default**: the agent appends trace lines to `/vercel/sandbox/paper/trace.jsonl` and writes `outline.json` when done; the step polls both with `readFileToBuffer` every 10 s, appending new trace lines to `run_events`. The HTTP callback (`POST /api/runs/:id/events`) is used when `NUXT_PUBLIC_APP_URL` is a public host (prod, or a tunnel like `ngrok`/`cloudflared` in dev) and is purely a latency nicety; polling stays on as the safety net either way. README documents both.

#### Verification
- [x] Sensitivity (tier 1) with method `agent` (`sensitivity-agent`, standard → Sonnet 5.5 agent, run `c4401675`): sandbox booted from the snapshot in **1.2 s**; trace lines on the run page; the agent saw 0 proofs ≥ 60 lines, wrote `{"claims":[],"flags":[]}`, validator OK; 3 turns, $0.03; run complete end to end, **$0.15**
- [x] ETH with method `agent` on `careful` (`eth-agent`, Opus 5.5 agent, run `90e9b937`): **complete** (not partial). Agent: **17 turns, 16 API calls, $0.58, 1 m 53 s**, 50 claims in 11 proofs (9 long proofs + `lem:sparsify` via Appendix A + `thm:main` across both proofs), 9 flags; whole run **$3.35, 6 m 19 s** (incl. ~1 min on review), 246 calls. Turns, cost and wallclock are in `Outline.stats` and on the run page (stepper `agent · 17 turns · $0.58 · 50 claims`, Spend card "Agent")
- [x] Sandbox stopped after every run: `Sandbox.list()` shows all 7 sandboxes this sprint created `stopped`, none running. Stopped on collect, on cancel mid-agent (retry `62d61bca`: "sandbox … stopped (run ended)" within 2 s), and by `failRun` / the dev boot sweep (code path; unit-tested via `finishRun`/`ingestTrace`, not by a forced crash)
- [x] Both methods' ETH outputs under separate runs: Method A `eth-e2e` / `266200a5`, Method B `eth-agent` / `90e9b937` (latest pointer moved to a $0 finalize-only re-run `dd905aa6`); `GET /api/runs/:id` shows `structureMethod` and the `agent_*` progress keys; `stage_outputs.outline.method/stats` carry turns
- [x] Lint/typecheck clean; vitest 82/82 (new `tests/outline-agent.test.ts` 7: model-id mapping, callback gating, partial-outline parsing, trace de-dupe + cost delta, `structure_partial` finish, validator accept/reject; `inngest-runner.test.ts` +1: repeated waits get distinct step ids)
- [x] Screenshots: `sprint4b_agent_trace_midrun.webp` (turn 12, trace in the log, stepper meta), `sprint4b_agent_finished.webp` (17 turns · $0.58, complete)

#### Method A vs B on ETH (careful)

| | A — pipeline (`eth-e2e`, `266200a5`) | B — agent (`eth-agent`, `90e9b937`) | B again (`c2f7bb33`, outline only) |
|---|---|---|---|
| Claims (proofs) | 50 (11) | 50 (11) | 50 (11) |
| Outline flags | 10 (Sprint 3 run `0b7aec7d`) | 9 | 9 |
| Critique findings | 7 | 8 | — |
| Review items | 6 | 6 | — |
| Outline cost | $0.79 (1 call, 152k in) | $0.58 (16 calls) | $0.51 (13 calls) |
| Outline wallclock | 1 m 45 s | 1 m 53 s | 1 m 33 s |
| Turns | — | 17 | 14 |
| Whole run cost / wallclock | $3.59 / 10 m 54 s | $3.35 / 6 m 19 s | — |

On ETH the two methods land on the same shape (same 11 proofs, 50 claims each; both find the second `thm:main` proof and Appendix A for `lem:sparsify`), and the agent's outline is ~25% cheaper because it reads only the proofs it needs (cached) instead of the whole line-numbered source. Whole-run wallclock differences are mostly annotate latency and review time, not the method. One paper decides nothing; Sprint 8's corpus does.

#### Deviations and notes (Oct 29)
- **Installed:** `@vercel/sandbox` 3.9.1 (app). In the snapshot: `@anthropic-ai/claude-agent-sdk` **0.3.312** (Claude Code 2.1.312) + `zod@4`, pinned in `server/pipeline/sandbox/snapshot.ts`. Sandbox 3.x names sandboxes (`sandbox.name`, `Sandbox.get({ name })`) rather than ids; `progress.agent_sandbox` holds the name. Snapshot `snap_KdlrNQISY6rhbHfQY3KGpgFp1A1w` (node:24 image, no expiration), built in 13 s, cached in `.data/sandbox-snapshot.json`; `SANDBOX_SNAPSHOT_ID` overrides (Vercel's filesystem is read-only).
- **Gateway for the Agent SDK verified:** `https://ai-gateway.vercel.sh/claude-code` (and the bare host) answer Anthropic `/v1/messages`; bare ids (`claude-opus-5-5`) work and the SDK prices them (`costBasis: list`), so `PROFILES[profile].agent` is mapped `anthropic/claude-opus-5.5 → claude-opus-5-5` (`claudeCodeModel`). **The gateway key never enters the VM:** the network policy allows `ai-gateway.vercel.sh` with a header transform that sets `Authorization: Bearer <key>`; the VM gets a placeholder `ANTHROPIC_AUTH_TOKEN`. The app's host is added only when the callback is on.
- **Step split** (per Sprint 9): step `outline` boots + starts `agent.mjs` detached and returns `AGENT_PENDING` (−1); `ingestPaper` loops quiet steps `outline:poll-<i>` (drain `trace.jsonl`, add running cost, `extendTimeout` 30 min when < 12 min left, detect `agent.exit` / 90-min ceiling) and `waitForEvent('structure/agent.finished')` slices (10 s LocalRunner, 60 s Inngest); then `outline:collect`. **Contract addition:** `StepRunner.run(name, fn, opts?: { quiet })` skips the started/finished events (else 360 noise lines per hour). `InngestRunner.waitForEvent` now suffixes step ids per repeated call (`structure/agent.finished#1:…`); the first call keeps the old ids, so the review wait is unchanged.
- **Trace source:** the SDK message stream (tool_use blocks, validator results, `result`), not hooks. Usage through the gateway arrives in `message_delta`, not `message_start` (both are read; the first ETH run under-estimated running cost until this was fixed). Running estimate vs SDK total on ETH: $0.60 vs $0.51 (conservative). `done.json` carries the SDK's `total_cost_usd`, which replaces the estimate at collect. Spend from a cancelled agent is only the running estimate.
- **Trace ingestion is shared** by polling and the callback (`ingestTrace`): one locked `UPDATE … RETURNING prev` claims the seq and cost high-water marks, so a line delivered twice logs once and spend is added once. Events: `agent · turn N · <tool> <summary>` with `data.trace`; progress `agent_turn`, `agent_last_tool`, `agent_cost_usd`; at collect `agent_turns`, `agent_calls`, `agent_wallclock_ms`, plus one `model call claude-opus-5-5 (agent, N calls, T turns)` event (finalize now counts `data.calls`) and `outline:agent finished` (ms) for `per_stage.outline`.
- **`structure_partial`** is a progress flag during the run (status stays `running`, so critique's review pause and the run page's polling work), set by collect when the agent ended without `success`, ran past the ceiling, the sandbox died, or `outline.json` was unreadable; `finishRun` then ends the run `structure_partial` (terminal, `finishedAt` set). Partial outlines keep every claim/flag that parses on its own (`parseAgentOutline`) and get an `other` flag explaining why. Not exercised live (both ETH agents finished in < 20 turns).
- **Budget:** the agent gets `min(60% of budget, budget − spent − $2)` via the SDK's `maxBudgetUsd` and its own abort on the running estimate; `maxTurns: 200`; the runner's budget checkpoint sees agent spend at every poll step.
- **Callback** (`POST /api/runs/:id/events`): bearer = per-run `runs.agent_token`, set only when `NUXT_PUBLIC_APP_URL` is public `https`; body `{ message, data }` (a trace entry) or `{ finished: true, outline?, data }`. `finished` → `signalRun`; the route does **not** store the outline: `outline:collect` reads `outline.json` from the VM, so the file stays the one source of truth. Verified only the 401 path live (dev has no public URL); the ingestion it calls is unit-tested.
- **Files:** sandbox scripts are imported as strings with Nitro's `raw:` specifier (`server/types/raw.d.ts`; vitest maps `raw:` → `?raw`). Nitro dev does **not** watch `raw:` imports: after editing `agent.mjs` / `validate_outline.mjs`, touch `stages/outline-agent.ts`. `TASK.md` is the template (`{{FILES}}`, `{{LONG_PROOFS}}`, …) adapted from `prompts/outline.md`; the VM gets `paper/{src/*, skeleton.json, skeleton.md, TASK.md, validate_outline.mjs}` and `agent/agent.mjs`; the command is `bash -c 'node agent.mjs > agent.log 2>&1; echo $? > agent.exit'`. Tools: Read, Grep, Glob, Bash, Write, Edit (Write so it can write `outline.json`), `bypassPermissions`, `settingSources: []`.
- **Agent behavior on ETH:** reads `skeleton.md`, then each long proof with `sed`/`cat -n` in 100–250-line chunks, writes the JSON from a small generator script, validates once (OK first time on run 1; run 2 validated a 38-claim draft first). Its flags match Method A's leads (two `thm:main` proofs, Appendix A, external citations in `cor:quantitative-circuits`, `def:overview-measurement-structure` unused).
- **Failure paths stop the sandbox:** `collect`'s `finally`, `failRun` (cancel/budget/error under both runners), the dev boot sweep, and a retried `outline` step (stops a previous sandbox before booting). The VM's own timeout is the backstop.
- **UI:** form's Agent tab enabled with its own help text; stepper meta `agent · turn N · <last tool>` live, `agent · T turns · $X · N claims (partial)` after; trace lines in the log with a terminal icon; Spend card gains "Agent"; a warning alert for `structure_partial`; "Open map" also for `structure_partial` runs with a digest.
- Dev DB gains `sensitivity-agent` and `eth-agent` (runs `90e9b937` complete, `62d61bca` and `c2f7bb33` cancelled re-runs from outline, `dd905aa6` finalize-only re-run that is now latest). README documents both transports.

---

### Sprint 5: App shell — library polish, tree, node page, deep links [Complete]
**Goal:** `/eth/thm-main` renders the dashboard with the tree, the node page with KaTeX, working breadcrumbs, share link, and the chat panel placeholder; narrow screens collapse the sidebar.
**Estimated effort:** 6 hours

#### Tasks
- 5.1 `app/layouts/dashboard.vue` (`UDashboardGroup`), `pages/[paper]/index.vue` (redirect to root), `pages/[paper]/[node].vue` (frame 02): `UDashboardSidebar` (resizable, collapsible; `USelectMenu` paper switcher from `GET /api/papers`, `UDashboardSearchButton` wired to a `UDashboardSearch` over nodes by name/label/id, `+`/`−` expand-all, `PaperTree`), `UDashboardPanel` (`UDashboardNavbar` with `UBreadcrumb` paper → section → node, `UTabs` Node/Graph bound to `?view`, Share button copying the URL via `useClipboard` + `useToast`, Chat toggle), second `UDashboardPanel` for chat (resizable, hidden until Sprint 7 fills it; shows an `UEmpty` placeholder).
- 5.2 `composables/useDigest.ts`: `useFetch('/api/papers/<slug>')` once per paper (keyed), builds `byId`, `usedBy`, `children` (claims by parent), `sectionOf`. `useSelection.ts`: `selectedId` ↔ route param; `select(id)` navigates with `replace` and keeps `?view`.
- 5.3 `components/tree/PaperTree.vue`: `UTree` items = sections (level 1, with level-2 subsections folded into their parent unless they hold statements) → statements → claims; default expanded: the section of the selected node and the first section; item slot: kind icon (`i-lucide-star` theorem/corollary, `i-lucide-circle` lemma/proposition, `i-lucide-type` definition, `i-lucide-plus` claim), name, friction dot (max severity), `novel` badge. Selecting navigates. Expands to reveal the selected node on route change.
- 5.4 `components/node/NodePage.vue` (+ `compact` prop) per frame 02's center: badges (kind, classification, friction kinds), name, sub-line (display number · label · section, page), Statement (paper) in `MathText`, In plain English, Why it's here (+ classification cite), Uses / Used by chip lists (`NodeChip.vue`), Inside the proof (claims), Sources (Paper card with section/page/label and an "Open" button linking to the GitHub/arXiv source at the file + line when the source kind supports it; Lean card showing "not aligned · Phase 2"), Friction list.
- 5.5 `components/node/MathText.vue`: splits on `$…$`, `\(…\)`, `$$…$$`, `\[…\]`, `\begin{equation}`, renders with `katex.renderToString({ throwOnError: false, macros: digest.macros })`; `katex/dist/katex.min.css` imported in `app/assets/css/main.css`. Unknown macros render as red text rather than throwing.
- 5.6 Library (frame 01) polish: `UPageHeader` + `UPageGrid`/`UPageCard`; tier badge; New paper + Corpus buttons.
- 5.7 Narrow screens: under `lg` the sidebar is a slideover (dashboard default); the chat panel is hidden by default under `xl`.

#### Verification
- [x] `/eth` redirects to `/eth/thm-main`; the tree shows §1 expanded with the main theorem selected; the node page renders the statement with KaTeX, **no red macro text on ETH** (checked in the browser and by rendering every math span of both ETH digests through KaTeX with `throwOnError`: 0 errors after the fixes below); `/toy` → `/toy/thm-main` (302) verified. Screenshot `sprint5_eth_node.webp` (`/eth/lem-sparsify`)
- [x] Clicking a chip changes the route and the tree selection; browser back works (toy)
- [x] Opening `/eth/lem-sparsify` cold renders with the tree expanded §6 → §6.4 → Sparsification (selected, its six claims listed); Share is the same code path verified on the toy; toy equivalent verified (Share toasts `http://localhost:3120/toy/lem-hash`; cold `/toy/lem-univariate` opens with §2 expanded and the node selected)
- [x] `⌘K` search for `lem:sparsify` lists "Sparsification into bounded-occurrence k-CNF leaves" first, then its claims; toy: `lem:hash` → Hashing monomials apart (top hit), Enter navigates
- [x] Against the toy fixture (`/toy/...`) everything above also works (proves no ETH-specific assumptions)
- [x] Playwright at 390px: sidebar collapsed to a toggle (slideover, auto-closes on navigation); node page readable, no horizontal scroll; chat opens as a right slideover
- [x] Lint/typecheck clean for Sprint 5 files (remaining typecheck error is Sprint 2's `server/pipeline/sources/arxiv.ts`; the failing `runner.test.ts` stub-pipeline test follows Sprint 2's real fetch stage). Screenshots: `verification/screenshots/sprint5_{library,default,deeplink,mobile,mobile_tree,dark}.webp`

#### Deviations and notes (Oct 29)
- **Built against the toy fixture only**; the four ETH-specific checks above re-run once Sprint 4 lands the ETH digest.
- **Layouts:** `app/app.vue` is now `UApp > NuxtLayout > NuxtPage`; the old header/footer moved to `app/layouts/default.vue` (library, `/papers/**`, corpus keep it). `layouts/dashboard.vue` = `UDashboardGroup unit="rem" storage-key="digest-dashboard"` (cookie storage, SSR-safe).
- **`pages/[paper]/[node].vue`** uses `definePageMeta({ layout: 'dashboard', key: route => route.params.paper })` so node-to-node navigation keeps the sidebar, tree state and panel sizes mounted. Single root `<div class="contents">` wrapping the sidebar + panels (lint wants one root; `display: contents` keeps them flex children of the group). A paper with no digest redirects to `/papers/<slug>/run`; an unknown node id toasts and replaces to `root_ids[0]`; an unknown paper is a 404.
- **`select(id)` pushes** (not `replace`) so browser back walks the selection, per the verification line; `select(id, { replace: true })` exists for programmatic moves. View toggles (`setQuery`) replace. Selection carries the whole query (`view`, `mode`, `claims`).
- **New shared file `shared/api.ts`**: `PaperResponse` (`GET /api/papers/:slug`, same shape as the toy route) and `PaperListItem` (`GET /api/papers`: paper fields, `counts {nodes, sections, novel, friction}` when digested, `run {id, status, stage, profile, structureMethod, costUsd, startedAt, finishedAt, error, progress (numeric counters), metrics {cost_usd, wallclock_ms, calls}}` = latest run by `started_at`, `fixture?: true`). `GET /api/papers` appends the toy fixture (tier `fixture`) in dev when no `toy` row exists. Sprint 4 can refine (e.g. progress text like "annotate 4/9" on running cards; the card currently shows `running · <stage>`).
- **Library cards** link to `/<slug>` when digested, else `/papers/<slug>/run`; the page re-polls `/api/papers` every 3 s while any card is queued/running/waiting_review. "Lean: not aligned" badge on every card until Phase 2.
- **Display numbers** ("Lemma 2.2") aren't in the contract (`PaperRef` has no number), so the node sub-line shows `Kind · label · §section, p.` If Sprint 2's chunker produces display numbers, add `display?: string` to `PaperRef` and render it there and in the tree tooltip.
- **Section labels** (`sectionLabel` in `app/utils/nodes.ts`) print `§<id> <title>` when the id is numeric/appendix-letter-like, else the title alone, so chunker ids that aren't numbers still read well. Sections with nothing in them are hidden from the tree; level-3 sections fold into their shown ancestor.
- **Tree behaviour:** clicking an unselected statement selects it and the watcher expands its claims; a second click toggles. Sections only toggle. The selected row scrolls into view on route change.
- **Chat panel**: `null` preference = CSS-only (`hidden xl:flex`), so SSR and hydration agree; the toggle makes it explicit; under `xl` an explicit open shows a `USlideover`. Graph view is a `UEmpty` placeholder bound to `?view=graph`.
- **`MathText`** also does light prose cleanup between math spans (`\emph`, `\textbf`, `\texttt`, `\ref`-family → code, `\cite` → [key], `~`, escaped specials); `align`/`gather`/`multline` are wrapped in KaTeX's `aligned`/`gathered`. `strict: false` to keep the console quiet. Long display math scrolls in its own block (`[data-math-text] .katex-display` in `main.css`).
- **`useClipboard`/`useBreakpoints`** are imported from `@vueuse/core` explicitly (hoisted via Nuxt UI; not auto-imported in this project).

- **ETH fixes (Sprint 4):** KaTeX red text on ETH came from `\label{…}` inside display math (7 statements) and `\mathds` (1); `MathText` now strips `\label`/`\nonumber`/`\notag` and adds base macros `\mathds → \mathbb`, `\bm → \boldsymbol` (digest macros win). `NodePage` renders `statement_plain`, `explanation` and the classification cite through `MathText` (annotate writes inline `$…$`). Section titles with LaTeX (`Reducing $\#k$-SAT …`) go through `plainTitle()` in `sectionLabel`.

- **Cross-references (Oct 29 fix):** `\ref`/`\eqref`/`\cref`/`\Cref`/`\autoref`/`\nameref` no longer render as the raw label in monospace. `MathText` (and chat via a Comark `paper-ref` rule) renders `NodeRefLink`: equations → a link-styled "(1.1)" whose `UPopover` shows the equation in KaTeX with "(n) · §section · file:line · Open in source"; statements → "Lemma 6.3" (just "6.3" after "Lemma~") selecting the node; sections → "§3.2" selecting the section's first statement; unknown → muted humanized label. Refs inside math become `\text{(1.1)}`; `\cite` renders muted `[key]`. Resolution is `app/utils/refs.ts`; data is the additive `PaperDigest.equations` / `labels`, extracted by `server/pipeline/latex/equations.ts` at finalize from the stored sources (numbering: amsmath rows, `\tag`, `\nonumber`, starred, `subequations`, `\numberwithin`, theorems sharing the equation counter). Existing digests backfilled with finalize-only retries ($0). Test: `tests/equations.test.ts`. Screenshot `verification/screenshots/fix_eqref_popover.webp`.

#### For Sprints 6 and 7
- Components auto-register with path prefixes: `<TreePaperTree>`, `<NodePage :node compact?>`, `<NodeChip :id inferred?>`, `<NodeMathText :text macros?>`. A future `components/graph/ProofGraph.vue` is `<GraphProofGraph>`, `components/chat/ChatPanel.vue` is `<ChatPanel>`.
- Digest access: the page calls `useDigest(slug)` + `provideDigest(...)`; any descendant calls `useDigestContext()` → `{ paper, digest, index }` with `index = { byId, usedBy, children, sectionById, sectionOf }`. `useSelection()` → `{ paperSlug, selectedId, select(id, {replace?}), linkTo(id), setQuery(key, value|undefined) }`. Kind icons / short names / class + severity colors / `maxSeverity` / `sectionLabel` live in `app/utils/nodes.ts` (auto-imported).
- **Graph slot (Sprint 6):** `pages/[paper]/[node].vue`, `#body` of the `id="node"` panel, the `v-if="view === 'graph'"` block (marked with a comment). `view` is a computed over `route.query.view`; add `mode`/`claims`/`colorBy` the same way via `setQuery`. For the compact right card, render `<NodePage :node="node" compact />`; collapse the sidebar with `v-model:collapsed` on `UDashboardSidebar` (it is already `collapsible`).
- **Chat slot (Sprint 7):** two placeholders in the same page, both marked with comments: the `id="chat"` `UDashboardPanel` `#body` (xl+) and the `USlideover` `#body` (below xl). Put `<ChatPanel>` in both (or extract one component). Open/close state is `chatPref` / `toggleChat()`; "Ask about this node" (7.3) should set `chatPref = true` and prefill.

---

### Sprint 6: Graph view [Complete]
**Goal:** `?view=graph` shows the layered dependency DAG per frame 02b with focus mode, claims toggle, color modes and fit, sharing selection with the tree and the node page.
**Estimated effort:** 6 hours

#### Tasks
- 6.1 `components/graph/ProofGraph.vue` (custom, justified: no Nuxt UI graph primitive). Props: `nodes: ProofNode[]`, `selectedId`, `mode: 'all' | 'focus'`, `showClaims`, `colorBy: 'cls' | 'sec'`. Builds a dagre graph (`rankdir: 'TB'`, `ranksep 60`, `nodesep 18`, node 160×44) over paper statements (claims included when `showClaims`; `remark`s excluded), edges = `deps_paper ∪ deps_inferred` (inferred dashed). Focus = transitive `uses` ∪ transitive `usedBy` of the selection; in `focus` mode only those nodes are laid out. Renders inline SVG: edges as cubic paths with arrowheads, nodes as `foreignObject` cards (display number, truncated name, `UBadge` for novel, friction dot). Click → `emit('select', id)`. Hover → `UTooltip`-like title. Pan via a wrapping `overflow:auto` div that scrolls to center the selection on change; Fit toggles a `viewBox` scale to the container width. Dark mode via CSS variables only.
- 6.2 `pages/[paper]/[node].vue`: when `view=graph`, center panel = `ProofGraph`, sidebar collapses to its icon rail (`UDashboardSidebar` `collapsed`), right panel shows `NodePage compact` (chat still toggleable, replaces the node card). Navbar gains `UTabs` Whole paper / Focus (`?mode`), `UCheckbox` claims (`?claims=1`), `UTabs` by class / by section, Fit button. Legend strip under the graph with counts (`n nodes · k levels · focus: a below, b above`).
- 6.3 Performance guard: over 400 nodes, default to `focus` mode and show a `UAlert` offering Whole paper.
- 6.4 Tests: `tests/graph-layout.test.ts`: focus closure on the toy DAG; inferred edges flagged. (dagre itself is not under test.)

#### Verification
- [x] `/eth/thm-main?view=graph` renders the whole-paper DAG (35 statements, 6 levels) with the corollaries on top, the main theorem under them and its lemmas below; focus on `thm-main` reads "13 below, 5 above". One oddity: the orphan `def-overview-measurement-structure` sits on the top rank (no edges, see Sprint 4 spot-check). Screenshot `sprint6_eth_graph.webp`; toy: `thm-main` on top, `def-sparse` / `lem-schwartz-zippel` at the bottom
- [x] Selection lights ancestors/descendants and dims the rest on ETH (`thm-main` selected; the right card shows its statement with KaTeX). The storyboard's "Parameter choice balancing the three costs" isn't a node name in the real digest; toy equivalent verified on the mid-level `lem-hash` (lights `thm-main` above, `def-sparse` below; card and URL `/toy/lem-hash?view=graph` update)
- [x] Focus mode relays out with only the lit nodes; Whole paper restores (toy)
- [x] Claims toggle adds the in-proof claims under their parent; color by section recolors (toy)
- [x] Switching to Node view keeps the selection; the tree highlights it and the sidebar re-expands
- [x] Dark mode readable; 390px shows the graph scrollable (centered on the selection, no page overflow) with the controls wrapped; Fit scales to width
- [x] Lint/typecheck/tests clean for Sprint 6 files (10 new tests in `tests/graph-layout.test.ts`; the one failing test is Sprint 2's `runner.test.ts`). Screenshots: `verification/screenshots/sprint6_{whole_paper,focus_lemma,focus_mode_claims,by_section,dark,mobile,mobile_fit}.webp`
- [ ] >400-node guard not exercised in the browser (no paper that big yet); logic is a computed in `[node].vue`

#### Deviations and notes (Oct 29)
- **Pure logic in `app/utils/graph.ts`** (auto-imported; tests import it directly): `graphNodes`, `graphEdges`, `focusClosure`, `buildGraph`, `edgeLit`, `basisPath`, types `GraphMode` / `GraphColorBy`. dagre stays in the component.
- **Claims** get a `contains` edge parent → claim (dotted) so dagre puts them under their parent; it also counts for focus (a claim's "up" includes its parent). A claim selected while claims are hidden focuses on its parent. Claim cards read `claim · <parent label>` and have an inner dashed ring.
- **Lit edges** = edges inside one cone (both ends in anchor ∪ below, or both in anchor ∪ above), so an edge from an ancestor to a descendant that bypasses the selection stays dim. Mechanical ∩ inferred counts as mechanical.
- **Cards** show the LaTeX label (no display numbers in the contract, same as Sprint 5), a `novel` `UBadge`, and a friction dot coloured by max severity. Hover uses the native `title` attribute. Cards are `<button>`s, so they're keyboard-focusable.
- **Colors:** all through Nuxt UI variables (`--ui-primary`, `--ui-border-accented`, `--ui-text-dimmed`, `--ui-chart-*`), so dark mode needs nothing extra. By class: novel = primary fill, routine = solid, standard = dashed, unknown = dotted warning. By section: top-level section → chart color in the order 4, 6, 5, 2, 3, 1 (amber, cyan, rose, …; primary last so it doesn't clash with the focus highlight).
- **Controls live in a `UDashboardToolbar`** under the navbar (only in graph view) rather than in the navbar itself, so they can wrap at 390px. Color mode is in the URL as `?color=sec` (the plan only named `mode` and `claims`). Fit is local state (not in the URL) and only scales down (`min(1, width ratio)`), so on the small toy graph it is a no-op at desktop widths.
- **Legend strip** lives inside `ProofGraph` (bottom of the component), switching between class and section swatches, plus the `n nodes · k levels · focus: a below, b above` stats; levels = distinct dagre ranks.
- **>400 guard:** counted over statements (claims/remarks excluded). Over the guard, no `?mode` means focus; the `UAlert` button writes `?mode=all`. Under the guard, Whole paper is the default and `?mode` is dropped.
- **Sidebar rail:** `v-model:collapsed` + `collapsed-size 4`; an expand button sits at the top of the rail. The sidebar persists `collapsed` in its cookie, so the ref starts `false` (to sync with the cookie) and `onMounted` applies `view === 'graph'`; a cold graph deep link therefore renders the tree expanded on the server and collapses on hydration (brief flash).
- **Right panel:** new `UDashboardPanel id="graph-node"` (lg+, resizable) with `NodePage compact` and an "Open full page" button (switches `view` to tree). Below lg a one-line strip under the graph names the selection with an Open button.
- **Chat in graph view** is closed unless explicitly toggled (the xl auto-open from Sprint 5 applies only to Node view); when open at xl it replaces the node card; between lg and xl it's the slideover and the card stays.
- **Layout revision (Oct 29, owner feedback: full names, results on top).** The old layout already drew users above what they use, but dagre's network-simplex ranker floated leaves up next to their users and pinned orphans and unused results on the top rank (ETH's top row mixed corollaries with `def:overview-measurement-structure` and leaf `lem:tensor-packets`; the bottom rank held one lemma), so it read upside down. Layers now come from `graphRanks` in `app/utils/graph.ts` (dagre `ranker: 'none'`, preset ranks doubled because dagre doubles `minlen` for edge labels): layer = longest path down to a leaf, so the most-supported results sit on top; claims are then pulled up to one layer under their parent, and leaves (definitions, leaf lemmas) are tucked up to one layer under their lowest user (owner's call, to narrow the drawing; strict "all leaves on the bottom row" was tried first and gave a 15-card bottom row). Orphans with no edges at all (`def:overview-measurement-structure`, `lem:tensor-packets`) stay on the bottom row, out of the way of the connected structure; cycle-closing edges are cut and drawn straight. Arrows point down from a result to what it uses (legend gains a "uses" arrow; tooltips say so), and edges leave the card's bottom center and enter the top center with vertical stubs so they don't run sideways through a row. Corollaries still sit above `thm:main`, since they use it. Cards: fixed width 232, full name wrapped (no truncation), height estimated from a conservative word wrap (`cardHeight`: 47 / 61 / 76 px for 1 / 2 / 3 lines; ETH names are all ≤ 2 lines, no overflow measured) and fed to dagre; `ranksep 44`, `nodesep 20`, `edgesep 8`. Width: ETH whole paper is 3966 px (6 levels, widest row 12 cards; strict bottom-row leaves gave 4327 px), 8444 px with claims (16 levels, widest row 10; 7719 px under the strict rule: with claims the width is mostly long-edge routing, which tucking slightly worsens). Most ETH leaves' lowest user is already on the second-to-last layer, so tucking gains less than hoped. Fit on the whole paper is an overview, not readable; Focus is the readable view. Tests: 5 new (`graphRanks` incl. leaf tuck and orphan, card sizing). Screenshots `sprint6_*` retaken.
- **Following the chain of reasoning (Oct 29, owner: "optimize the graph for someone who's just trying to follow the chain of reasoning"; supersedes parts of the layout revision above).**
  - **Card text = what it proves + its role** (owner's option B). New optional `ProofNode.headline` (≤ ~80 chars, an assertion: verb-first, "So …" for corollaries, "Defines …" for definitions, inline `$…$` allowed, rendered with KaTeX via `app/utils/headline.ts` → `renderTex`) and `ProofNode.role` (≤ ~60 chars, muted second line: what it contributes to the results that use it). Card = label line (unchanged, plus novel badge and friction dot) / headline / role; no headline → the semantic `name`, no role line. `name` stays everywhere else; `NodePage` shows headline + role small under the title (full page and the compact graph card). Written by **one graph-labels pass at the end of annotate** (`server/pipeline/graphLabels.ts`, `prompts/graph-labels.md`, `graphLabelsSchema`): every node's id/kind/label/name/statement_plain/explanation/uses/used-by in one prompt (the role needs the users), batches of 100 nodes for larger papers with the whole paper as a cached prefix; a failure logs a warn and cards fall back to names. **Backfill:** `POST /api/papers/:slug/labels` + "Regenerate graph labels" on the run page, same pass on the digest run's profile annotate model (Sonnet on careful/standard), cost recorded on that run via `callObject`; patches `papers.digest`. All 19 digested papers backfilled: $2.12 for the final pass (ETH $0.21 for 89 nodes; 164-node `logspace` takes 2 calls), plus ~$0.40 of trial and superseded runs (two prompt trials, one ETH pass before the math rule); the gateway threw intermittent "Gateway request failed" errors during the first attempt, so the backfill script retried each paper up to 3 times (the route itself does not retry beyond callObject’s schema retry). Prompt tightened after reviewing ETH: algorithmic results say what they compute and at what cost, no placeholder math like `$2^{o(\cdot)}$`, any `^`/`_`/command must sit inside `$…$` (a run without that rule wrote bare `2^{O(…)}`). Accuracy on an ETH sample was good; one systematic softening: `thm:main` comes out as "$2^{o(n)}$" (true, weaker than the stated bound). Toy fixture carries hand-written labels.
  - **Cards** are 272 px wide, height from a word-wrap estimate of headline (12 px, 15 px lines) + role (11 px, 14 px lines) with math measured as rendered (`visibleText`: `\log` keeps its name, `\tilde`/`\mathrm` vanish, other commands = one glyph), fed to dagre: ETH 84 / 98–99 / 113 px; no overflow measured on ETH. `ranksep 48`. ETH whole paper is now 4586 × 907 px (9724 × 2430 with claims).
  - **Edges read "feeds into"** (owner decision): the arrowhead moved to the top end of each path, so arrows point from a supporting node up to the result it helps prove (lemma → theorem → corollary). Layout and the data model's `GraphEdge { from: user, to: dep }` are unchanged; legend says "feeds into". Edge `<title>` tooltips are gone (the edge layer ignores the pointer); hovering a card highlights its direct edges instead, and lifts dimmed neighbours to 0.8 opacity.
  - **Zoomable viewport** replaces the overflow-scroll pan and the Fit toggle (removed from the toolbar and the `fit` prop). The drawing is one "world" div (SVG edge layer + absolutely positioned HTML cards; `foreignObject` dropped, it misbehaves under transforms in Safari) transformed by **d3-zoom** (`d3-zoom`, `d3-selection`, `d3-transition`; chosen over hand-rolling for wheel-around-cursor, trackpad pinch (ctrl+wheel), touch pinch, click-vs-drag suppression via `clickDistance(4)`, and van Wijk animated transitions; @panzoom/panzoom lacks the animated zoom-to-rect). Drag anywhere (cards included) pans; a click without movement selects; double-click on a card doesn't zoom. `constrainView` keeps ≥ 80 px of the drawing on screen; zoom range [min(0.2, 0.8 × fit), 2.5]. Controls (bottom left): +, −, zoom % (click = 100% on the selection), whole graph, fit the selection's chain (selection ∪ everything above and below it), minimap toggle, shortcuts tooltip. **Keyboard** on the focused graph: `+`/`=` `−`/`_` zoom, `0` whole graph, `1` 100% on the selection, `F` fit the chain, `C` center, `↑` a result it feeds into, `↓` something that feeds into it, `← →` neighbour in the same row (`stepTarget` in `graph.ts`, nearest horizontally). **Selection changes glide** (450 ms) to the new card, keeping the zoom unless it's below 60% (then 90%); reduced motion → instant. **Minimap** (now in scope, overriding the deferral): bottom right at sm+, only when the graph overflows the viewport; node rects (selection primary, its chain muted), a viewport frame; click or drag to move. **Level of detail:** below 60% the role line hides; below 32% a card shows only its label at 30 px (readable-ish on the ETH overview at 21%); edge strokes thicken as you zoom out. **First view:** the saved view; else the whole graph if it reads at ≥ 70% (toy); else the selection's chain if it reads at ≥ 60%; else the selection at 100%. **Zoom/pan persists** per paper + mode + claims in a module-level map (`savedGraphViews`, `app/utils/viewport.ts`), not the URL. Pure viewport math in `app/utils/viewport.ts` (`fitView`, `centerView`, `visibleWorld`, `boundsOf`, `constrainView`, `lodFor`, `focusZoom`).
  - Verified (Playwright, ETH + toy): wheel zoom around the cursor, drag pan on background and on a card (no selection), click selects and glides, `0`/`1`/`F`/`+`, arrow keys (↑ from `lem:sparsify` → `thm:main`, ↓ → `lem:tensor-sparse-query`), minimap, focus mode with claims, by section, dark, 390 px (no page overflow; minimap hidden, controls kept). Tests: `tests/viewport.test.ts` (5), `tests/graph-labels.test.ts` (3), `graph-layout` card sizing rewritten + `stepTarget` (2). Screenshots `sprint6_*` retaken, plus `sprint6_zoomed.webp` (250%, hover) and `sprint6_headlines.webp`.

#### For Sprint 7 (`[node].vue`)
- `chatOpen` is now view-aware: `view === 'graph' ? chatPref === true : (chatPref ?? (mounted && isXl))`. The `id="chat"` panel's `v-if` is `view === 'graph' ? chatPref === true : chatPref !== false`. "Ask about this node" setting `chatPref = true` works in both views.
- Two new panels/rows to keep in mind: the `UDashboardToolbar` (graph only, in the node panel's `#header`) and the `id="graph-node"` panel between the node panel and the chat panel. The node panel's body `ui` switches to zero padding in graph view.
- Chips that `select(id)` keep the whole query, so a chat chip clicked in graph view moves the graph focus.

---

### Sprint 7: Chat + friction table [Complete]
**Goal:** The chat panel answers "Where does the √log n come from?" with node chips that drive the center panel; the friction page lists the paper-internal friction.
**Estimated effort:** 5 hours

#### Tasks
- 7.1 `server/api/papers/[slug]/chat.post.ts`: `streamText({ model: MODELS.chat, instructions, messages: convertToModelMessages(messages), stopWhen: isStepCount(1), providerOptions: { gateway: { caching: 'auto' } } })` (ai@7 names; `stepCountIs` is the deprecated alias). Instructions: the paper's digest serialized compactly (id, kind, name, display number, section, statement_plain, explanation, classification, deps) plus rules: answer only from the digest, cite nodes as `[[node-id]]`, never assert something not in the digest, say so when the digest doesn't cover a question, keep answers under 200 words. `pruneMessages` + a 40k-char history ceiling on user-message boundaries. `toUIMessageStream({ onError })` mapping provider errors to "The chat is unavailable right now." No persistence. `event.node.res.on('close')` aborts.
- 7.2 `components/chat/ChatPanel.vue`: `useChat({ transport: new DefaultChatTransport({ api }) })`, `UChatMessages` (`:status`, `should-auto-scroll`, `#indicator` `UChatShimmer`), `UChatPrompt` (`v-model`, `:error`; it has no `status` prop in 4.12, whatever `nuxt_ui_chat.md`'s snippet shows) with `UChatPromptSubmit :status` in its footer; empty state with three suggested questions (`UButton`s that `sendMessage`). `MessageContent.vue`: Comark for assistant text with a custom inline rule turning `[[id]]` into `NodeLink.vue` (chip with the node name; click → `select(id)`), plain `<p>` for user. `[[id]]` for unknown ids renders the raw id in a muted chip.
- 7.3 Node page: a "Ask about this node" button that opens the chat panel and prefills "Explain [[<id>]] and what it's used for."
- 7.4 Friction (small): `pages/[paper]/friction.vue` with `UTable` (severity badge, kind, node chip, note, source link), `UTabs` severity filter, four `UCard` stats; a navbar link only on the node page's Friction badge count. Rows = every `friction` item on every node.
- 7.5 No chat rate limit in v1: there are no users and an in-memory counter is a no-op on serverless. The single-step `isStepCount(1)`, the history ceiling and gateway caching bound the per-turn cost; a real limiter arrives with auth.

#### Verification
- [x] The three suggested questions each return an answer with ≥ 2 node chips on `/eth` (11, 9 and 23 chips; 0 unknown ids, 0 KaTeX errors, no raw `[[…]]` left in the DOM). Chip click selects the node in Node view (`/eth/thm-main` → `/eth/lem-incidence-parameters`, tree follows, chip shows as selected) and in Graph view (`?view=graph` kept, focus moves to `lem-sparsify`); the conversation survives the view switch
- [x] "What about Coq?" → "The digest doesn't cover Coq…", then points at nearby covered nodes (§B exact arithmetic) with 3 real chips, 0 unknown ids
- [x] Stop aborts mid-stream (button flips Stop → Send, text stops growing); Regenerate on the stopped answer streams a full one (14 chips)
- [x] `/eth/friction` lists all 71 rows (61 inferred_dep + 6 structure_uncertain info, 4 unresolved_ref warn) with working chips; tabs filter All 71 / High 0 (empty state) / Warn 4 / Info 67; reached from the node navbar's friction count
- [x] "Ask about this node" opens the chat (also when explicitly closed) with `Explain [[lem-sparsify]] and what it's used for.` in the prompt; at 390px it opens the slideover, the answer renders without horizontal scroll, and a chip click closes the slideover on the selected node
- [x] Lint, typecheck and `vitest` (74 tests, 8 new in `tests/chat.test.ts`) clean. Screenshots: `verification/screenshots/sprint7_{chat_answer,chip_click,chip_graph,friction}.webp`

#### Deviations and notes (Oct 29)
- **Files:** `server/api/papers/[slug]/chat.post.ts`, `server/utils/chat.ts` (digest serializer, instructions, `trimHistory`, `citedIds`), `app/composables/usePaperChat.ts`, `app/components/chat/{ChatPanel,MessageContent,NodeLink,Math}.vue` + `Comark.ts`, `app/utils/{chatText,katex}.ts`, `app/pages/[paper]/friction.vue`, `tests/chat.test.ts`; edits to `[node].vue`, `NodePage.vue`, `MathText.vue`, `app/utils/nodes.ts`, `shared/api.ts`.
- **One conversation per paper page.** `useChat` (from `@ai-sdk/vue`) has no shared-by-id state, so the page creates it (`createPaperChat` + `providePaperChat`) and both the xl panel and the slideover render the same `ChatPanel`. Navigating nodes, switching Node/Graph or closing the panel keeps the thread; switching papers starts fresh (page is keyed by paper). Below xl the panel is unmounted once mounted (it used to be CSS-hidden) so only one instance renders. A "New conversation" button sits in the panel header. No persistence, per plan.
- **Route:** `streamText` + `toUIMessageStream({ stream: result.stream, onError, messageMetadata })` + `createUIMessageStreamResponse` (no outer `createUIMessageStream` since there is nothing else to write). `isStepCount` is the real ai@7 export. `pruneMessages({ reasoning: 'before-last-message', emptyMessages: 'remove' })` then `trimHistory` (40k chars, cuts at user messages, always keeps the last question). Errors log server-side and reach the reader as "The chat is unavailable right now." The `toy` slug falls back to the fixture in dev like `GET /api/papers/toy`.
- **Instructions** = rules + the digest serialized per node (`[id · kind · "name" · label · §section · claim inside parent]`, plain, why, class + cite, uses (inferred marked), used by). ETH: ~99k chars, **~47.6k tokens**. No display numbers (not in the contract), labels instead.
- **Cost per turn (ETH, Sonnet 5.5, gateway-reported):** a cold turn writes the ~47k-token prefix to cache, ≈ $0.12 by the price table (estimated; every observed turn was already warm); every later turn within the 5-minute cache window reads it from cache: **$0.007–0.010** per turn (e.g. 47,581 in / 47,577 cached / 182 out = $0.0066; 554 out = $0.0103). The finish chunk carries `ChatTurnMetadata` (`model, tokensIn, tokensOut, tokensCached, costUsd, costSource, ms`, new in `shared/api.ts`) on each assistant message's `metadata`; it isn't rendered. The route also logs tokens and any unknown cited ids to the server console.
- **Citations are a Comark plugin, not a text rewrite.** Rewriting `[[id]]` to `:node-link{id}` (the usual `:source-link`-style rewrite) fails whenever the citation isn't preceded by whitespace, e.g. "([[a]], [[b]])" rendered as text. `components/chat/Comark.ts` registers a markdown-it inline rule (first in the chain, ahead of Comark's `[…]` span rule) that emits a self-closing `node-link` node; `defineComarkPlugin` comes from `@comark/nuxt/parse` (a declared dep). A citation still streaming in (`[[lem-spa`) is hidden until it closes.
- **Math in answers:** Comark's `math` plugin for `$…$` / `$$…$$`, rendered by our own `ChatMath` (Comark's built-in `Math` has no macros and swallows errors) through the new shared `renderTex()` in `app/utils/katex.ts` (`MathText` now uses it too: same base macros and `\label` stripping). Comark's inline rule refuses spans that start with a digit (currency guard), which would drop `$2^{O(n/\sqrt{\log n})}$`; `toChatMarkdown` prefixes those with `{}`. `\(…\)` is converted to `$…$`.
- **Suggested questions** are generic so they work on any paper: main theorem + proof steps; "Where does the main bound's exponent come from?" (on ETH this is the √log n question); novel vs standard.
- **Regenerate:** `UChatPromptSubmit` only offers reload in the `error` state; after Stop the status is `ready`, so each assistant message also gets Copy / Regenerate actions (`regenerate({ messageId })`).
- **NodeLink** calls `select(id)` (keeps the query, so it drives Graph view too) and then `onCite`, which closes the slideover below xl so the node is visible; the thread stays. Unknown ids render as a muted mono badge, not clickable. User messages render `[[id]]` as chips too, so the prefilled "Explain [[id]]…" reads well.
- **"Ask about this node"** is a small outline button under the node's sub-line (hidden when no chat is provided, e.g. outside a paper page); it prefills, doesn't send.
- **Friction page:** dashboard layout, one panel (no tree sidebar; "Back to the map" in the navbar). Stat cards: paper statements (non-claim nodes), Lean declarations "—", aligned pairs "—", friction items. Severity filter is local state, not `?severity`, because `NodeChip` carries the whole query onto node pages. Source column links to GitHub file:line via the new shared `sourceUrl()` in `app/utils/nodes.ts` (moved out of `NodePage`). The navbar link is a warning-colored count button on the node page (only when the paper has friction).
- **Dev-server note:** the Sprint 9 agent's concurrent `server/` edits restarted Nitro several times during verification, which cuts in-flight streams; all checks above were re-run on a stable server.
- **Chat tools (post-sprint, Oct 29).** The chat went from one step to up to 4 tool rounds plus a forced answer (`isStepCount(5)`; `prepareStep` sets `toolChoice: 'none'` on the last step rather than `activeTools: []`, so the tool list, and the cached prefix, stay the same). Tools, pure logic in `server/utils/chatTools.ts`: `read_node({ id })` (id, `[[id]]` or LaTeX label) → verbatim statement, proof text from the stored sources with line numbers (span from `stage_outputs.chunk`'s `proof`, else the claims' outline spans when no proof environment follows the statement, else a scan for `\begin{proof}`; claims use their outline span), headline/role, uses / used by / claims, referenced equations, capped at 12k chars with a truncation note; digest-only with a note when no sources are stored (the toy). `search_paper({ query, max? })` → comment-stripped, preamble skipped, phrase match ignoring LaTeX punctuation (`\sqrt{\log n}` = "sqrt log n" = "√log n"), then all-words lines; ≤ 15 hits with file:line, section, the innermost node span containing the line, ±2 lines. `trace({ from, to })` → up to 3 shortest "feeds into" paths over `prerequisites()` from `server/pipeline/dag.ts` (deps_paper ∪ deps_inferred, claim → parent), each link marked cited / inferred / claim of; says when there is no path and whether the reverse holds. `ancestors({ id, direction: 'supports' | 'supported_by', depth? })` → closure by distance, ≤ 60 nodes. Sources (`sources` rows + the digest run's chunk/outline outputs) load lazily on the first tool call and are cached for the request (`server/utils/chatSources.ts`). History pruning now also drops earlier turns' tool calls (`toolCalls: 'before-last-message'`). The serialized digest gained each node's `headline` / `role` and an equations list (label (number): LaTeX, ≤ 100, 160 chars each); ETH instructions are now ~61k tokens. The client renders each call as a compact `UChatTool` row (`app/utils/chatToolRows.ts`): "Read lem:greedy-hashes · file:lines", "Searched “…” · 6 hits", "Traced a → b · 1 step"; spinner while running, error state, "stopped" after Stop; details (paths, hit locations) on click. Cost metadata now sums the gateway cost over all steps. Verified on ETH: the proof-quote question fired `read_node`, the √log n question `search_paper` ×2, the chain question `trace` (after the instructions said to always trace chain questions; before that the model answered from the digest's direct uses). Cost per turn, gateway-reported: warm $0.017–0.046 (1–3 steps, 62k–131k input tokens, ~94–99% cached); the first turn after an instructions change writes the cache, $0.17. Tests: `tests/chat-tools.test.ts`. Screenshot `verification/screenshots/fix_chat_tools.webp`.
- **Hover cards (post-sprint, Oct 29).** Every node reference now opens one shared card, `NodeHoverCard` (`app/components/node/HoverCard.vue` → `HoverCardBody.vue`), replacing the one-line name tooltips: statement refs in paper text (`RefLink`), Uses / Used by / claim chips and friction-table chips (`NodeChip`), chat citations (`chat/NodeLink`), graph cards, and tree rows. Order, for a mathematician: header ("Lemma 6.1 · lem:sparse-checks", semantic name, class + friction badges, "claim inside the proof of …", an inferred-edge note when reached through a dashed chip); the exact statement typeset with the paper's macros (clamped, "Show full statement"); plain terms; why it's here (headline, role, explanation); "Uses: Lemma 6.1, Theorem 4.2 (+2 more)" / "Used by: …" as small links, inferred edges dashed and marked; classification with its citation; provenance (section + title, page when `paper_ref.page` is set, file:line with "Open in source", label, and origin: labeled statement read verbatim vs. claim extracted inside the proof of X (k of n), with the claim's line span up to the next claim); actions Open node / Show in graph / Ask about this (the last only where a chat is provided). Text helpers are pure in `app/utils/nodeCard.ts` (`tests/node-card.test.ts`); the provenance block is `NodeProvenance`, also used by the equation-ref popover so both read the same. Interaction: Nuxt UI `UPopover mode="hover"`, 250 ms open / 150 ms close so the pointer can cross into the card, which is interactive and scrolls (≤ 34rem); keyboard focus opens it and Escape closes it; on touch the first tap opens the card and is swallowed (no navigation), the card's buttons navigate; refs inside a card render as plain links (no card in a card, no equation popover). The graph uses one card anchored to the hovered graph card (not one popover per card): mouse/pen only, not while a drag is in progress, and any pan/zoom closes it, so d3-zoom's drag, wheel and pinch are untouched; the native `title` tooltip is gone. Tree rows get the `compact` card (header, headline, short statement, one provenance line) after 700 ms and never on tap, so sweeping the pointer down the tree doesn't flash cards and a tap still selects the row. Screenshots `verification/screenshots/hover_*.webp`.

---

### Sprint 8: Corpus page, metrics, method comparison [Complete]
**Goal:** Every corpus paper is ingested from the corpus page with both structure methods where its size warrants, the page shows the comparison, tier-1 goldens pass, and this plan records what the numbers say about the default.
**Estimated effort:** 6 hours

#### Tasks
- 8.1 `corpus/manifest.json`: entries `{ slug, tier, title, source: { kind, url|id }, pages, lean: { kind: 'mathlib' | 'openai-math' | 'blueprint' | 'none', ref }, expectedStatements?: n, golden?: 'corpus/golden/<slug>.json' }` for the tiered set below; fill the "pick" slots by checking `openai/math/lean/formalization.yaml` and `CONTENTS.md` for a ≤ 8-page family with Lean and a 50+-page family with Lean (candidates: matrix multiplication 9/4; L = RL = BPL), and pick one ≤ 8-page arXiv note and one ~20-page TCS arXiv paper without formalization (candidate for the latter: Kelley–Meka, *Strong bounds for 3-progressions*, arXiv 2302.05537, ~30 pp, no Lean known; verify). Record the choice and why in this file.
- 8.2 `corpus/golden/sensitivity.json` and `toy.json`: hand-written node ids, kinds, `deps_paper`. Finalize computes `golden_diff` when a golden exists.
- 8.3 `pages/corpus.vue` + `server/api/corpus.get.ts` + `server/api/corpus/[slug]/ingest.post.ts` (frame 06): one row per manifest entry per method run (pipeline / agent), columns per the frame plus `calls`, `turns`; Ingest button opens a `UModal` with method + profile and submits; "Run all pending" queues the tier-1 set sequentially (LocalRunner runs one at a time; a `runs.queued` row waits).
- 8.4 Run the corpus: tier 1 both methods on `standard`; `pfr` and `unit-distance` both methods on `careful`; ETH both methods on `careful` (already done in 4 and 4b, reuse); the second OpenAI whopper and the no-Lean whopper on `careful`, pipeline first, agent if budget allows. Keep the Anthropic slot `no source` until Kyle supplies one.
- 8.5 Write up: a `## Corpus results (Sprint 8)` section in this file with the table and a recommendation for the default method (possibly size-dependent) and profile; set that default in `server/utils/aiModels.ts` (`defaultMethodFor(sizeTokens)`).
- 8.6 `README.md`: "How it works" (pipeline stages, two methods, model profiles), dev setup (`npm ci`, `.env`, `npm run dev`), where things live. `docs/BRIEF.md` gets a one-line pointer to this plan.
- 8.7 Fix what the corpus breaks (chunker edge cases, prompt tweaks). If the single-call outline degrades on the whoppers (critique findings or review items climb, or claims come back shallow), build the per-section hierarchical outline variant here. Each fix noted under the sprint it belongs to.

#### Verification
- [x] Corpus page shows every manifest row with status (18 paper × method rows + the `no source` Anthropic slot); tier 1: **sensitivity 0 diffs under both methods**; `noncoordinate` and `sunflowers-rao` have no golden (only sensitivity and the toy were asked for), recall 3/3 and 5/5 both methods
- [x] `pfr` completes under both methods; `unit-distance` under both; both whoppers under both (pipeline and agent), plus ETH reused from 4/4b and `sunflower-alwz` under both
- [x] Comparison table written into this file (§ Corpus results below); default method set (`defaultMethodFor` in `server/utils/aiModels.ts`, used by the form via `POST /api/papers/preview`)
- [x] README updated ("How it works", dev setup, layout); `docs/BRIEF.md` points here; lint/typecheck clean, vitest 119/119 (13 files; this sprint's new tests: `tests/corpus.test.ts` 7, chunker "Proof of" section 1, runner hardening 2)
- [x] Screenshots: `sprint8_corpus_mixed.webp` (one running, eleven queued, ETH digested), `sprint8_corpus_complete.webp` (all 18 digested, sensitivity `0 diffs` ×2)
- [x] No Vercel sandboxes left running (`Sandbox.list`: 17 recent, all `stopped`)

#### Deviations and notes (Oct 29)
- **Files:** `corpus/manifest.json`, `corpus/golden/{sensitivity,toy}.json`, `shared/corpus.ts` (types, `goldenDiff`, `goldenDiffCount`, `corpusPaperSlugs`, `CorpusResponse`), `server/utils/corpus.ts` (manifest + goldens imported statically so they bundle), `server/api/corpus.get.ts`, `server/api/corpus/[slug]/ingest.post.ts`, `app/pages/corpus.vue`, `tests/corpus.test.ts`; edits to `finalize.ts` (golden diff), `aiModels.ts` (`defaultProfileFor`, `defaultMethodFor`), `papers/preview.post.ts` (returns `defaultProfile` / `defaultMethod`), `papers/new.vue` (uses them; measured $/k-token), `fetch-fixtures.ts` (sensitivity e-print), `.gitignore`.
- **Paper rows per method:** the pipeline run of an entry lives on paper `<slug>`, the agent run on `<slug>-agent` (the convention Sprint 4b started), so both digests stay browsable. A manifest entry may list `papers: { pipeline?: [...], agent?: [...] }` to replace that (ETH's pipeline runs are on Sprint 4's `eth-e2e`). The ingest route creates the row on first ingest (tier, title, authors from the manifest) and adds a fresh run to it after that (409 if one is active); it calls `startRun(runId, paperId)`.
- **Which run a row shows:** newest active run, else newest finished run that made model calls (so a $0 finalize-only re-run or a pre-Sprint-4 stub doesn't stand for the method), else newest failed/cancelled. Cost shows the run's own spend with a `*` and the lineage total (run + `parent_run_id` ancestors) in the title when stages were reused.
- **Golden diff contract:** `golden_diff` gains an additive `kind_mismatches`; `dep_mismatches` is the size of the symmetric difference of `deps_paper` over matched nodes; outlined claims (nodes with `parent_id`) are ignored. Goldens are keyed by the manifest's `golden` path and apply to every paper row of that entry (`sensitivity` and `sensitivity-agent`). The toy golden is for the LaTeX toy fixture (`tests/fixtures/latex/toy`, which can't be ingested as `toy`, a reserved slug): `tests/corpus.test.ts` runs chunk → statement nodes → `\ref` edges with no model calls and asserts 0 diffs for both goldens (sensitivity fetched from arXiv into the gitignored `tests/fixtures/latex/sensitivity/`).
- **Corpus page:** `UTable`, one row per entry × method, the paper cell (tier, pages, Lean badge with the ref as title, source link) on the pipeline row; columns Method · profile, Status (live: `agent · turn N`, `annotate n/N`), Recall · claims, Edges ref/inferred, Critique · review, Calls · turns · retries, Cost · time, Golden, Actions (Open, Log, Ingest/Re-run). Ingest opens a `UModal` (method radio, profile select defaulting to the manifest's profile, budget; $25 for whoppers). "Run all pending" posts every simple-tier entry × method without a run, back to back, and the LocalRunner queue does the rest. Polls every 3 s while anything is active. Columns were folded (Lean into the paper cell, retries into calls) so the table fits 1440 px.
- **An empty column header (`header: ''`) caused a hydration mismatch** in `UTable` (bisected; the column is now "Actions").
- **Review decisions during the sweep** were made from the API by a polling script (accept ≥ 0.7 confidence, reject the rest): 47 items over the new runs (34 accepted, 13 rejected), at most 7 per run.
- **Runs lost to dev-server restarts:** `pfr` pipeline (failed at outline, $0, re-ingested) and `sunflower-alwz` agent (re-run fresh after the chunker fix). One real failure: `sunflower-alwz-agent` failed writing `stage_outputs.classify` (a Postgres jsonb error, see Sprint 1 note); retried from classify (`213160f4`, $0.17) after the fix. Its first run's agent: 4 turns, $0.08, 5 claims, 16 critique findings all auto-applied.
- **No hierarchical outline (8.7):** the single whole-paper call did not degrade on the largest source. L = RL = BPL (~134k tokens, ~250k with line numbers): one Opus call, $1.08, 169 s, 88 claims in 17 long proofs, 8 critique findings / 5 review items, the same order as ETH (7 / 6). Integer multiplication: 72 claims, 7 / 2.
- **Spend this sprint: $32.96** of the $80 cap (all runs on corpus papers: $40.90 now vs $7.94 before; ETH's $6.94 was reused, not re-spent).
- Not verified: the upload tab's method default (uploads are summarized in the browser, so they keep `pipeline`; only matters above 200k tokens); the corpus page under Inngest (same `startRun` path as `POST /api/papers`); the 200k-token agent threshold (no corpus paper that large).

## Corpus results (Sprint 8)

All runs from the corpus page / its API on Oct 29. Tier 1 and `sunflower-alwz` on `standard` (GPT-6 Sol outline/critique/classify, Sonnet agent), the rest on `careful` (Opus). Outline = the structure stage only; Run = the whole run; review items decided by the rule above.

| Paper (tokens) | Method | Recall | Claims | Edges `\ref` / inferred | Critique · review | Calls | Turns | Outline $ · time | Run $ | Wallclock | Golden |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sensitivity (6.6k) | pipeline | 8/8 | 0 | 2 / 4 | 5 · 1 | 21 | — | $0.03 · 10 s | $0.15 | 0.9 m | **0 diffs** |
| | agent | 8/8 | 0 | 2 / 5 | 4 · 0 | 23 | 3 | $0.02 · 10 s | $0.14 | 0.9 m | **0 diffs** |
| noncoordinate (6.1k) | pipeline | 3/3 | 9 | 3 / 10 | 2 · 1 | 35 | — | $0.04 · 26 s | $0.25 | 1.6 m | — |
| | agent | 3/3 | 10 | 3 / 11 | 1 · 1 | 41 | 5 | $0.06 · 19 s | $0.27 | 1.5 m | — |
| sunflowers-rao (24k) | pipeline | 5/5 | 4 | 3 / 13 | 4 · 1 | 25 | — | $0.06 · 28 s | $0.29 | 1.8 m | — |
| | agent | 5/5 | 5 | 3 / 9 | 2 · 0 | 31 | 4 | $0.06 · 13 s | $0.29 | 1.3 m | — |
| sunflower-alwz (25k) | pipeline | 35/35 | 5 | 16 / 24 | 15 · 1 | 102 | — | $0.11 · 62 s | $0.88 | 3.9 m | — |
| | agent | 35/35 | 5 | 19 / 27 | 16 · 0 | 102 + 40 | 4 | $0.08 · 13 s | $1.01 (lineage) | — | — |
| pfr (27k) | pipeline | 21/21 | 10 | 6 / 25 | 7 · 5 | 76 | — | $0.25 · 30 s | $1.11 | 2.4 m | — |
| | agent | 21/21 | 9 | 6 / 26 | 5 · 3 | 79 | 7 | $0.35 · 50 s | $1.20 | 2.9 m | — |
| unit-distance (59k) | pipeline | 39/39 | 57 | 54 / 85 | 12 · 6 | 260 | — | $0.55 · 103 s | $3.18 | 11.5 m | — |
| | agent | 39/39 | 58 | 54 / 83 | 14 · 7 | 278 | 19 | $0.67 · 110 s | $3.38 | 11.6 m | — |
| intmult (85k) | pipeline | 23/23 | 72 | 39 / 110 | 7 · 2 | 268 | — | $0.77 · 137 s | $3.93 | 8.1 m | — |
| | agent | 23/23 | 74 | 39 / 106 | 6 · 5 | 289 | 17 | $1.05 · 158 s | $4.23 | 13.1 m | — |
| eth (85k, Sprints 4/4b) | pipeline | 36/36 | 50 | 52 / 60 | 7 · 6 | 231 | — | $0.79 · 105 s | $3.59 | 10.9 m | — |
| | agent | 36/36 | 50 | 52 / 61 | 8 · 6 | 246 | 17 | $0.58 · 116 s | $3.35 | 6.3 m | — |
| logspace (134k) | pipeline | 76/76 | 88 | 177 / 87 | 8 · 5 | 422 | — | $1.08 · 169 s | $5.57 | 13.8 m | — |
| | agent | 76/76 | 86 | 177 / 67 | 9 · 6 | 433 | 18 | $0.88 · 150 s | $5.27 | 13.0 m | — |
| **Total (9 papers)** | pipeline | | | | | | | **$3.68** | **$18.95** | | |
| | agent | | | | | | | **$3.75** | **$19.14** | | |

Run ids (corpus page "Log"): sensitivity `05553b46` / `a110870c`, noncoordinate `578ca151` / `19150203`, rao `a0fef68b` / `d011894e`, alwz `e9ba4485` / `44de8256` → `213160f4`, pfr `09ae277b` / `0aa25efe`, unit-distance `df18bfac` / `bf412ef9`, intmult `0721c07f` / `d316c7e2`, ETH `266200a5` / `90e9b937`, logspace `d35fc1c8` / `f0a17644`. Edges `\ref` include claim refs; `\ref` counts are identical between methods on every paper because they come from the chunker. Wallclock includes review time and gateway latency (annotate dominates the whopper runs).

**What the numbers say.**
- **Structure is the same under both methods.** Statement recall is 100% everywhere (after the claim-environment fix below), claim counts differ by at most 2 (ETH and ALWZ identical), the methods outline the same long proofs (including ETH's appendix-proved lemma and second `thm:main` proof, and ALWZ's section-length proof), and critique findings and review items are in the same range. The tier-1 golden passes under both.
- **Cost is a wash, with no clean size trend.** Outline cost totals $3.68 (pipeline) vs $3.75 (agent); whole runs $18.95 vs $19.14. The agent was cheaper on ETH (−27%) and logspace (−19%), dearer on intmult (+36%), unit-distance (+22%) and PFR (+40%): it pays per turn for reading proofs in chunks, which wins only when the long proofs are a small share of a large source. The outline is 15–25% of a run; annotate + classify are most of the spend for both.
- **The single whole-paper call holds up at 134k tokens** (no degradation in claims, findings or review items), so the hierarchical outline variant stays unbuilt.
- **Operationally the pipeline is simpler:** no sandbox, no OIDC token in dev, no 90-minute wait loop, and fixed cost per call; under Inngest the agent also needs a public callback URL.

**Recommendation (implemented).** Default method **pipeline** for every size the corpus covers; **agent at ≥ 200k tokens** (`AGENT_MIN_TOKENS` in `server/utils/aiModels.ts`), where the line-numbered whole-paper prompt passes ~400k tokens and one Opus call nears the per-step ceiling while the agent reads only the long proofs (an extrapolation: no corpus paper is that large yet). Profile default unchanged: `careful` over 30 pages or 100k tokens, else `standard`; measured whole-run cost is $0.041–0.054 per 1k source tokens on careful and $0.012–0.041 on standard (the form's estimate line now uses 0.045 / 0.03).

---

### Sprint 9: Inngest runner for production [Complete]
**Goal:** The same `ingestPaper` runs under Inngest on Vercel; dev is unchanged.
**Estimated effort:** 3 hours

#### Tasks
- 9.1 `npm i inngest`. `server/utils/inngest.ts` (client, `isDev: import.meta.dev || undefined`, see the comment there), `server/api/inngest.ts` (`serve` from `inngest/nuxt`, `maxDuration` set to the longest step), `server/pipeline/runners/inngest.ts` (`InngestRunner`), `server/inngest/functions/ingest-paper.ts` (`createFunction` wiring; `step.run` ids = `${stage}:${name}`; concurrency 1 per paper via `concurrency: { key: 'event.data.paperId', limit: 1 }`). Because stages already obey the replay rules in § Step runner, no stage code changes.
- 9.2 `POST /api/papers` and the corpus ingest route: if `process.env.INNGEST_EVENT_KEY` or `!import.meta.dev`, `inngest.send({ name: 'paper/ingest.requested', data })`; else `LocalRunner`. Review decisions and agent finish become `inngest.send('review/decided')` / `('structure/agent.finished')` in that mode; the LocalRunner polling path stays for dev.
- 9.3 Optional dev parity: `npm run dev:inngest` (`npx inngest-cli@latest dev -u http://localhost:3120/api/inngest`) documented in README for testing the Inngest path locally; not part of `npm run dev`.
- 9.4 Vercel: `vercel.json` not needed; env `AI_GATEWAY_API_KEY`, `DATABASE_URL` (Supabase pooler when it exists), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `NUXT_PUBLIC_APP_URL`. Document in README's deploy section. Sandbox auth is automatic on Vercel.

#### Verification
- [x] With `inngest-cli dev` running locally and `INNGEST_EVENT_KEY=local` set, a toy-paper ingest runs through Inngest: steps visible in the Inngest dev UI, run page identical to the LocalRunner path (toy upload run `37d6c296`, quick, $0.03: Inngest trace `run:claim, fetch … finalize, run:finish`, all COMPLETED; `run_events` identical to a LocalRunner run plus one `sent to Inngest` line, no duplicates from replay)
- [x] Review wait under Inngest: ETH retry from critique with `forceReview` (run `034ba807`, $0.99): 9 items queued → decided via the API → `review/decided` sent → `critique:review` applied 1 accepted, 8 discarded → annotate started; then cancelled mid-annotate. Cancel on the toy under Inngest ends with `run cancelled`, as LocalRunner does.
- [x] Without the key, dev still uses LocalRunner (boot log: `[gpe] runner: LocalRunner (dev, no INNGEST_EVENT_KEY)`; Inngest mode logs `runner: Inngest (INNGEST_EVENT_KEY set or not dev)`)
- [x] Lint/typecheck clean; vitest 74/74 (new `tests/inngest-runner.test.ts`: started/finished inside the step, cancel → `NonRetriableError`, flag-before-wait, sliced waits with `if`, timeout)

#### Deviations and notes (Oct 29)
- **Installed:** `inngest` 4.26.1. v4 API used: `createFunction({ id, triggers: [{ event }], concurrency, retries }, handler)`; `step.waitForEvent(id, { event, timeout, if })` (`match` is a single property-path string in v4, so the runner builds an `if` expression `async.data.runId == "<id>"` from the contract's `match` record); checkpointing is on by default (steps run back to back in one request for up to 10 s, then go async).
- **`serve` comes from `inngest/edge`, not `inngest/nuxt`:** the Nuxt/h3 adapter imports `send` from a bare `'h3'`, which resolves to the hoisted **h3@2** (pulled in by `@nuxt/eslint`'s config inspector) instead of Nitro's h3@1, and 500'd every route. `server/api/inngest.ts` is `defineEventHandler(event => handler(toWebRequest(event)))` with `servePath: '/api/inngest'`.
- **`maxDuration` is global:** Nitro 2 builds one Vercel function, so it is `nitro.vercel.functions.maxDuration: 800` in `nuxt.config.ts`, not a per-route export.
- **Dispatcher `server/utils/dispatch.ts`:** `runnerMode()` (`'inngest'` if `INNGEST_EVENT_KEY` or not dev, excluding vitest; logs the choice once — the dev plugin calls it at boot), `startRun(runId, paperId)` (Inngest: `inngest.send({ id: 'ingest-<runId>', name: 'paper/ingest.requested', data: { runId, paperId } })`, deduped by id; an unreachable Inngest marks the run failed and returns 503; local: `void runner.start(runId)`), `signalRun(runId, 'review/decided' | 'structure/agent.finished')` (always sets the progress flag; also sends the event under Inngest). Used by `POST /api/papers`, retry and review. `server/plugins/runner.ts` is a no-op in Inngest mode.
- **Event payload is `{ runId, paperId }`, not the RunContext:** the function's first step `run:claim` flips `queued → running` (`claimQueued`, no one-at-a-time check; the concurrency key serializes per paper) and builds the context from the row (`beginRun`). Lifecycle helpers `beginRun` / `finishRun` / `failRun` moved out of LocalRunner's `execute` into exports of `runner.ts` so both runners log the same `run started` / `run finished` / `run cancelled` / budget lines. `failRun` decides cancelled/budget from the run row too, since under Inngest the error arrives wrapped in a `StepError`.
- **Function:** `retries: 1`; a failed pipeline runs step `run:failed` then throws `NonRetriableError` (the Inngest run shows Failed, no whole-function retry). `RunCancelled` / `BudgetExceeded` thrown inside a step become `NonRetriableError` so Inngest doesn't retry them. **No `cancelOn`:** tried it, but an Inngest-side cancel drops the final `run:failed` step, so the log lost its `run cancelled` line; cancel stays a status write noticed at the next step boundary.
- **Waits are sliced (InngestRunner.waitForEvent):** step `<event>:deadline` memoizes the absolute deadline; then loop `<event>:check-i` (read flag + status; return wait length) → `step.waitForEvent('<event>:wait-i', { timeout: ≤ 15 min })`. This closes the race where the last review decision lands between the critique step finishing and the wait registering (Inngest only sees events sent after a wait starts), notices a cancel during a 24 h wait within 15 min, and stays ≤ ~200 steps for 24 h.
- **Replay audit (every stage + `ingestPaper` + the runner):** `ingestPaper`'s top level only sequences steps and the wait — clean. Every stage runs wholly inside `step.run` and returns a count; `Date.now()` / `new Date()` (outline, critique, finalize, llm.ts) and all DB writes are inside steps; `step.run` returns are numbers, the claim's small `RunContext`, and wait-check objects. LocalRunner's before/after events and `checkpoint()` moved *inside* the step callback in InngestRunner (outside it they would repeat on every replay). One violation of retry-idempotency fixed: **critique's `createReviewItems` inserted again when a critique step was retried** (stage output written first, then the reuse branch re-created items) → now skips if the run already has review items. Accepted, not fixed: a retried step re-spends its model calls and re-logs its events (the spend is real), and `fetch`'s source replace is transactional. The 10-min in-process source cache (`sources/index.ts`) is per-instance, so preview → submit may fetch twice on Vercel; harmless.
- **Deploy:** README "Deploy (Vercel)" lists env per § Environment; added `npm run db:migrate` (`drizzle-kit migrate`, `drizzle.config.ts` reads `DATABASE_URL`) as the prod migration step left open in Sprint 1. `nuxt build` on the Vercel preset not run (no deploy this sprint). `.env.example` lists the Inngest keys.
- Dev DB gains `toy-inngest-131847` (toy upload via Inngest) and four runs on it / ETH from this sprint's checks; `eth.latestRunId` was re-pointed afterwards with a $0 finalize-only re-run of `89f32ea4` (`b23809c8`, same digest).

#### For Sprint 8 (corpus) and Sprint 4b (agent)
- **Sprint 8:** the corpus ingest route creates the run as `POST /api/papers` does and calls `await startRun(runId, paperId)` from `server/utils/dispatch.ts`. Under Inngest, runs of *different* papers run in parallel (concurrency is per `paperId`); only LocalRunner serializes everything. "Run all pending" therefore needs no queueing logic of its own.
- **Sprint 4b:** a wait can't live inside a step and the outline stage is one, so the agent method must split like critique: step `outline` boots the sandbox and returns; `ingestPaper` (top level, `ctx.method === 'agent'`) calls `step.waitForEvent('structure/agent.finished', { match: { 'data.runId': ctx.runId }, timeoutMs })`; step `outline:collect` reads `outline.json` and stops the sandbox. `events.post.ts` calls `signalRun(runId, 'structure/agent.finished')`. Under Inngest the 10-s trace polling of 4b.7 cannot run (no step may last 90 min inside Vercel's 800 s), so prod relies on the HTTP callback; sandbox timeout extension has to happen from the callback route or short polling steps between wait slices. Hook comment is at the bottom of `server/inngest/functions/ingest-paper.ts`.

---

## Post-v1: paper reader and figures [Complete]
**Goal (owner, Oct 29):** the paper's home view is the paper itself, rendered with a real TeX engine, with its figures extracted and looked at by a vision model. Design and alternatives: [../20261029_paper_reader/design.md](../20261029_paper_reader/design.md).

#### What was built
- **Render stage** (`server/pipeline/stages/render.ts`): latexmk + TeX Live 2025 (pdfLaTeX; XeLaTeX/LuaLaTeX when the source asks) in a no-network Vercel Sandbox booted from a TeX snapshot (`server/pipeline/sandbox/tex.ts`, `vercel/sandbox/universal` + Ubuntu's TeX Live collections, poppler, Ghostscript, rsvg-convert, Pillow; built once in ~2 min, cached in `.data/sandbox-tex-snapshot.json` / `SANDBOX_TEX_SNAPSHOT_ID`). SyncTeX on; `server/pipeline/latex/synctex.ts` parses it into node anchors (`PaperRender.anchors`). Fallbacks: arXiv's PDF (page-level anchors and figure pages from `pdftotext`), then `unavailable`. Never fails the run.
- **Figures**: fetchers keep binary assets (`source_assets` over content-addressed `blobs`); `server/pipeline/latex/figures.ts` extracts figure environments; the render stage crops each figure from the compiled PDF via its SyncTeX boxes (caption excluded) and rasterizes with `pdftoppm` + Pillow (`render_figures.py`), or rasterizes the figure's own files when the paper did not compile. **Figures stage** (`stages/figures.ts`): one Opus 5.5 vision call per figure with the image attached (`callObject` gained `images`), schema `figureVisionSchema`.
- **Reader** (`app/components/reader/PaperReader.vue`): PDF.js 6 viewer in the dashboard shell at `?view=paper`, the default landing for `/[paper]`; overlays + margin markers from the anchors; click in a statement selects the node; tree/graph/chat selection scrolls the PDF; find, zoom, page nav, invert for dark mode; figure badges open a dialog. `FigureCard.vue` is shared by the figure-ref popover (`refs.ts` resolves `PaperLabel.kind === 'figure'` → "Figure 3"), the node page's Figures section and the reader dialog.
- **Run page**: "Render paper" / "Re-render" (= re-run from `render`, every structural stage reused); stepper group "Render + figures".

#### Verification
- [x] `/eth` lands on `/eth/thm-main?view=paper&page=1` with the typeset 67-page PDF (pdfLaTeX, 5 s compile, 9.8 s stage); 89/89 nodes anchored (eth-e2e 86/86, eth-agent 86/86, sensitivity 8/8, unit-distance 96/96, sunflowers-rao 9/9)
- [x] Clicking text inside Proposition 2.4 of unit-distance selects `inc-piece`; selecting "Szemerédi–Trotter bound for unit circles" in the tree scrolls to Proposition 2.3 and highlights it; deep links (`/unit-distance/inc-incidence?view=paper`) open at the statement
- [x] Figures: unit-distance (2 TikZ figures, cropped from the PDF) and sunflowers-rao (2 PDF graphics, cropped from the PDF; files fetched by the render stage since the original fetch had dropped them); vision descriptions checked against the images (§ below); a `\ref{fig:budget-intervals}` in a chat answer renders "Figure 1" with the image popover; "Show in paper" scrolls the reader to the figure; the node page lists the figure under "Figures"
- [x] Fallback: `sunflowers-rao-agent` re-rendered with the dev-only `forceRenderFail` shows arXiv's PDF with a banner, 5/10 nodes located by page, figures rasterized from their own files and described; a never-rendered paper (`pfr`) shows "Rendered view unavailable" with source and Render links
- [x] Dark chrome + inverted pages, 390 px (toolbar wraps, page-width scale, node strip at the bottom)
- [x] `npm run lint && npm run typecheck && npx vitest run` clean (new: `tests/figures.test.ts`, `tests/synctex.test.ts`, `tests/figure-vision.test.ts`)

#### Vision spot-check (Opus 5.5)
- unit-distance Figure 1 (interval budgets, TikZ): axis, the four tick labels, the two flanks, the gray "different bits" band and the orange central window with dotted lines are all described correctly.
- unit-distance Figure 2 (strict crosses, TikZ): open circles $y_1=(a,b)$ bottom-left and $y_2=(a',b')$ top-right, filled $(a',b)$ top-left and $(a,b')$ bottom-right, $Y=1$ horizontal and $Y=0$ vertical sides: correct.
- sunflowers-rao Figure 1 (PDF graphic): $V$, $\chi(X,U)$, the ellipse $\chi(j,U)$, the black region inside $\chi(X,U)$ but outside $V$, the gray disk $A$ and the "$\ge|\chi(X,W)|$" annotation: correct. Figure 2: eight petals around the core $A$ and the wavy $V$ are right; one run said the $\chi(X,U)$ petal sticks out of $V$ "on both ends" (it sticks out on the left only), so small spatial claims can be wrong; confidence was 0.8.
- No paper in the corpus has a data plot, so `data_summary` and the "unreadable" rule are covered by the prompt, the schema and a mocked test only.

#### Deviations and notes (Oct 29)
- **TeX Live from Ubuntu's archive instead of Tectonic.** The universal sandbox image is Ubuntu 26.04 with sudo; `apt-get install` of the TeX Live 2025 collections takes ~2.5 min once (snapshot), gives the engine arXiv itself uses, and needs no network at compile time. Tectonic and LaTeXML were weighed, not built (design doc).
- **`latexmk -f`**: recoverable errors don't stop the compile (Rao's 2019 journal class trips a modern `hyperxmp` check but typesets fine); the PDF is kept when it has pages, and the error lines go to the run log and `render.error`.
- **Stage order** `… classify, render, figures, finalize` (contract change: `RunStage` and `RUN_STAGES`). Rendering needs only the sources, but placing it after classify makes "Re-render" a plain re-run from `render` that reuses all structure; a fresh ingest renders at the end.
- **SyncTeX rules learned on ETH/unit-distance**: count glyph and math leaves only (the space after `\end{figure}` is glue tagged with the figure file); a typeset line's box and its first glyph record carry the line that *ended* the paragraph, so leaves with the box's own tag/line are ignored when it has others (else a paragraph ending right before `\begin{theorem}` was drawn as part of the theorem); vboxes never count as "own" boxes; running heads and page numbers (outside each page's body box, tagged with the shipout line) are ignored; rects merge per column.
- **Figure ids** are label-derived (`fig-<label slug>`, `fig:` prefix dropped) or `fig-<number>`; every label inside a figure (subfigures too) becomes `PaperLabel { kind: 'figure', target, number }` at finalize.
- **`/[paper]` lands on the reader only when the digest has `render`**; never-rendered papers land on the node page (the Paper tab then shows the "Render paper" empty state). A bare `/[paper]/[node]` is still the node page.
- **Uploads**: 4.4 MB on Vercel (platform request cap), 32 MB elsewhere; zips may include images. Asset caps: 15 MB per file, 60 MB per paper (skipped assets are logged).
- **Blobs in Postgres** (bytea), not Vercel Blob: works under PGlite, transactional, content-addressed; `GET /api/blobs/:sha` honors Range so no response approaches Vercel's 4.5 MB cap.
- **Failure paths stop the render sandbox**: the stage's `finally`, `failRun`, and the dev boot sweep (a dev-server restart mid-render killed one backfill and its sandbox was stopped by the sweep).
- **Dev-only** `forceRenderFail` on the retry route skips the compile to exercise the fallbacks.
- **Spend**: vision $0.015–0.035 per figure; sandbox time ~10–20 s per paper (4 vCPU). All development + backfills for this section: well under $1 of model spend.

#### For the chat
The chat's digest dump does not include figures yet. Suggested: add one line per figure to the instructions (`Figure 3 · fig:label · kind · p. N · description · supports [[ids]]`) and a `view_figure` tool returning the caption, description, data summary and (optionally) the PNG as an image part, so the model can answer "what does Figure 2 show" without guessing; answers can cite `\ref{fig:…}` and the app renders the figure chip.

---

## Test corpus

Three tiers, each mixing papers that have Lean and papers that don't. Every paper with Lean gets run twice once Phase 2 exists (Lean omitted, Lean present); in v1 the corpus page runs paper-only but records the Lean location so the second mode is a flag, not a new corpus. Papers with Lean are also the Phase 2 alignment test set.

| Tier | Slug | Paper | Lean | Why |
|---|---|---|---|---|
| simple | `sensitivity` | Huang 2019, *Induced subgraphs of hypercubes and a proof of the Sensitivity Conjecture* (arXiv 1907.00847, 6 pp) | Mathlib `Archive/Sensitivity.lean` | Tiny, famous, one Lean file. Golden file. |
| simple | `noncoordinate` | OpenAI, *An explicit noncoordinate polynomial with affine three-space zero fibre* (`openai/math`, 6 pp, one `.tex`) | `lean/OAI/AlgebraicGeometry/AbhyankarSathaye/Counterexample.lean` | Picked in 8.1: the shortest `openai/math` preprint listed in `lean/formalization.yaml`. Same source format and model-written prose as ETH, at toy size. (The plan's candidate, matrix multiplication 9/4, is 13 pp.) |
| simple | `sunflowers-rao` | Rao, *Coding for Sunflowers* (arXiv 1909.04774, 8 pp, Discrete Analysis) | none known | Picked in 8.1: human-written, journal class files in the e-print, and its main lemma is proved in a section titled "Proof of Lemma \ref{…}" rather than a proof environment (an 8.7 chunker fix). |
| intermediate | `pfr` | Gowers–Green–Manners–Tao, *On a conjecture of Marton* (arXiv **2311.05762**, 33 pp) | `teorth/pfr` blueprint | Blueprint `\lean{}` tags are ground-truth alignment for Phase 2. (The plan's 2311.05330 was a different paper.) |
| intermediate | `unit-distance` | OpenAI, *A power saving for planar unit distances* (`openai/math` result family 167, 53 pp, 12 files) | `lean/ComparatorChallenges/PlanarUnitDistances.lean` (`lean/docs/167.md`) | The plan described an Alon–Bloom–Gowers–Litt–Sawin paper of ~22 pp; the `openai/math` unit-distance paper is OpenAI-authored and 53 pp. Kept in the intermediate slot by token count (~59k). |
| intermediate | `sunflower-alwz` | Alweiss–Lovett–Wu–Zhang, *Improved bounds for the sunflower lemma* (arXiv 1908.08483, 19 pp, Annals version) | none known | Picked in 8.1 instead of Kelley–Meka (2302.05537 is 79 pp / ~82k tokens, and it is being formalized in `YaelDillies/LeanAPAP`). Human-written, proof-heavy TCS. |
| whopper | `eth` | *The Exponential Time Hypothesis is False* (`openai/math` #378, 67 pp, 4 `.tex`) | `lean/ComparatorChallenges/SubexponentialSAT.lean` + `lean/OAI/…` | Primary target; known friction in `lean/docs/378.md`. Runs reused from Sprints 4 (`eth-e2e`) and 4b (`eth-agent`). |
| whopper | `logspace` | OpenAI, *Exact Derandomization of Logarithmic Space: L = RL = BPL* (`openai/math` result 103, 108 pp, 17 `.tex`) | `lean/OAI/Computability/Logspace/Equality.lean` | Picked in 8.1: the plan's L = RL = BPL candidate; the largest source in the set (~134k tokens). |
| whopper | `intmult` | OpenAI, *Integer multiplication below n log n* (`openai/math` result 109, 73 pp, 15 `.tex`) | none | Picked in 8.1: 50+ pp `openai/math` family with no Lean entry in `formalization.yaml` / `CONTENTS.md`; TCS like ETH. |
| whopper | `anthropic-1` | A recent Anthropic-released long proof (source not located; Kyle to supply) | if available | A different model's prose. `no source` on the corpus page. |

Sources and picks are in [`corpus/manifest.json`](../../corpus/manifest.json); every source fetched as LaTeX (no substitutes needed for fetch failures). Page counts are the PDFs' real counts.

What a run records is `RunMetrics` above; the corpus page shows it per paper × method. Targets: statement recall 100% (a miss is a bug), tier-1 golden diff 0, `review_items` small enough to clear in a minute, cost within the profile's estimate.

---

## Environment / Config Changes

| Variable | Required | Description |
|---|---|---|
| `AI_GATEWAY_API_KEY` | yes | Vercel AI Gateway key. In `.env` since Oct 29; verified. |
| `DATABASE_URL` | no | Postgres connection string. Unset → PGlite file in `.data/pg/`. Supabase pooler when going live. |
| `NUXT_PUBLIC_APP_URL` | Method B | Public URL the sandbox posts progress to. Dev default `http://localhost:3120` (unreachable from a sandbox → polling fallback). |
| `VERCEL_OIDC_TOKEN` | Method B, local | From `vercel env pull` after `vercel link`; ~12 h. Automatic on Vercel. |
| `GITHUB_TOKEN` | no | Raises the GitHub API rate limit for the directory fetcher. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | prod (Sprint 9) | Dev uses the LocalRunner. |

---

## Decisions (resolved without further review, per Kyle Oct 29)

- **PGlite locally, not a brew Postgres.** Zero install, real Postgres dialect, file-backed, and the driver line is the only thing that changes for Supabase.
- **Inngest for prod, LocalRunner in dev.** The pipeline never imports Inngest directly.
- **Structure method default was decided by Sprint 8's numbers:** `pipeline` below 200k tokens, `agent` at or above (`defaultMethodFor` in `server/utils/aiModels.ts`); see § Corpus results.
- **Profiles:** `careful` for sources over 30 pages or 100k tokens, else `standard`; `quick` is manual.
- **Chat model** Sonnet 5.5 with gateway caching.
- **Tree + DAG both first-class; friction demoted** to a plain table in Sprint 7.
- **`kind` gains `corollary`;** `Friction.kind` gains `inferred_dep`, `unresolved_ref`, `structure_uncertain`; nodes gain `parent_id`, `deps_inferred`.
- **No separate `nodes` table**; the digest is one `jsonb` and the app indexes it in memory.
- **Vercel project link** is needed for Sprint 4b; do it at the start of 4b (`vercel link` under the owner's Vercel team as `digest`), not before.
- **Anthropic whopper** stays an empty corpus slot until Kyle supplies a source.

## Review (Oct 29, fresh-eyes pass, baked in)

A subagent reviewed this plan against the codebase, the house conventions, the installed Nuxt UI 4.12 types, the npm registry and the gateway. Verified green: every package exists (`drizzle-orm/pglite` is a real export), every Nuxt UI component and prop the plan leans on exists, `#shared` resolves from both app and server, the Sandbox API names match 3.9.1, the five model ids resolve. Fixes applied: `isStepCount` (ai@7 name); `runtimeConfig` trimmed to `public.appUrl`; the Agent SDK's gateway base URL is `/claude-code`; no `@types/katex`; `UChatPrompt` takes no `status`; explicit `#shared` imports; `parent_run_id` + explicit `stage_outputs` instead of runner memoization; the Inngest replay rules; the dev boot sweep and queue drainer; polling as the agent's default transport; reserved slugs; `maxDuration`; the hierarchical outline and the chat guard dropped from v1; storyboard labels synced. Production-safety and docs/analytics passes were skipped: pre-prod, and no analytics framework exists yet.

## Considered and rejected

- A `pipeline/` CLI directory (first draft): rejected, nothing command-line.
- Static JSON under `public/papers/` (first draft): rejected in favor of Postgres so the serverless story and the Supabase story are the same code.
- Force-directed graph: rejected; proofs are DAGs with a direction and should read top-down.
- Per-section extraction without a global outline: rejected for long papers (see § Model strategy).
- Running the Agent SDK inside the Nuxt server process: rejected; it needs a filesystem, minutes to an hour of wall time, and isolation from the app. Sandbox it.
- Batch model variants for cost: not now; latency matters while iterating. Revisit for the corpus sweep.

## What's Deferred / Out of Scope
- PDF input.
- Lean extraction, alignment, Lean-vs-paper friction (Phase 2–3). Schema, tree level, node-page slots and corpus are built to receive them.
- Auth, multi-user, Supabase client/RLS, chat persistence, analytics events (no analytics framework exists in this repo yet; add one with auth).
- Graph niceties beyond layered layout + focus + zoom/minimap (added Oct 29, see Sprint 6): no edge bundling, no WebGL.
- Hosted multi-tenant ingestion limits and any rate limiting (arrive with auth).

## Production Safety
Pre-prod: no live users, no shared DB, no deploy yet. The skill's Pass 2 is skipped. Before the first deploy (after Sprint 9): a Supabase project and pooler URL, Inngest keys, the gateway key in Vercel env, and a smoke ingest of the toy paper on the preview deployment.

## Verification artifact (Phase 5)
[verification/index.html](verification/index.html): open it in a browser. It covers what was built, a sprint-by-sprint walkthrough (1, 2, 3, 4, 4b, 5, 6, 7, 8, 9, post-sprint polish) with captioned screenshots for the UI sprints and live sample output for the backend sprints (`verification/samples/`), brief deviations per sprint, the corpus results table and default-method decision, and an end-to-end ETH run-through (form → run → review queue → run complete → library → node page with equation ref → graph with headlines → zoomed → chat with chips → friction → corpus). The `e2e_*` screenshots were retaken on Oct 29 with the GPE branding; older sprint screenshots predate the rename.
