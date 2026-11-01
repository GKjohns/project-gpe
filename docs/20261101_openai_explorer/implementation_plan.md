# OpenAI Papers Explorer — Implementation Plan

> Pivot of Project GPE from an operator tool into a public reading site for [openai/math](https://github.com/openai/math). The name stays "GPE" for now. The explorer internals (tree, node page, graph, reader, chat) do not change.

**Created:** November 1, 2026
**Status:** Sprints 1–4 complete locally (Nov 1); Sprint 5.1–5.2 (export/import scripts) done locally; Sprint 0 infra + Sprint 5.3–5.8 pending

> **Superseded data layer (Nov 1):** the Drizzle/PGlite/`DATABASE_URL`/pooler items in Sprint 0 and Sprint 5 (0.1, 0.2, 0.5, 0.6, 5.2, 5.4, 5.8's pooler text, the Environment table's `DATABASE_URL` / `ALLOW_REMOTE_DEV_DB` rows) are superseded by the Supabase-native plan, [../20261101_supabase_native/implementation_plan.md](../20261101_supabase_native/implementation_plan.md) (see its "Mapping of the openai_explorer plan's remaining items"). The app now runs on Supabase via `@nuxtjs/supabase`; `DATABASE_URL` and the poolers are gone. Text below is kept as history.
**Context:** GPE v1 ([docs/20261029_digest_v1/implementation_plan.md](../20261029_digest_v1/implementation_plan.md)) is built and undeployed: ingest from the browser, run page, tree + node pages, DAG, reader, chat, agent API, operator auth. Its home page is an operator library. openai/math holds 721 machine-written manuscripts in 373 result families across 17 disciplines, released as "raw research data". Five of them (eth, logspace, intmult, unit-distance, noncoordinate) already have full digests in the dev DB. Kyle approved the storyboard ([storyboard.html](storyboard.html), frames 01–09) and picked the hero ([hero/gpt-image-2-a.webp](hero/gpt-image-2-a.webp); critique in [hero/README.md](hero/README.md)).

**Goal:** A public site at `project-gpe.vercel.app` (Vercel project `project-gpe`, Supabase Postgres) where a reader lands on a painted hero, browses all 373 families with abstracts and PDF links (built from the repo index, zero model calls), opens a family, and for the five digested papers lands on a new overview page ("what this paper proves", main theorem, novel steps, proof shape) before entering the unchanged explorer. Ingest, runs, review, corpus and cost move under `/admin` behind the existing operator login, along with the read APIs those pages use.

**Scope:** Catalog tables + a sync from the openai/math index; public shell (overlay header, landing, catalog, family pages); paper overview + a one-call `summary` on the digest (finalize + backfill for the five); admin move + read-API guarding; breadcrumb and view switcher in the explorer; agent API and docs updated for the new positioning; prod guards; deploy to Vercel + Supabase with the five digests imported. No bulk digests (a 30-family flagship list sorts first; running them is later). No analytics framework (Vercel Web Analytics at most). No rename.

---

## Handoff / Execution Notes (read first — this plan is self-contained)

**Repo & runtime.** App root is the repo root (no `src/`). Nuxt 4.6, Nuxt UI 4.12, Tailwind 4, Node ≥ 22.19, npm. Commands: `npm run dev -- --port 3120` (or `preview_start {name:"digest"}` from [.claude/launch.json](../../.claude/launch.json)), `npm run typecheck`, `npm run lint`, `npm test` (vitest). CI runs lint + typecheck. Read [README.md](../../README.md) once: pipeline, agent API, operator auth, deploy table.

**Dev database.** PGlite in `.data/pg/`. It holds the five digests plus ~40 other rows (human-written arXiv fixtures, `-agent`/`-e2e` copies, other corpus runs). PGlite is single-process: **stop the dev server before any `npm run` script that opens the DB** (`paper:public`, `catalog:sync`, `papers:export`); [scripts/db.ts](../../scripts/db.ts) refuses while `:3120` answers. Migrations run on dev boot. `npm run db:generate -- --name <n>` (drizzle-kit) writes the next numbered migration + `meta/`; `npx drizzle-kit generate --custom --name <n>` makes an empty one for hand-written SQL (0003 is an example).

**`DATABASE_URL` never goes in `.env`.** Anything against Supabase runs inline: `DATABASE_URL='<session pooler>' npm run db:migrate`. A `.env` holding it would point `npm run dev` at prod (Sprint 0 adds a guard too). Same note goes in `.env.example`.

**Operator mode in dev.** With no `OPERATOR_TOKEN` the app is `open`: **every visitor is the operator**, so public-vs-operator behaviour can't be seen. For Sprints 2–4 verification put `OPERATOR_TOKEN=<long random>` in `.env`, restart, and check a signed-out tab and a signed-in tab (`/login`).

**Verification.** Playwright MCP or the in-app browser against `http://localhost:3120`. Keeper screenshots go to `docs/20261101_openai_explorer/verification/screenshots/` as WebP (`cwebp -q 80`, at `/opt/homebrew/bin/cwebp`). Check light, dark, and 390px (no horizontal scroll) for every public page.

**Conventions to match.**
- Nuxt UI 4 components on their defaults; `app.config.ts` keeps primary `indigo`, neutral `zinc`. `UHeader`/`UMain`/`UFooter` for public pages ([app/layouts/default.vue](../../app/layouts/default.vue)); `UDashboard*` for the explorer and admin. **The one stated deviation from stock behaviour** is the landing header overlay (Sprint 3).
- ESLint stylistic: no trailing commas, 1tbs braces. TypeScript strict. Short why-not-what comments. `#shared/*` for app/server types.
- Model calls: `callObject` in [server/pipeline/llm.ts](../../server/pipeline/llm.ts) with strings from [server/utils/aiModels.ts](../../server/utils/aiModels.ts) (`~/claude-ops/conventions/ai_sdk_usage.md`). Prompts are `.md` files in `server/pipeline/prompts/` imported raw.
- Precedent for "one model call over an existing digest, backfillable": [server/pipeline/graphLabels.ts](../../server/pipeline/graphLabels.ts) + [labels.post.ts](../../server/api/papers/[slug]/labels.post.ts) + "Regenerate graph labels" on the run page. The summary copies it exactly.
- Tests: vitest with in-memory PGlite (`createDb({ memory: true })` + `setDb(db)`, see [tests/agent-api.test.ts](../../tests/agent-api.test.ts)); pure-function tests like [tests/operator-auth.test.ts](../../tests/operator-auth.test.ts). The operator scripts (`scripts/*.ts`, tsx) can't value-import `#shared` or `.md`; keep anything they load on relative imports.

**Contracts** (§ Route table, § Data model, § API shapes) are fixed by Sprint 1. Change the contract section first if a later sprint must.

**Execution order.**
- **Sprint 0** (infra preview of today's `main` + prod guards) first; it needs two things from Kyle: the Supabase connection strings (project ref `qnsjllrorhxmtfcoqlks`, us-east-1; transaction pooler `:6543` for the app, session pooler `:5432` for migrations/scripts) and Vercel CLI/MCP auth.
- **Sprints 1 and 2 in parallel** after 0. `shared/api.ts` is owned by Sprint 1. Sprint 1's task 1.8 (two one-line consumer edits in `app/pages/index.vue` and `[node].vue`) lands first; Sprint 2 moves `index.vue` only after it.
- **Sprints 3 and 4 in parallel** after 1 and 2 (disjoint files).
- **Sprint 5**: migrate → sync → import → firewall → promote.
- Always migrate the target DB before deploying code that needs new tables.

**Per-sprint loop.** Announce → execute (subagent gets this plan, its sprint and these notes) → `npm run lint && npm run typecheck && npm test` → browser check → update this file (status badge, deviations) → report. Before reporting the plan done, write `verification/index.html` (screenshots per sprint + prod smoke results), as v1 did.

**Commit/push policy.** Don't commit or push unless Kyle asks. Never commit `.env`, `.data/` (incl. `.data/export/`), loose screenshots, or a Supabase access token. Every outbound step (Vercel env, Supabase, deploys, data import, firewall) is confirmed with Kyle first.

---

## Storyboard

[storyboard.html](storyboard.html) — interactive. Family numbers were corrected in place on Nov 1 (logspace 103, intmult 109, unit-distance 167, noncoordinate 049; footer Apache-2.0); its node counts remain placeholders.

| # | Frame | Builds in |
|---|---|---|
| 01 | Landing: full-bleed painting, serif headline, two CTAs, featured digests, "how a paper reads here", 17-discipline grid | Sprint 3 |
| 02 | Catalog `/papers`: search, discipline, Digested, Has Lean, sort | Sprint 3 (data: 1) |
| 03 | Family page, digested: description, manuscripts with expandable abstracts, PDF links, digest rail, Ask box | Sprint 3 (`?ask=` handling: 4) |
| 04 | Paper overview `/<slug>` (new) | Sprint 4 |
| 05 | Explorer tree + node + chat: only breadcrumb + Overview·Tree·Graph·Paper switcher change | Sprint 4 |
| 06 | Explorer graph view: same navbar | Sprint 4 |
| 07 | Family page, not yet digested: empty-state rail, "Request a map" mailto | Sprint 3 |
| 08 | Admin `/admin`: papers table with Family column and Public switch; login unchanged | Sprint 2 |
| 09 | Footer + agents | Sprint 3 (footer), Sprint 1 (`/api/v1/families`, llms.txt) |

**Deviations from the storyboard:** admin sidebar ships Papers / New paper / Corpus / Sync catalog / View site (Runs, Review queue, Agent stats deferred). Footer license is Apache-2.0. Header search is a button to `/papers?focus=1`, not ⌘K. The family-page Ask hand-off uses `?ask=` (not `?q=`) and **prefills** the chat; it does not auto-send.

---

## Current State

### What Exists
- Library at `/` ([app/pages/index.vue](../../app/pages/index.vue)) reading `GET /api/papers` ([papers.get.ts](../../server/api/papers.get.ts)), which returns **every** paper with its latest run (status, cost, progress), public or not.
- `/papers/new` ([new.vue](../../app/pages/papers/new.vue), `middleware: 'operator'`), `/papers/<slug>/run` ([run.vue](../../app/pages/papers/[slug]/run.vue)), `/corpus` ([corpus.vue](../../app/pages/corpus.vue)); `/login` ([login.vue](../../app/pages/login.vue), `next` defaults to `/`).
- `/<slug>` ([[paper]/index.vue](../../app/pages/[paper]/index.vue)) only redirects into the reader or the run page.
- Explorer [[paper]/[node].vue](../../app/pages/[paper]/[node].vue) (620 lines, `layout: 'dashboard'`): paper switcher `useFetch<PaperListItem[]>('/api/papers')` (line 31), parent › node `UBreadcrumb` (73–89), Paper/Node/Graph `UTabs` (91–100, template ~421), `createPaperChat` (176) whose `input` ref is the prefill hook. [useDigest](../../app/composables/useDigest.ts) uses `useFetch`, which forwards the cookie during SSR.
- Layouts: [app.vue](../../app/app.vue) (title "Project GPE"), [default.vue](../../app/layouts/default.vue) (stock `UHeader`, sign-out, `UFooter`), [dashboard.vue](../../app/layouts/dashboard.vue). [AppLogo.vue](../../app/components/AppLogo.vue) is the "GPE" wordmark.
- Operator auth: `needsOperator` in [server/utils/operator.ts](../../server/utils/operator.ts) guards **non-GET** `/api/*` except `OPEN_WRITES` (44–69); [server/middleware/operator.ts](../../server/middleware/operator.ts) applies it; [server/plugins/operator.ts](../../server/plugins/operator.ts) logs the auth mode at boot. Client: [useOperator.ts](../../app/composables/useOperator.ts), named middleware [app/middleware/operator.ts](../../app/middleware/operator.ts).
- `papers.public` gates the agent API only ([server/utils/agentApi.ts](../../server/utils/agentApi.ts): `ttlCache`, `listPublicPapers`, `loadPublicDigest`). Migration 0003 made nine maps public **including the human-written fixtures** (pfr, sensitivity, sunflowers-rao, sunflower-alwz). Flip via `POST /api/papers/:slug/public` or `npm run paper:public`.
- `GET /api/papers/:slug` and the chat (`loadDigest` in [server/utils/digests.ts](../../server/utils/digests.ts)) serve **any** paper. `GET /api/runs/:id`, `GET /api/corpus` are public.
- DB ([schema.ts](../../server/db/schema.ts)): `papers`, `sources`, `runs`, `run_events`, `stage_outputs`, `review_items`, `blobs`, `source_assets`, `agent_requests`; migrations 0000–0003. [server/db/index.ts](../../server/db/index.ts): `postgres(url, { max: 5 })`, no `prepare: false`; with no `DATABASE_URL` it mkdirs PGlite anywhere, including on Vercel.
- [server/plugins/runner.ts](../../server/plugins/runner.ts): in dev with LocalRunner, `sweep()` marks every running run failed at boot — against whatever DB `DATABASE_URL` names.
- Finalize ([finalize.ts](../../server/pipeline/stages/finalize.ts)) makes no model calls; `buildDigest` at line 142. `PROFILES` at [aiModels.ts](../../server/utils/aiModels.ts) line 12; all five OpenAI digests ran `careful`.
- Graph: [ProofGraph.vue](../../app/components/graph/ProofGraph.vue) (860 lines, d3-zoom, needs `useDigestContext()`); helpers in [app/utils/graph.ts](../../app/utils/graph.ts) (`graphNodes`, `graphEdges`, `graphRanks`).
- Agent API: [mcpTools.ts](../../server/utils/mcpTools.ts) (`McpPaperRow` line 19, `paperOverview` 34, `LIST_PAPERS_DESCRIPTION` 206, `agentGuide` 300), `/llms.txt`, `/agents.md`, `/api/v1/papers…`, `/api/mcp`, logged by `logAgentRequest` ([agentLog.ts](../../server/utils/agentLog.ts) line 140). `GET /api/health` reports driver, migration count, gateway key.
- `RESERVED_SLUGS = ['papers', 'corpus', 'api', 'toy']` ([shared/schemas.ts](../../shared/schemas.ts) 85). Vercel repo link `.vercel/project.json` (`prj_lqyQR5yUqQsXkdiL6RpfvFdYFHAL`, team `team_KHp64cz7yPmg0MTiJdbsgNL3`). Nothing deployed. `public/` holds only `favicon.ico`. No `.cursor/mcp.json`.

### What Changes
- Tables `families`, `manuscripts`, `catalog_meta`; `papers.manuscript_dir`; migrations 0004 (catalog) and 0005 (RLS). `server/catalog/` (parse, sync, query), `shared/catalog.ts`, `shared/flagship.ts`, `/api/v1/families…`, `npm run catalog:sync`.
- `/` becomes the landing; `/papers`, `/papers/<code>` new; `/<slug>` becomes the overview; admin pages move under `app/pages/admin/` with `app/pages/admin.vue` as parent and a new `app/layouts/admin.vue`.
- `needsOperator` gains guarded reads; `/api/papers` is the public list (full list → `/api/admin/papers`); private papers 404 for the public.
- `PaperDigest.summary` (additive), written by finalize, backfilled by `POST /api/papers/:slug/summary`.
- Agent API rows/overview gain catalog fields; `/llms.txt` rewritten for the positioning; README, BRIEF note, `.env.example`; robots + sitemap.
- Prod guards in `server/db/index.ts`, `server/plugins/runner.ts`, `server/plugins/operator.ts`, `nuxt.config.ts`. Export/import scripts.

### What Stays
- Pipeline, stages, runners, Inngest, reader, tree, graph, node pages, chat behaviour and limits, agent tools, sign-in, `AppLogo`, colors. Human-written papers stay in the dev DB as hidden fixtures (reachable from admin, used by tests), never deleted, **not imported to prod**.

---

## Architecture

```
openai/math @ <commit sha>   (read-only; zero model calls)
  CONTENTS.md ─────────── families (number, title, description) + members (dir, pdf, title, abstract)
  overview.tex ────────── family → discipline; cross-check of member dirs
  lean/formalization.yaml  manuscripts with Lean
  README.md ───────────── reasoning-trace PDFs
        │  server/catalog/sync.ts  (npm run catalog:sync · POST /api/admin/catalog/sync)
        ▼
Postgres: families ─< manuscripts ─ ─ papers.manuscript_dir (soft link, set by sync from source_ref)
          catalog_meta (sha, synced_at)   papers.digest (+ summary) · papers.public
        ▼  loadCatalog() in server/utils/agentApi.ts (ttlCache) → server/catalog/query.ts (pure filters)
  /api/v1/families, /api/v1/families/:code, /api/v1/disciplines   (pages + agents; same-site page fetches not logged)
  /api/papers (public digests)  /api/papers/:slug (+ catalog)
        ▼
Public: /  →  /papers  →  /papers/<code>  →  /<slug> (overview)  →  /<slug>/<node>?view=tree|graph|paper
Admin (operator): /admin, /admin/papers/new, /admin/papers/<slug>/run, /admin/corpus
Digests: unchanged pipeline; finalize adds one summary call (the run profile's strong model).
```

---

## Route table

### Pages

| Path | Who | What | Was |
|---|---|---|---|
| `/` | public | Landing (01) | operator library → `/admin` |
| `/papers` | public | Catalog (02); query `q`, `discipline`, `digested`, `lean`, `sort`, `focus` | — |
| `/papers/<code>` | public | Family page (03, 07). 1–3 digits; canonical is zero-padded (`/papers/49` → 301 `/papers/049`); unknown → 404 | — |
| `/<slug>` | public if `papers.public`, else operator | Paper overview (04); private/missing → 404 | redirect into reader |
| `/<slug>/<node>`, `/<slug>/friction` | same as `/<slug>` | Explorer / friction, unchanged (+ `?ask=`) | same |
| `/login` | public | Unchanged; `next` default → `/admin` | same |
| `/llms.txt`, `/agents.md`, `/robots.txt`, `/sitemap.xml` | public | Agent guide (rewritten intro); robots + sitemap new | — / same |
| `/admin` | operator | Papers table (08) | `/` |
| `/admin/papers/new` | operator | New-paper form | `/papers/new` |
| `/admin/papers/<slug>/run` | operator | Run page | `/papers/<slug>/run` |
| `/admin/corpus` | operator | Corpus page | `/corpus` |

Old `/papers/new`, `/papers/<slug>/run`, `/corpus` are simply gone: they 404 (nothing was ever deployed, so no redirects). `/admin/**` is guarded by `app/pages/admin.vue` (`definePageMeta({ layout: 'admin', middleware: 'operator' })`, body `<NuxtPage />`); Nuxt runs a parent route's middleware and merges its meta for every child. `RESERVED_SLUGS` gains `admin`, `login`.

### API

| Route | Who | Notes |
|---|---|---|
| `GET /api/papers` | public | **Public digested papers only** (`PublicPaperItem[]`); no run/cost/progress |
| `GET /api/papers/:slug` | public if public, else operator | Adds `catalog`. Private → same 404 as missing |
| `POST /api/papers/:slug/chat` | public if public, else operator | Private → 404; limits unchanged |
| `GET /api/blobs/:sha` | public | Unchanged |
| `GET /api/v1/families`, `/api/v1/families/:code`, `/api/v1/disciplines` | public | New. Used by the site's pages and by agents; logged as `v1` (`list_families`, `get_family`, `list_disciplines`) except same-site page fetches |
| `GET /api/v1/papers…`, `/api/mcp`, `/llms.txt`, `/agents.md` | public | Rows/overview gain catalog fields |
| `GET /api/session`, `POST /api/session/login\|logout`, `GET /api/health` | public | Unchanged |
| `POST /api/inngest` (signed), `POST /api/runs/:id/events` (bearer) | — | Unchanged |
| `GET /api/admin/papers` | **operator** | Today's full list + `public`, `family` |
| `POST /api/admin/catalog/sync` | **operator** | Runs the sync, returns its report |
| `GET /api/corpus`, `GET /api/runs/:id` | **operator** | Now guarded (were public) |
| `POST /api/papers/:slug/summary` | **operator** | New: (re)writes `digest.summary` |
| every other non-GET `/api/*` | **operator** | Unchanged deny-by-default |

Guard rule ([operator.ts](../../server/utils/operator.ts)): keep `OPEN_WRITES`; add `OPERATOR_READS = [/^\/api\/admin(\/|$)/, /^\/api\/corpus(\/|$)/, /^\/api\/runs(\/|$)/]` checked for GET/HEAD after the same decode + `//` collapse. OPTIONS stays open. Per-paper visibility is a handler check (`canSeePaper`), because it depends on the row.

---

## Data model

### openai/math index → what the sync parses (verified Nov 1 against `main`)

| File | Rule | Gives |
|---|---|---|
| `CONTENTS.md` (primary) | Split into `<td>…</td>` cells (1,094 today). `^\*\*(\d{3})\. (.+?)\*\*\s*(.*)$` (dotall) starts a family: number, title (strip trailing `.`), description. `^&emsp;\[(.+?)\]\(preprints/([^/]+)/([^)]+)\)\s*(.*)$` is a member of the current family: title, dir, pdf file, abstract (17 have `\n\n` paragraphs). Any other cell is a parse error. | 373 families, 721 manuscripts; `position` = order |
| `overview.tex` | Line-oriented. `\cataloguesection{<Discipline>}{…}` sets the current discipline (17; discipline order = first appearance). Each `\resultentry{<num>}{…` line belongs to it; member dirs from `\href{https://github.com/openai/math/blob/main/preprints/<dir>/<file>}`. One entry per line today. | discipline; cross-check |
| `lean/formalization.yaml` | No YAML dependency: between `sources:` and `related_formalizations:`, each `id: ../preprints/<dir>/` marks Lean. | 176 manuscripts, 138 families |
| `README.md` | `^\| (\d{3}) \| \[(.+?)\]\((reasoning_traces/[^)]+)\) \|$` | trace PDFs for 10 families |

**Pinning.** Resolve `main` to a sha (`GET https://api.github.com/repos/openai/math/commits/main`; `GITHUB_TOKEN` if set), fetch the four files from `https://raw.githubusercontent.com/openai/math/<sha>/<path>`, store `{ sha, syncedAt, counts }` in `catalog_meta` under key `openai-math`.

**Validation (abort unless `--force`):** CONTENTS family count equals overview's `\resultentry` count; every CONTENTS family is in overview; per-family member-dir sets identical (0 mismatches today); no dir twice. The report prints counts per discipline, Lean families, stale rows (in DB, not in index; kept, never deleted) and papers linked.

**Text normalization** (`normalizeIndexText`, pure): `` $`x`$ `` → `$x$`; unwrap `<i> <em> <b> <strong>`; `<sub>x</sub>` → `$_{x}$`, `<sup>x</sup>` → `$^{x}$`; decode `&amp; &lt; &gt; &quot; &#39; &emsp; &nbsp;`; collapse spaces, keep `\n\n`. Renders through `<NodeMathText>`.

**Derived links** (read time): PDF `https://github.com/openai/math/blob/main/preprints/<dir>/<pdf_file>`; source `https://github.com/openai/math/tree/main/preprints/<dir>/build` (the URL shape the GitHub fetch stage consumes; see the five in [corpus/manifest.json](../../corpus/manifest.json); 3 Hodge-family dirs have no `build/`, acceptable); README `…/tree/main/preprints/<dir>`.

**Digested today** (dir from `papers.source_ref`): eth → 378 (TCS, Lean), logspace → 103 (TCS, Lean), intmult → 109 (TCS), unit-distance → 167 (Combinatorics, 2 members, Lean), noncoordinate → 049 (Algebraic and complex geometry, 2 members, Lean).

### Tables — `server/db/schema.ts` (migration `0004_catalog.sql`, generated)

```ts
export const families = pgTable('families', {
  number: integer('number').primaryKey(),            // 378; display code '378', '049'
  title: text('title').notNull(),                    // normalized
  description: text('description').notNull(),
  discipline: text('discipline').notNull(),          // 'Theoretical computer science'
  disciplineSlug: text('discipline_slug').notNull(), // 'theoretical-computer-science'
  position: integer('position').notNull(),           // order in CONTENTS.md
  memberCount: integer('member_count').notNull(),
  hasLean: boolean('has_lean').notNull().default(false),
  reasoningTrace: text('reasoning_trace')            // 'reasoning_traces/<file>.pdf'
}, t => [index('families_discipline_idx').on(t.disciplineSlug)])

export const manuscripts = pgTable('manuscripts', {
  dir: text('dir').primaryKey(),
  familyNumber: integer('family_number').notNull().references(() => families.number),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  abstract: text('abstract').notNull(),
  pdfFile: text('pdf_file').notNull(),               // 'paper.pdf'
  publishedOn: date('published_on'),                 // from the dir's '-October-25-2026' suffix
  hasLean: boolean('has_lean').notNull().default(false)
}, t => [index('manuscripts_family_idx').on(t.familyNumber)])

export const catalogMeta = pgTable('catalog_meta', {
  key: text('key').primaryKey(),                     // 'openai-math'
  value: jsonb('value').$type<{ sha: string, syncedAt: string, counts: Record<string, number> }>().notNull()
})

// papers gains: manuscriptDir: text('manuscript_dir') + index('papers_manuscript_idx') — soft link, no FK,
// so sync and import order don't matter.
```

**Linking.** End of every sync and of the import: load `papers.id, source_ref, manuscript_dir`; for rows with null `manuscript_dir` whose `source_ref` matches `/\/preprints\/([^/]+)/` and the dir exists, set it. Links the five and their copies with no manual step.

**"Digested"** for a manuscript = some paper with `public`, `digest IS NOT NULL`, `manuscript_dir` = dir (most recent `updated_at` wins). Private copies never count.

### Migration `0005_rls.sql` (custom)

Only `ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;` for papers, sources, runs, run_events, stage_outputs, review_items, blobs, source_assets, agent_requests, families, manuscripts, catalog_meta (`--> statement-breakpoint` between). Supabase exposes `public` over its Data API; the app connects as the owner (bypasses RLS) and never uses supabase-js, so this closes that door without changing the app. Fixture visibility is not a migration: dev runs `npm run paper:public -- --off pfr sensitivity sunflowers-rao sunflower-alwz` once (2.9); prod never gets those rows.

### `PaperDigest.summary` — `shared/types.ts` (additive)

```ts
export interface PaperSummary {
  headline: string     // the result in one line, ≤ 140 chars, inline $…$ allowed (cards, rails, agent rows)
  proves: string       // "What this paper proves": exactly 3 plain-English sentences, ≤ 700 chars
  model: string
  generated_at: string
}
// PaperDigest gains: summary?: PaperSummary   (absent → UI falls back; Sprint 4)
```

### API shapes — `shared/catalog.ts` (new), `shared/api.ts` (owned by Sprint 1)

```ts
export interface FamilyDigest { slug: string, dir: string, counts: { nodes: number, sections: number, novel: number, friction: number }, pages?: number, headline?: string }
export interface FamilySummary {
  number: number; code: string                     // '049'
  title: string; description: string; discipline: string; disciplineSlug: string
  members: number; hasLean: boolean; reasoningTrace?: string   // absolute URL
  digested: FamilyDigest[]                          // [] = not yet
  flagship?: { rank: number, reason: string }
}
export interface FamiliesQuery { q?: string, discipline?: string, digested?: '1' | '0', lean?: '1' | '0', sort?: 'flagship' | 'number' | 'title' | 'members', limit?: number, offset?: number }
export interface FamiliesResponse { total: number, offset: number, limit: number, families: FamilySummary[] }
export interface CatalogStats { families: number, manuscripts: number, disciplines: number, digested: number, lean: number, sha: string, syncedAt: string }
export interface DisciplinesResponse { stats: CatalogStats, disciplines: { slug: string, name: string, families: number, digested: number }[] }
export interface ManuscriptItem { dir: string, title: string, abstract: string, publishedOn?: string, pdfUrl: string, sourceUrl: string, readmeUrl: string, hasLean: boolean, digest?: FamilyDigest }
export interface FamilyDetail extends FamilySummary { manuscripts: ManuscriptItem[] }

// shared/api.ts
export interface PublicPaperItem {                  // GET /api/papers
  slug: string; title: string; authors: string[]
  counts: { nodes: number, sections: number, novel: number, friction: number }
  family?: { number: number, code: string, title: string, discipline: string, disciplineSlug: string }
  pages?: number; hasLean?: boolean; headline?: string; updatedAt: string
}
// PaperListItem (now GET /api/admin/papers) gains: public: boolean; family?: { number: number, code: string }
// PaperResponse gains: catalog?: { family: FamilySummary, manuscript: ManuscriptItem } | null
```

Defaults: `sort=flagship` (flagship rank, then digested, then number), `limit=50` (max 400). `q` matches case-insensitively against family title/description and member titles/abstracts, in memory (373 rows).

---

## Flagship list — `shared/flagship.ts`

Ordered `FLAGSHIP: { number: number, reason: string }[]`, rank = index + 1; drives `sort=flagship` and the "featured" badge. Not processed in this build. Numbers and Lean status verified Nov 1. The unit test checks uniqueness only (the fixture has 3 families); Sprint 1 verification checks every number against the real sync.

| # | Family | Reason |
|---|---|---|
| 1 | 378 Disproof of the Exponential Time Hypothesis | Digested. Headline TCS result; Lean. |
| 2 | 103 Derandomization of log space, L = RL = BPL | Digested. Decades-old complexity question; Lean. |
| 3 | 109 Integer multiplication below n log n | Digested. Beats Harvey–van der Hoeven. |
| 4 | 167 Planar unit distances, a power saving | Digested. Erdős unit-distance problem; Lean. |
| 5 | 049 Stable-coordinate counterexample in four variables | Digested. Short counterexample; Lean. |
| 6 | 017 The irrationality exponent of π is 2 | Famous constant; reasoning trace. |
| 7 | 159 Erdős reciprocal-sum conjecture, quasipolynomial Szemerédi | Erdős's prize conjecture on progressions; reasoning trace. |
| 8 | 197 Nonsofic groups and group-ring counterexamples | Kaplansky direct-finiteness in char 2; reasoning trace; Lean. |
| 9 | 287 All nonabelian free group factors are isomorphic | Free group factor problem; reasoning trace. |
| 10 | 362 Global smoothness for relativistic Vlasov–Maxwell | Major PDE regularity; reasoning trace; Lean. |
| 11 | 102 Unique Games Conjecture, optimal approximation thresholds | UGC + direct Max-Cut / Vertex Cover hardness; reasoning trace; Lean. |
| 12 | 007 Two-point Chowla, corrected binary Elliott | Analytic number theory; reasoning trace. |
| 13 | 087 The Mahler conjectures and symplectic width | Convex geometry classic; reasoning trace; Lean. |
| 14 | 221 Mézard–Parisi formula for diluted spin glasses | Statistical physics; reasoning trace. |
| 15 | 271 Bloch's law and spontaneous ferromagnetic order | Quantum Heisenberg magnetization; reasoning trace. |
| 16 | 338 Yau's uniformization conjecture | Flagship differential-geometry conjecture. |
| 17 | 339 Katok's entropy rigidity conjecture | Dynamics/geometry rigidity. |
| 18 | 340 Counterexample to the nearby Lagrangian conjecture | Symplectic topology. |
| 19 | 254 Classifying spaces for Artin groups | Proves the Artin K(π,1) conjecture; Lean. |
| 20 | 193 Serre's intersection-multiplicity conjecture | Commutative algebra, open since the 1960s. |
| 21 | 162 Counterexamples to Ryser's covering conjecture | Combinatorics counterexample; Lean. |
| 22 | 113 FPRAS for perfect matchings in general graphs | TCS counting; Lean. |
| 23 | 003 The quasi-Riemann hypothesis | Zero-free half-plane Re s > 7/8; Lean. |
| 24 | 004 Hilbert's tenth problem over ℚ | Undecidability over the rationals. |
| 25 | 157 Counterexamples to Hadwiger and Colin de Verdière | Graph coloring; Lean. |
| 26 | 158 The plane cannot be colored with five colors | Hadwiger–Nelson progress; Lean. |
| 27 | 032 Rational Hodge conjecture for CM abelian varieties | Named in the README; Lean. |
| 28 | 132 Counterexample to the quadratic sensitivity conjecture | Pairs with the Sensitivity fixture; Lean. |
| 29 | 074 Kakeya in three and four dimensions | Harmonic analysis landmark. |
| 30 | 293 Counterexample to the hyperinvariant-subspace problem | Operator theory classic; Lean. |

Rows 6–30 = 25 careful-profile runs (~$5–25 each) when Kyle starts them from `/admin/papers/new`.

---

## Sprint Breakdown

### Sprint 0: Infra preview of today's main + prod guards [In Progress] — 0.1–0.5 done locally; 0.6–0.8 pending Kyle (outbound)
**Goal:** Prove the Supabase pooler, `prepare: false` and Vercel env wiring on a preview deploy of today's code, with guards that keep dev off prod and prod off PGlite. No data import.
**Estimated effort:** 2 hours (+ waits on Kyle for the connection strings and Vercel auth)

#### Tasks
- 0.1 [server/db/index.ts](../../server/db/index.ts): `postgres(url, { max: 5, prepare: false })` (Supavisor transaction mode has no prepared statements; harmless elsewhere). In `createDb`, when `import.meta.dev` and the URL host isn't `localhost`/`127.0.0.1`, throw unless `ALLOW_REMOTE_DEV_DB=1` (scripts call `createDb` outside Nuxt where `import.meta.dev` is undefined, so they are unaffected). In `useDb()`, when `process.env.VERCEL` is set and there is no `DATABASE_URL`, throw `DATABASE_URL is not set on this deployment` instead of mkdir'ing PGlite.
- 0.2 [server/plugins/runner.ts](../../server/plugins/runner.ts): skip `sweep()`/`drain()` when `dbDriver() === 'postgres'` (open the DB first, then check), so a dev server never fails prod runs.
- 0.3 [nuxt.config.ts](../../nuxt.config.ts) + a tiny `server/utils/appUrl.ts` used where `useRuntimeConfig().public.appUrl` is read server-side ([agentApi.ts](../../server/utils/agentApi.ts) `agentApiDeps`, outline-agent callback): in prod, if it is still the localhost default, fall back to `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`; if that is unset too, `console.error` once.
- 0.4 [server/plugins/operator.ts](../../server/plugins/operator.ts) → boot env report: keep the auth-mode line, and outside dev `console.error` one line per missing `DATABASE_URL`, `OPERATOR_TOKEN`, `AI_GATEWAY_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `AGENT_LOG_SALT`, `NUXT_PUBLIC_APP_URL`. Names only, never values.
- 0.5 `.env.example`: a comment above `DATABASE_URL` — "never set this in .env; run prod commands as `DATABASE_URL='…' npm run …`", and `ALLOW_REMOTE_DEV_DB`.
- 0.6 Supabase (ref `qnsjllrorhxmtfcoqlks`): `DATABASE_URL='<session pooler :5432>' npm run db:migrate` (0000–0003). `.cursor/mcp.json` with the Supabase MCP entry for this ref, shaped like `~/Programming/Workspace/camera_shy/.cursor/mcp.json` (`npx -y @supabase/mcp-server-supabase@latest --project-ref=qnsjllrorhxmtfcoqlks`, `--read-only` by default) with `SUPABASE_ACCESS_TOKEN` taken from the environment, not pasted in the file; if it must be inline, add `.cursor/mcp.json` to `.gitignore`.
- 0.7 Vercel env on **Production and Preview** (`vercel env add` or MCP `create_project_env`; never print values): `DATABASE_URL` (transaction pooler `:6543`), `OPERATOR_TOKEN` (`openssl rand -base64 32`, Kyle keeps it), `SESSION_SECRET`, `AI_GATEWAY_API_KEY`, `AGENT_LOG_SALT`, `CHAT_DAILY_USD=5`, `NUXT_PUBLIC_APP_URL=https://project-gpe.vercel.app`; install the Inngest Vercel integration (sets both Inngest keys, syncs `/api/inngest`). Confirm Fluid compute is on (needed for `maxDuration: 800`).
- 0.8 `vercel deploy` (preview, behind Vercel deployment protection). Check `curl <preview>/api/health` (via `vercel curl` if protected) → `{ db: 'postgres', migrations: 4, gateway: true }`; the runtime log shows the auth-mode line and no missing-env errors; `/` renders (empty library).

#### Verification
- [ ] Preview `/api/health` reports postgres, 4 migrations, gateway true; no runtime errors (MCP `get_runtime_errors`)
- [ ] Locally, a remote `DATABASE_URL` in the shell makes `npm run dev` refuse with the guard message; `ALLOW_REMOTE_DEV_DB=1` lets it through and the boot log shows no sweep
- [x] lint, typecheck, tests green (with the Sprint 1 tree, Nov 1)

**Deviations (Sprint 0):** `server/utils/appUrl.ts` decides "in prod" with `process.env.NODE_ENV === 'production'` (not `import.meta.dev`), so the scripts and tests that load it outside Nuxt behave like dev. The guard-refusal and no-sweep checks above have not been run against a remote URL yet (they need the Supabase strings).

---

### Sprint 1: Catalog data, APIs, public list, agent surface, contracts — Foundational [Complete]
**Goal:** `npm run catalog:sync` fills the catalog at a pinned sha; `/api/v1/families…` serves it; `/api/papers` lists only public digests; the agent API and docs speak the new positioning; every type later sprints need exists.
**Estimated effort:** 5 hours

#### Tasks
- 1.0 Create `~/claude-ops/monument/projects/gpe/STATE.md` from `~/claude-ops/monument/projects/_template/STATE.md` (phase: "OpenAI explorer pivot, Sprint 1", blockers, next 3 actions).
- 1.1 [schema.ts](../../server/db/schema.ts): `families`, `manuscripts`, `catalogMeta`, `papers.manuscriptDir` + index per § Data model; header comment points at this plan for the new tables. `npm run db:generate -- --name catalog` → 0004. `npx drizzle-kit generate --custom --name rls` → 0005 by hand.
- 1.2 `shared/types.ts` (`PaperSummary`, `summary?`), `shared/catalog.ts` (§ API shapes + `familyCode(n)`, `disciplineSlug(name)`), `shared/api.ts` (`PublicPaperItem`, `PaperListItem.public/family`, `PaperResponse.catalog`), `shared/flagship.ts`, `RESERVED_SLUGS` + `admin`, `login`.
- 1.3 `server/catalog/parse.ts` (pure, relative imports): `parseContents`, `parseOverview`, `parseLeanDirs`, `parseReasoningTraces`, `normalizeIndexText`, `publishedOnFromDir`, `validateCatalog` → `{ ok, problems[] }`.
- 1.4 `server/catalog/sync.ts`: `syncCatalog(db, { force?, fetchImpl? })` — resolve sha, fetch, parse, validate, upsert in one transaction (`onConflictDoUpdate` on `number` / `dir`, families first), write `catalog_meta`, never delete, link papers. Returns `{ sha, families, manuscripts, disciplines, lean, stale, linked }`. `server/catalog/query.ts` (pure): `queryFamilies(catalog, q)`, `familyDetail(catalog, n)`, `disciplineList(catalog)`, `catalogStats(catalog)`.
- 1.5 `scripts/sync-catalog.ts` + `"catalog:sync": "tsx --env-file-if-exists=.env scripts/sync-catalog.ts"` (`--force`, `--json`), via `openDb()`.
- 1.6 [agentApi.ts](../../server/utils/agentApi.ts): give `ttlCache` a `clear()`; add `loadCatalog()` (families + manuscripts + `catalog_meta` + public digested papers joined by `manuscript_dir`, cached under one key) and `invalidateCatalog()`; digested entries carry counts, `pages` (`digest.render.pages`), `summary.headline`. Call `invalidateCatalog()` from [public.post.ts](../../server/api/papers/[slug]/public.post.ts) and the sync endpoint.
- 1.7 Routes `server/api/v1/families.get.ts`, `v1/families/[code].get.ts` (`\d{1,3}`, else 404), `v1/disciplines.get.ts` (returns `DisciplinesResponse` with `stats`), each `cache-control: public, max-age=300` and `logAgentRequest` as [v1/papers.get.ts](../../server/api/v1/papers.get.ts). [agentLog.ts](../../server/utils/agentLog.ts) `logAgentRequest`: return early when `sec-fetch-site` is `same-origin` or the `x-gpe-site` header is present (one condition). Pages send `headers: { 'x-gpe-site': '1' }` on these `useFetch` calls, because SSR fetches run in-process with no `sec-fetch-*` headers. `server/api/admin/catalog/sync.post.ts` runs the sync.
- 1.8 **First, before anything else in Sprint 1** (so `main` never breaks and Sprint 2 can start): [papers.get.ts](../../server/api/papers.get.ts) → public list (`public AND digest IS NOT NULL`, dev keeps the toy), `PublicPaperItem[]`, no runs; the old body moves to `server/api/admin/papers.get.ts` (+ `public`, `family`); [app/pages/index.vue](../../app/pages/index.vue) fetches `/api/admin/papers` with `key: 'admin-papers'`; [[node].vue](../../app/pages/[paper]/[node].vue) line 31 retyped to `PublicPaperItem[]`. Caveat: an operator browsing a private paper won't see it in the switcher (acceptable).
- 1.9 [papers/[slug].get.ts](../../server/api/papers/[slug].get.ts): add `catalog` when `manuscript_dir` is set.
- 1.10 Agent surface ([mcpTools.ts](../../server/utils/mcpTools.ts), [agentApi.ts](../../server/utils/agentApi.ts) `listPublicPapers`): `McpPaperRow` gains optional `family?: { number, code, title, discipline }`, `pdf_url?`, `has_lean?`, `headline?`; `LIST_PAPERS_DESCRIPTION` says so; `paperOverview` adds `summary` and `catalog`. `agentGuide`: H1/intro rewritten ("Proof maps of OpenAI's openai/math papers: 373 families catalogued, N digested"), plus the three `/api/v1` catalog endpoints with params. No new MCP tools. [tests/mcp.test.ts](../../tests/mcp.test.ts): guide assertion + `listPaperRows` fixture grow with the shape.
- 1.11 Docs: [README.md](../../README.md) "Agent API" paragraph (new endpoints, row fields, same-site requests not logged) and the Layout tree (`server/catalog/`, `app/pages/admin/`); a 6–8 line "Direction change (Nov 2026)" note at the top of [docs/BRIEF.md](../BRIEF.md) linking this plan.
- 1.12 Tests `tests/catalog.test.ts`, fixtures in `tests/fixtures/catalog/` (3-family CONTENTS excerpt from the real file incl. a multi-member family, a `\n\n` abstract, `<i>`/`<sub>`/`` $`…`$ ``; matching overview lines; a formalization.yaml excerpt with ids after `related_formalizations:` that must be ignored; a README table): parse counts, normalization, validation failure on a mismatched member set, sync into memory PGlite with a fake `fetchImpl`, idempotent second sync, linking from `source_ref`, `queryFamilies` filters/sort, `FLAGSHIP` unique. `logAgentRequest` skip: same-origin / `x-gpe-site` writes no row, a plain request writes one. A case that `GET /api/papers`'s query excludes private papers.

#### Verification
- [x] `npm run catalog:sync` (server stopped): 373 families, 721 manuscripts, 17 disciplines, 138 Lean families; links the five (+ copies); second run changes nothing; every `FLAGSHIP` number resolves
- [x] `/api/v1/families?digested=1` total 5; `?discipline=combinatorics` 37; `/api/v1/families/49` = `/049`, 2 manuscripts, one digested; `/api/v1/disciplines` stats 373/721/17/5
- [x] `curl` to `/api/v1/families` adds an `agent_requests` row; the same request with `sec-fetch-site: same-origin` doesn't
- [x] `/api/papers` has only public digests and no `run` key; `/admin`-to-be library (`/`) still shows runs from `/api/admin/papers`
- [x] `/llms.txt` has the new intro and catalog endpoints; `/api/v1/papers` rows carry `family`
- [x] lint, typecheck, tests green; `npx tsx scripts/sync-catalog.ts --help` runs

Samples: [verification/samples/](verification/samples/) (sync report + second-run JSON, `/api/v1/families`, `/families/049`, `/disciplines`, `/api/papers`, `/llms.txt` head).

**Deviations (Sprint 1):**
- Indexed commit `4eaee87`. Lean manuscripts are **175**, not 176: `lean/formalization.yaml` names one dir CONTENTS.md doesn't list (`Taming-implies-compatibility-on-four-manifolds-September-23-2026`); the sync reports it as a warning and Lean families are still 138.
- `normalizeIndexText` also rewrites repo-relative markdown links (`[Lean](lean/docs/378.md)`) to absolute GitHub URLs, since the text is shown off GitHub.
- `SyncReport` carries more than the plan's fields: `leanManuscripts`, `byDiscipline`, `written` (rows new or changed; 0/0 on a re-sync, which is how idempotency is checked), `warnings`; `linked` is a slug list.
- Upserts only write rows that differ from the DB, so a re-sync of the same commit touches nothing.
- `McpDeps` gains `loadCatalogEntry` (feeds `get_overview`'s `catalog`); `agentGuide` takes optional catalog stats. `listPublicPaperItems` (behind `GET /api/papers`) lives in `agentApi.ts` beside `listPublicPapers`, sharing one SQL query that computes counts without loading digests.
- `has_lean`/`hasLean` on paper rows is the manuscript's Lean status (unit-distance's own manuscript has none, though family 167 does).
- Dev DB: besides the plan's nine, ~18 other papers are public (aletheia-*, erdos-*, alphaevolve-exploration, …), so `/api/papers` lists 28 in dev. Sprint 2.9 should hide whatever isn't one of the five.

---

### Sprint 2: Admin move + API guarding [Complete]
**Goal:** Operator pages live under `/admin` with their own layout; admin read APIs and private papers are operator-only; fixtures hidden in dev; README describes the new split.
**Estimated effort:** 3.5 hours (parallel with Sprint 1 once 1.8 has landed)

#### Tasks
- 2.1 `git mv`: `app/pages/index.vue` → `app/pages/admin/index.vue`; `papers/new.vue` → `admin/papers/new.vue`; `papers/[slug]/run.vue` → `admin/papers/[slug]/run.vue`; `corpus.vue` → `admin/corpus.vue`. Drop new.vue's own `middleware: 'operator'`. New `app/pages/index.vue` placeholder `UPageHero` until Sprint 3. Fix every link: `grep -rn "'/papers\|\`/papers\|\"/papers\|/corpus\|to=\"/\"" app server` — corpus `to="/"` → `/admin` and `loginHref`, new.vue's post-submit `navigateTo`, [PaperReader.vue](../../app/components/reader/PaperReader.vue) line 401, [[node].vue](../../app/pages/[paper]/[node].vue) line 23, [friction.vue](../../app/pages/[paper]/friction.vue) line 18, run-page breadcrumb (line 130 → Admin `/admin`).
- 2.2 `app/pages/admin.vue`: `definePageMeta({ layout: 'admin', middleware: 'operator' })`, template `<NuxtPage />`. `app/layouts/admin.vue`: `UDashboardGroup storage-key="gpe-admin"` → `UDashboardSidebar` (collapsible; `AppLogo` + "admin" `UBadge`; vertical `UNavigationMenu` Papers / New paper / Corpus; footer View site `/`, sign out (logic from today's default layout), `UColorModeButton`) + one `UDashboardPanel` (`UDashboardNavbar` titled from `route.meta.title`, `#body` `<slot />`; moved pages keep their `UContainer`). `useSeoMeta({ robots: 'noindex, nofollow' })` in the layout. [login.vue](../../app/pages/login.vue) line 10: default `next` → `/admin`.
- 2.3 Admin papers table in `admin/index.vue`: `UTable` columns Paper (title + slug), Family (`code` → `/papers/<code>`, else "—"), Tier, State (today's `state()` badge), Nodes, Cost · wallclock, Public (`USwitch` → `POST /api/papers/:slug/public`, toast on error), actions (Open `/<slug>` when digested, Run `/admin/papers/<slug>/run`). Keep the 3 s re-poll. Header actions: New paper, Sync catalog (`POST /api/admin/catalog/sync`, toast with counts).
- 2.4 [operator.ts](../../server/utils/operator.ts): `OPERATOR_READS` + GET/HEAD branch (§ Route table); doc comment. [tests/operator-auth.test.ts](../../tests/operator-auth.test.ts): `GET /api/runs/abc`, `GET /api/corpus` move to guarded; add `GET /api/admin/papers`, `HEAD /api/runs/x`, `GET /api//admin/papers`, `GET /api/%61dmin/papers` guarded; `GET /api/papers`, `/api/papers/eth`, `/api/v1/families`, `/api/blobs/x`, `OPTIONS /api/admin/papers` open.
- 2.5 `canSeePaper(event, row)` in [agentApi.ts](../../server/utils/agentApi.ts) beside `loadPublicDigest`: `row.public || dev toy || await isOperator(event)`. Use it in [papers/[slug].get.ts](../../server/api/papers/[slug].get.ts) (private → the missing-paper 404) and [chat.post.ts](../../server/api/papers/[slug]/chat.post.ts) before streaming.
- 2.6 Undigested paper: in [[node].vue](../../app/pages/[paper]/[node].vue) and [friction.vue](../../app/pages/[paper]/friction.vue) "no digest → run page" becomes operator → `/admin/papers/<slug>/run`, else 404.
- 2.7 SSR cookie forwarding: `useDigest` and `useOperator` use `useFetch` (forwards the request cookie on the server). Grep the moved pages and `[paper]/*` for raw `$fetch` in `setup` during SSR; add `headers: useRequestHeaders(['cookie'])` to any that read private data.
- 2.8 README: rewrite the intro (public explorer of openai/math + operator admin), Status, the "How it works" page list (`/`, `/papers`, `/papers/<code>`, `/<slug>`, `/admin/…`), "To try it" (`/admin/papers/new`, `/admin/corpus`), the Operator auth paragraph (guarded reads, private papers 404); `.env.example` `OPERATOR_TOKEN` comment mentions `/admin`.
- 2.9 Dev data, once (server stopped): `npm run paper:public -- --off pfr sensitivity sunflowers-rao sunflower-alwz`; then `npm run paper:public` lists exactly the five as public. README's public-flag paragraph: the 0003 sentence stays as history plus this line.

#### Verification
- [x] `OPERATOR_TOKEN` set, signed out: `/admin`, `/admin/corpus` → `/login?next=…`; `/papers/new`, `/papers/eth/run`, `/corpus` → 404; `/pfr` → 404; `curl /api/admin/papers`, `/api/corpus`, `/api/runs/<id>` → 401; `/api/papers/pfr` → 404; `/api/papers/eth` → 200
- [x] Signed in: `/admin` table with Family 378/103/109/167/049 for the five, "—" for fixtures; Public switch round-trips on a scratch copy (e.g. `eth-e2e`); Sync catalog toasts 373/721; `/pfr` opens; **hard reload of `/pfr/<node>` while signed in renders server-side** (cookie forwarded), not a 404 flash
- [x] Run page, review queue and corpus page work under `/admin`
- [x] Screenshots `s2_admin_table.webp`, `s2_login_redirect.webp` (+ `s2_admin_table_dark.webp`)
- [x] lint, typecheck, tests green (268)

**Deviations (Sprint 2):**
- 2.9: the dev DB had 27 public papers. Exactly the five (eth, logspace, intmult, unit-distance, noncoordinate) stay public; these 22 were turned off with `npm run paper:public -- --off …` (reverse with the same list and no `--off`): aletheia-erdos aletheia-erdos-1051 aletheia-f26 aletheia-hodge-bundle aletheia-kirby-5-16 alphaevolve-exploration bulk-conductances ehrhart-equality erdos-1196-primitive-sets erdos-728 fel-conjecture khovanov-local-equivalence klt-infinitely-generated macroscopic-scalar-curvature percolation-theta-pc pfr sensitivity sharp-higher-integrability sum-product-disproofs sunflower-alwz sunflowers-rao zeta-simple-zeros. The dev toy fixture still counts as public (`/api/papers` lists it in dev).
- The admin table sorts public papers first (then newest), so the five sit on top as in frame 08. Sync catalog lives in the sidebar and the table toolbar, sharing `app/composables/useCatalogSync.ts`. The toolbar sits in the panel body (the layout owns the navbar).
- `useOperator()` gains `ready` (awaitable), used by `[paper]/index.vue`, `[node].vue` and `friction.vue` so the undigested branch (operator → `/admin/papers/<slug>/run`, else 404) decides during SSR. `[paper]/index.vue` got the same rule though 2.6 didn't name it.
- `canSeePaper(event, row)` takes `{ slug, public }`; the chat route reads the row's `public` itself before `loadDigest`.
- `default.vue` is unchanged (its sign-out button stays until Sprint 3 rewrites the public shell). New/run pages' breadcrumbs start at Admin `/admin`; the corpus page's back button and sign-in link point at `/admin`.
- A `UTable` column with `header: ''` causes a hydration mismatch; the actions column has no `header`.

---

### Sprint 3: Public shell — overlay header, landing, catalog, family pages [Complete]
**Goal:** Frames 01, 02, 03, 07, 09 work at desktop and 390px, light and dark, from live data.
**Estimated effort:** 6 hours

#### Tasks
- 3.1 Hero assets from [hero/gpt-image-2-a.png](hero/gpt-image-2-a.png) (1536×1024): `public/landing/hero.webp` at native width (`cwebp -q 82`; not upscaled) and `public/landing/hero-960.webp` (`cwebp -q 80 -resize 960 0`). `<img srcset="/landing/hero-960.webp 960w, /landing/hero.webp 1536w" sizes="100vw" fetchpriority="high" alt="Oil painting of a scholar at a desk with a compass and globe">`.
- 3.2 [main.css](../../app/assets/css/main.css): `@theme { --font-serif: 'Cormorant Garamond', ui-serif, Georgia, serif; }` (`@nuxt/fonts`, bundled with Nuxt UI, fetches it; weights 500/600). Display headings `font-serif`.
- 3.3 `app/composables/useScrolled.ts`: `useScrolled(threshold = 24)` from `useWindowScroll()` (`@vueuse/core`, explicit import), `false` during SSR.
- 3.4 [default.vue](../../app/layouts/default.vue) → public shell. `UHeader`: `#title` `AppLogo`; `UNavigationMenu` Papers `/papers`, Disciplines `/#disciplines`; `#right` search `UButton` (→ `/papers?focus=1`), `UColorModeButton`, GitHub `UButton` → `https://github.com/openai/math`; sign-out moves to admin. **Overlay deviation:** when `route.meta.headerOverlay`, the header root gets `fixed inset-x-0 top-0 z-50`, and while `!scrolled` `bg-transparent border-transparent` with `text-white` logo/links/icons (`:ui` overrides); once scrolled `bg-default/75 backdrop-blur border-b border-default`, normal colors, `transition-colors duration-200`. Other pages keep the stock sticky header. Mobile menu (`#body`) repeats the nav. `UFooter` (09): "GPE · Papers from github.com/openai/math (Apache-2.0). Digests are model-generated and may be wrong; the PDF is the source of truth." Links `/llms.txt`, `/api/v1/papers`, MCP (`/llms.txt`), "operator" (`/admin`, `text-dimmed`).
- 3.5 Landing `app/pages/index.vue` (01), `definePageMeta({ headerOverlay: true })`; data `/api/papers` + `/api/v1/disciplines` (stats + grid):
  - Hero `section.relative.min-h-[92svh].overflow-hidden`: the `<img>` absolute `object-cover object-[65%_50%]`, `bg-linear-to-r from-black/80 via-black/40 to-transparent` overlay, fallback `bg-[#1d150e]`. Inside, `UPageHero` (left-aligned; `:ui` title `font-serif text-white text-5xl sm:text-7xl text-left`, description `text-white/80`, container padded by `--ui-header-height`), `#headline` "openai/math · 373 results · 17 disciplines" (live), title and description per storyboard, links Browse the papers `/papers` and Start with the ETH disproof → `/eth`.
  - `UPageSection` Featured digests: `UPageGrid` of `UPageCard` (first 3 public papers by flagship rank; "All digested (5) →" `/papers?digested=1`): discipline + Lean badges, title, "Family 378 · 67 pp", `headline` via `NodeMathText` (fallback: family description, 1-line clamp), nodes/novel/sections.
  - `UPageSection` How a paper reads here: three `UPageFeature`s (copy from the storyboard).
  - `UPageSection id="disciplines"`: `UPageGrid` of small `UPageCard`s → `/papers?discipline=<slug>`, "41 families · 3 digested".
- 3.6 Catalog `app/pages/papers/index.vue` (02): `UPageHeader` with live stats; toolbar `UInput` (autofocus on `?focus=1`, 250 ms debounce into `?q=`), `USelectMenu` discipline, `USwitch` Digested, `USwitch` Has Lean, `USelectMenu` sort; all state in the query; `useFetch('/api/v1/families', { query, headers: { 'x-gpe-site': '1' } })`, `limit=50`, Load more appends. `UTable` columns # (`code`), Result (title + one-line description via `NodeMathText`, "featured" `UBadge` for ranked not-yet families), Discipline, Papers, Status (`UBadge` Digested / Lean / Not yet), action (Open map → `/<slug>` when digested; row → `/papers/<code>`). Under `md`, stacked rows instead of horizontal scroll. `UEmpty` + clear-filters.
- 3.7 Family page `app/pages/papers/[code].vue` (03, 07): validate `\d{1,3}`, 301 to the padded code, 404 from the API. `UPageHeader` with `UBreadcrumb` Papers › Discipline › code, badges, title, description. `UPage` + `#right` `UPageAside`. Body: one `UCard` per manuscript (title, date, pdf file, Digested badge, abstract in `UCollapsible` with ~3 lines visible, buttons Read the map, PDF on GitHub, LaTeX source; reasoning-trace link when present). Rail, digested: stats `UCard` + "Open the overview →", Ask box `UChatPrompt` → `navigateTo('/<slug>/<root>?ask=<text>')`. Rail, not yet (07): dashed `UCard` "This paper hasn't been mapped yet", "N of 373 families have a full digest so far…", `UButton` Request a map → `mailto:kyle@monumentlabs.io?subject=Map request: family <code> — <title>`; Lean card with the live Lean-family count.
- 3.8 [app.vue](../../app/app.vue): title "GPE", `titleTemplate` `%s · GPE` / "GPE · OpenAI's math papers, made readable"; description "Browse OpenAI's 721 machine-written math papers. Each digested paper becomes a proof map with plain-English steps, the PDF alongside, and a chat that cites the map."; og title/description to match; `ogImage` absolute: `${useRuntimeConfig().public.appUrl}/landing/hero.webp`. `useSeoMeta` on catalog and family pages.
- 3.9 `public/robots.txt` (`Disallow: /admin`, `/login`, `/api`; `Sitemap: https://project-gpe.vercel.app/sitemap.xml`). `server/routes/sitemap.xml.ts`, hand-rolled from `loadCatalog()`: `/`, `/papers`, every `/papers/<code>`, every public `/<slug>`; absolute via the app URL; `cache-control: public, max-age=3600`.

#### Verification
- [x] Landing 1440×900: header transparent over the painting with legible white text; scroll 100 px → translucent blurred bar (`blur(8px)`, `bg-default/75`); back to top → transparent. Dark mode same. 390px: hero fits, mobile menu works, no horizontal scroll (`scrollWidth` 390 on `/`, `/papers`, `/papers/378`, `/papers/185`)
- [x] Featured cards show the five's real numbers (eth 89 nodes, 5 novel, 67 pp); discipline cards sum to 373
- [x] `/papers`: "kakeya" → 074 (+079, which mentions Kakeya), URL `?q=kakeya`; Digested → 378/103/109/167/049; Has Lean → 138, + Combinatorics → 18; sort by number starts at 001; reload reproduces the view; Load more 50 → 100; `?focus=1` focuses search. Page fetches add no `agent_requests` rows: every browser `/api/v1/*` request carried `x-gpe-site: 1` (checked in the network log; SSR fetches send the same header in code), so `logAgentRequest` skips them (Sprint 1 test covers the skip)
- [x] `/papers/378`, `/papers/49` → 301 `/papers/049` (one "Read the map"), `/papers/185` not-yet rail + `mailto:kyle@monumentlabs.io?subject=Map request: family 185 — …`, `/papers/999` 404; Ask on `/papers/378` → `/eth/thm-main?ask=…`
- [x] `/sitemap.xml` 200 with 380 URLs; `/robots.txt` 200; og:image is `${appUrl}/landing/hero.webp` (absolute; prod gets `NUXT_PUBLIC_APP_URL`)
- [x] Screenshots `s3_landing_top{,_dark}.webp`, `s3_landing_scrolled.webp`, `s3_landing_mobile.webp`, `s3_catalog.webp`, `s3_family_digested.webp`, `s3_family_notyet.webp`
- [x] lint, typecheck, tests green (268)

**Deviations (Sprint 3):**
- Featured cards join `/api/papers` with `/api/v1/families?digested=1` (a third landing fetch) for the description fallback and `pages`; papers without a family (dev toy) are skipped. No date on cards (the list has no `publishedOn`).
- Family rail: `UPageAside` is `hidden` below `lg`, so the rail is a plain sticky `<aside>` in `UPage`'s `#right` (grid 9/3, `order-last` on phones) so the not-yet card, Ask box and Lean card show on mobile.
- Ask box fetches `/api/papers/<slug>` on submit to find `root_ids[0]` (`FamilyDigest` has no root id), then navigates to `/<slug>/<root>?ask=`.
- Index text carries markdown links (`([Lean](…))`); new `app/utils/catalogText.ts` (`indexProse`, `leanDocUrl`, `formatDay`) strips them from prose and puts the `lean/docs/<code>.md` link in the Lean card. One-line titles/descriptions use the existing `inlineMathHtml` (v-html, eslint-disabled per file); abstracts and descriptions use `NodeMathText`.
- The abstract is the `UCollapsible` trigger itself (3-line clamp closed, full open); "Full abstract" shows even when the text fits.
- Header: the mobile menu turns the overlay off while open (its header reuses the title/toggle on a plain background). Section heads are left-aligned (storyboard) via `:ui`.
- Headline copy and request address use the defaults (storyboard line; `kyle@monumentlabs.io`), per Open Questions 1–2.
- Verification ran in fresh Playwright contexts at `http://[::1]:3120`: the shared browser profile has an 80% zoom saved for `localhost:3120`.

---

### Sprint 4: Paper overview, summary, explorer navbar [Complete]
**Goal:** `/<slug>` is frame 04 for all five with a real 3-sentence summary; the explorer navbar has Papers / family / paper crumbs and Overview · Tree · Graph · Paper.
**Estimated effort:** 5 hours

#### Tasks
- 4.1 [aiModels.ts](../../server/utils/aiModels.ts): `summary` in `ModelStep` and each profile (`careful` Opus 5.5, `standard` GPT-6 Sol, `quick` Sonnet 5.5).
- 4.2 `server/pipeline/prompts/summary.md` (raw import, like graph-labels.md): reader is mathematically literate and hasn't read the paper; `headline` ≤ 140 chars stating the result; `proves` exactly three sentences — what is proved (with the key quantity), the one idea, why it matters; inline `$…$` only; nothing beyond the inputs; no hype. `server/pipeline/summary.ts`: zod schema in `shared/schemas.ts`, pure `summaryPrompt(digest, catalog?)` (title; family description + abstract when linked; main theorem `root_ids[0]` statement_paper/plain/explanation; ≤ 8 novel nodes name + headline + statement_plain; section titles), `runSummary(digest, { model, catalog?, runId? })` via `callObject` (`reasoning: 'medium'`, `stage: 'finalize'` when `runId`).
- 4.3 [finalize.ts](../../server/pipeline/stages/finalize.ts): after `buildDigest`, `digest.summary = await runSummary(…)` with `PROFILES[run.profile].summary` and the catalog for `manuscript_dir`. Any failure → `appendEvent(…, 'warn', 'finalize · summary skipped: …')`, digest written without it; never fail the run. (Finalize-only re-runs now cost one short call.)
- 4.4 Backfill `server/api/papers/[slug]/summary.post.ts` on the [labels.post.ts](../../server/api/papers/[slug]/labels.post.ts) pattern (run profile's `summary` model, cost event on the digest's run, patch `papers.digest.summary`, `invalidateCatalog()`, return `{ summary, cost_usd, model }`). Run page [admin/papers/[slug]/run.vue](../../app/pages/admin/papers/[slug]/run.vue): "Write summary" / "Rewrite summary" next to "Regenerate graph labels".
- 4.5 Backfill the five from their run pages (dev server up; ~$0.05–0.30 each). Read each `proves` against the main theorem; rewrite any that overclaims. Paste the five headlines under § Deviations for this sprint.
- 4.6 `app/components/graph/ProofShape.vue`: static thumbnail, not a ProofGraph mode. Props `nodes: ProofNode[]`, `height?`. `graphNodes(nodes, false)`, `graphEdges`, `graphRanks` + dagre (`ranker: 'none'`, fixed 8×8 boxes) → SVG dots (novel = primary fill, main theorem ringed) and thin edges in a fitted `viewBox`; no labels; the whole thing links to `?view=graph`.
- 4.7 `app/components/paper/PaperNavbar.vue`: `UDashboardNavbar` + `UBreadcrumb` (Papers › code + short family title › short paper title › extra crumbs) + `UTabs` Overview · Tree · Graph · Paper (`overview` → `/<slug>`; others → `/<slug>/<selected or root>?view=…`); `#right` slot. Narrow screens hide the first two crumbs and tab labels.
- 4.8 Overview [[paper]/index.vue](../../app/pages/[paper]/index.vue) (04): replace the redirect. `layout: 'dashboard'`, one `UDashboardPanel` with `PaperNavbar` (Ask button → `/<slug>/<root>?ask=`) and a `UContainer` body: `UPageHeader` (badges family, discipline, Lean, "67 pp · Oct 25, 2026"); "What this paper proves" (`summary.proves` via `NodeMathText`; fallback the manuscript abstract, then the main theorem's `statement_plain`, labelled "From the abstract"); Main theorem `UCard` (kind + classification badges, name, label · page, `statement_plain`, `statement_paper` in `NodeMathText`) → `/<slug>/<root>`; "Where the new idea lives · N novel steps" as `UPageCard`s → `/<slug>/<id>`; "Shape of the proof" `ProofShape` + stats; `UPageGrid` of three doors Map (`?view=graph`), Read the paper (`?view=paper&page=1`, hidden without `render`), Ask. Undigested → as 2.6. SEO title/description from the paper and `summary.headline`.
- 4.9 [[node].vue](../../app/pages/[paper]/[node].vue): navbar block (template ~366–451) → `PaperNavbar` with parent › node as extra crumbs and the graph-options popover, chat toggle, More menu in `#right`. `viewTabs` labels Overview/Tree/Graph/Paper ("Node" → "Tree"; `view` values unchanged, so old deep links work). `?ask=<text>` on mount: `chatPref = true`, `chat.input.value = text`, then `setQuery('ask', undefined)`; **no auto-send**. [friction.vue](../../app/pages/[paper]/friction.vue) gets `PaperNavbar` (no active tab).

#### Verification
- [x] `/eth` overview: 3-sentence summary, main theorem, 5 novel steps, shape thumbnail, stats, three doors landing in the right views; `/logspace`, `/intmult`, `/unit-distance`, `/noncoordinate` render cleanly (164 / 95 / 96 / 12 nodes)
- [x] A digest without `summary` (the toy fixture at `/toy`) shows the fallback, no errors
- [x] Explorer: crumbs Papers › 378 … › ETH › Main theorem navigate; tabs switch, Overview returns to `/eth`; legacy `/eth/thm-main?view=graph` works; `/papers/378` Ask → explorer with the chat open and the question prefilled, not sent
- [x] Screenshots `s4_overview_eth{,_dark}.webp`, `s4_overview_mobile.webp`, `s4_explorer_navbar.webp`, `s4_ask_prefill.webp`
- [x] lint, typecheck, tests green (274)

Samples: [verification/samples/summaries.json](verification/samples/summaries.json) (the five summaries + call cost).

**Deviations (Sprint 4):**
- Headlines (backfilled Nov 1; `proves` for each read against the main theorem, none overclaims):
  - eth: For fixed $k$, counts $k$-CNF solutions deterministically in $2^{O_k(n\log\log n/\sqrt{\log n})}$ time, refuting ETH
  - logspace: Deterministic logarithmic space equals randomized logarithmic space: $\mathsf{L}=\mathsf{RL}=\mathsf{BPL}$
  - intmult: Multiplies $n$-bit integers in deterministic time $O(n(\lg n)^{1-\kappa})$, $\kappa=2^{-182}$, on a multitape Turing machine
  - unit-distance: Any $n$ points in the plane determine $O(n^{\beta})$ unit distances for an absolute exponent $\beta<4/3$
  - noncoordinate: An explicit polynomial in four complex variables has affine three-space zero fibre but is not a coordinate
- Prompt tightened once after the first pass (no overclaims, but): logspace's headline ran 147 chars and eth's `proves` 722; noncoordinate used the paper's macros (`\CC`, `\grad`), which don't render where the headline shows without the digest's macros; and sentence 2 leaned on proof-internal symbols ($B$, $S$, $\lambda_{pr}$). `summary.md` now says the limits are hard, standard LaTeX only, and no unexplained symbols. Summary spend for the sprint ≈ $0.35 (three passes over the five, $0.009–0.043 a call; noncoordinate runs `standard` → `openai/gpt-6-sol`). Note: the dev server didn't hot-reload the raw-imported `.md`; touching `summary.ts` did.
- Finalize adds the summary call's cost to `metrics.cost_usd`, `per_stage.finalize` and `calls` (metrics are computed before the call). The skip-on-failure path is `attachSummary` in `finalize.ts` (tested in `tests/summary.test.ts`). The catalog text for the prompt comes from a direct `manuscripts ⋈ families` lookup (`loadSummaryCatalog`), not `loadCatalog()`, so finalize works for private papers.
- `useDigest` also returns `catalog` (from `PaperResponse.catalog`) for the navbar and overview badges.
- Novel-steps list excludes the main theorem (it has its own card); the heading counts every novel node and says "(one is the main theorem)" when it is, so it matches the stats row. Novel cards show `headline` when the graph-labels pass wrote one, else `statement_plain` clamped to two lines (the five digests have no headlines yet).
- ProofShape takes `maxHeight` (keeps its aspect ratio) instead of a fixed `height`; legend "novel / other" + "Open the graph →".
- PaperNavbar shows the `AppLogo` on pages with no sidebar (overview, friction); tab labels show from `md` on the overview and from `2xl` in the explorer (its panel shares the row with the tree and chat). `[node].vue`'s graph-options popover moved into a `#right-start` slot ahead of the tabs.
- Chat check: one turn on `/eth` streamed with thinking on (Sonnet 5.5, 56.8k in / 917 out, 0 cached, $0.151 gateway, node chips rendered).
- The Playwright browser here runs at devicePixelRatio 0.8, so 1440/390 CSS-px checks were taken at 1152/312 viewport px.

---

### Sprint 5: Data import, firewall, promote & smoke [In Progress] — 5.1–5.2 done locally; 5.3–5.8 pending Kyle
> **Note (Nov 1):** 5.2 and 5.4 were done on Supabase by the Supabase-native plan ([../20261101_supabase_native/implementation_plan.md](../20261101_supabase_native/implementation_plan.md), Sprints 1 and 4: MCP `apply_migration`, `catalog:sync` / `papers:import` / `paper:public` as Nitro tasks with the dev server up). No inline `DATABASE_URL` or session pooler anywhere; 5.7's `agent:stats` runs as `npm run agent:stats -- --payload.days=1`; 5.8's pooler text is obsolete (README rewritten there).

**Goal:** `https://project-gpe.vercel.app` serves the public site from Supabase with the catalog synced and the five digests imported and public; admin works behind the token.
**Estimated effort:** 3 hours

#### Tasks
- 5.1 `scripts/export-papers.ts` + `"papers:export"`: `npm run papers:export -- eth logspace intmult unit-distance noncoordinate` (server stopped) → `.data/export/<slug>.json` + `.data/export/blobs/<sha>`. JSON holds the `papers` row (all columns), the `runs` row for `digest.run_id` (`agent_token` null), its `stage_outputs`, `sources`, `source_assets`. Blobs = `source_assets.blob_sha` ∪ every `/api/blobs/<64-hex>` string and `*_sha` field in the digest and stage outputs, written raw. **Fails loudly** unless `chunk` and `outline` outputs exist for `digest.run_id`; if missing there, follows `parent_run_id` and exports that run and its outputs too. Prints rows and MB per paper. Skips `run_events`, `review_items`.
- 5.2 `scripts/import-papers.ts` + `"papers:import"`: `DATABASE_URL='<session pooler>' npm run papers:import -- .data/export/*.json`. Per file one transaction: blobs (sha256 of the file verified against its name, `onConflictDoNothing`) → papers (slug exists → skip with a message) → runs → stage_outputs, sources → source_assets; UUIDs kept. Then link `manuscript_dir`. Logs row counts per table; those counts are the verification.
- 5.3 Vercel Web Analytics, only if it stays one step: `npm i @vercel/analytics`, `<Analytics />` from `@vercel/analytics/nuxt` in [app.vue](../../app/app.vue); Kyle enables it on the project. Else skip and note.
- 5.4 Prod data (session pooler, inline `DATABASE_URL`): `db:migrate` (→ 0005) → `catalog:sync` → `papers:import` → `paper:public` shows exactly the five public. Supabase advisors (MCP `get_advisors` security + performance) clean on security.
- 5.5 Vercel Firewall: one rate-limit rule (e.g. 30 req/min per IP, deny) on `/api/papers/*/chat` and `/api/mcp`, via the dashboard or MCP `put_firewall_config`, **before** promoting. Confirm the rule with Kyle.
- 5.6 Deploy the final commit to preview, smoke it, then (Kyle confirms) promote to production and smoke prod. Update `~/claude-ops/monument/projects/gpe/STATE.md` (live, next 3: flagship runs, name, domain).
- 5.7 Smoke (preview, then prod; Playwright + curl; results into `verification/index.html`):
  - `/api/health` → postgres, 6 migrations, gateway true; no runtime errors in the window
  - `/` hero 200, overlay → blur on scroll; featured cards; `/papers` 373 total, Digested 5, "π" finds 017; `/papers/378`, `/papers/049`, `/papers/185`
  - `/eth` overview; `/eth/thm-main`; legacy `/eth/<node>?view=graph`; `?view=paper` PDF loads with a 206 Range response; a figure image loads
  - One chat turn on `/eth` with node chips
  - Signed out: `/admin` → login; `/papers/new` and `/corpus` → 404; `curl /api/admin/papers` 401; `curl /api/runs/<eth run id>` 401; `/api/papers` = 5 items, no `run`; `/api/papers/pfr` 404
  - Signed in: `/admin` table; Public switch round-trip off/on on `noncoordinate` only if Kyle agrees (prod has no scratch copies), else skip; Sync catalog 373/721
  - Agents: MCP `tools/call list_papers` returns exactly the five slugs; `/api/v1/papers` = the public set; `/agents.md` = `/llms.txt`; `/llms.txt` links are `https://project-gpe.vercel.app/…`; site-originated `/api/v1/families` adds no `agent_requests` row while a curl does (`DATABASE_URL='…' npm run agent:stats -- --days 1`)
  - `/sitemap.xml` 200 with ≥ 379 URLs; `/robots.txt` 200; og:image resolves
  - Every `npm run` command quoted in README exists in `package.json`
- 5.8 README "Deploy (Vercel)": `DATABASE_URL` = transaction pooler (+ `prepare: false`), session pooler for migrate/scripts, never in `.env`; `NUXT_PUBLIC_APP_URL` required; the catalog sync and export/import commands; deploy ordering.

#### Verification
- [ ] Import log counts match the export's per paper; every smoke item passes on prod; `s5_prod_*.webp` in `verification/index.html`
- [ ] Advisors: no RLS-disabled tables; firewall rule active
- [ ] `vercel env ls` shows every required variable on Production and Preview
- [ ] lint, typecheck, tests green on the deployed commit

**Deviations (Sprint 5, local):**
- Export sizes (`.data/export/`, ≈ 8.7 MB total): eth 1.18 MB JSON + 1.67 MB blobs (2); logspace 2.12 + 0; intmult 1.32 + 0; unit-distance 1.17 + 1.17 (4); noncoordinate 0.11 + 0. Each is 1 papers, 1 runs, 8–10 stage_outputs, 1–18 sources, 0 source_assets. Import into a fresh scratch PGlite matched every count and every row field by field; a re-import skips all five by slug; a tampered blob aborts the command with that file unwritten.
- All five digest runs have `parent_run_id` (retries), but retry copies earlier stage outputs forward (`stageOutputs.copyForward`), so chunk and outline live on the digest run and no parent run is exported. The parent walk is implemented anyway. `parent_run_id` is kept as-is on import (no FK), so it names a run that prod doesn't have.
- logspace, intmult and noncoordinate have no `render` output (no compiled PDF, no blobs), in dev as in prod; only eth and unit-distance export PDF/SyncTeX/figure blobs. 5.7's PDF/Range check should use `/eth`.
- Blob metadata (`content_type`, `size`, `created_at`) goes in the JSON's `blobs` array; bytes in `blobs/<sha>`. Import checks sha256 and size of every blob before opening the file's transaction, and checks the slug inside it before any write, so a skipped paper writes no blobs either.
- New `SCRIPT_PGLITE_DIR` (read only by `scripts/db.ts`, which passes it to a new `createDb({ dir })` option) points a script at another PGlite directory, for rehearsing the import locally. Shared file format and timestamp revival in `scripts/exportFormat.ts`.

---

## Environment / Config Changes

> **Superseded (Nov 1):** the `DATABASE_URL` and `ALLOW_REMOTE_DEV_DB` rows below no longer apply; never set `DATABASE_URL`. Set `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY` instead (Vercel and `.env`), per [../20261101_supabase_native/implementation_plan.md](../20261101_supabase_native/implementation_plan.md). `papers:export` was removed after the archive export.

| Variable | Where | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | Vercel | yes | Supabase **transaction pooler** (`:6543`, user `postgres.qnsjllrorhxmtfcoqlks`); driver runs `prepare: false`. |
| `DATABASE_URL` | laptop, inline per command | migrate/scripts | **Session pooler** (`:5432`). Never in `.env`. Unset = dev PGlite. |
| `ALLOW_REMOTE_DEV_DB` | laptop | rarely | Lets `npm run dev` use a non-localhost `DATABASE_URL`. |
| `OPERATOR_TOKEN` | Vercel; dev `.env` for testing | yes in prod | Unlocks `/admin` and guarded APIs; unset in prod = closed. |
| `SESSION_SECRET` | Vercel | recommended | 32+ chars. |
| `AI_GATEWAY_API_KEY` | Vercel | yes | Chat, summaries, runs. Kyle (Nov 1): a dedicated key with a ~$50 budget for public chat. Chat stays Sonnet 5.5 (never Haiku) with thinking on at `reasoning: 'low'` (chat.post.ts). A cold first turn on `/eth` measured $0.15 (56.8k in, 0 cached, 917 out); later turns read the digest from cache. With `CHAT_DAILY_USD=5` the $50 lasts ≥ 10 days at saturation. Open: prod runs share this key, so flagship runs either use a separate key or run locally and import. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Vercel (integration) | yes | Runs in prod. |
| `AGENT_LOG_SALT` | Vercel | recommended | Hashed IPs in `agent_requests`. |
| `CHAT_DAILY_USD` | Vercel | optional | Default 5. |
| `NUXT_PUBLIC_APP_URL` | Vercel | yes | `https://project-gpe.vercel.app`; falls back to `VERCEL_PROJECT_PRODUCTION_URL`. |
| `GITHUB_TOKEN` | Vercel, laptop | optional | GitHub rate limit for sync and fetch. |
| `SANDBOX_TEX_SNAPSHOT_ID` | Vercel | before the first prod run | Render stage. |

New npm scripts: `catalog:sync`, `papers:export`, `papers:import`. New dependency: `@vercel/analytics` (optional). `.cursor/mcp.json` (Supabase MCP, token from env).

---

## Production Safety

Prod is a fresh Supabase database and nothing is deployed, so migration risk is low: 0004 creates tables and a nullable column; 0005 only enables RLS, which changes nothing for the owner role the app uses. The risks are wiring mistakes, which Sprint 0 guards in code: dev refuses a remote DB, the dev runner never sweeps Postgres, Vercel without `DATABASE_URL` fails loudly instead of using an ephemeral PGlite, the app URL can't silently be localhost, and the boot log names missing env vars.

**Pre-promote checklist:** env on Production and Preview; Fluid compute on (`maxDuration: 800`); Inngest Vercel integration installed and synced; the firewall rule on chat + `/api/mcp`; `curl /api/health` → postgres, migrations 6, gateway true; Supabase advisors security-clean; smoke mutates nothing except one chat turn and an agreed public-switch round-trip.

**Ordering:** Sprint 0 preview (migrate 0000–0003, env, guards) → Sprints 1–4 locally → export from dev PGlite → migrate prod to 0005 → catalog sync → import → public check → firewall → preview deploy + smoke → Kyle confirms → production deploy + smoke. Later schema changes: migrate (session pooler) before deploying code that needs them. Rollback: redeploy the previous commit or remove the production alias; the DB is additive, and at worst the Supabase schema is dropped and step "migrate → sync → import" repeated.

---

## Considered and rejected
- **Logging skip on `sec-fetch-site: same-origin` alone.** Verified: Nuxt SSR `useFetch` calls the handler in-process with no `sec-fetch-*` headers, so every server-rendered catalog page would still log a row. Kept the one-line skip and added an `x-gpe-site` header that the pages send.
- **`/api/catalog/*` beside `/api/v1/*`, global admin middleware, `sessionIsOperator`, legacy-admin redirects, `scripts/summarize.ts`, `reusableSummary`, the RLS and export round-trip tests, `shapeLayout` test, `visibility.ts`, per-row `sourceSha`/`syncedAt`, `disciplineId`, `hasSource`, extra reserved slugs, `--replace` on import:** dropped as over-engineering per review.
- **Flagship queue and `new.vue` prefill / "Map this manuscript":** deferred; `shared/flagship.ts`, `sort=flagship` and the admin Family column stay because they're one list, one comparator and one column.
- **Auto-sending `?ask=`:** rejected; a shared link shouldn't spend a model call.
- **ProofGraph thumbnail mode:** rejected; ProofGraph is 860 lines of zoom/pan and needs the digest context.
- **Upscaling the hero to 1920w:** rejected; the source is 1536 wide.
- **Direct Supabase connection:** rejected; IPv6-only without the add-on, and Vercel has no IPv6 egress.
- **Importing the human-written fixtures to prod:** rejected; they stay in dev only.

## What's Deferred / Out of Scope
- Bulk digests and the 25 flagship runs (later, from `/admin/papers/new`); all 721 would be ~$4k–18k at careful prices.
- Naming; `AppLogo` unchanged. Custom domain.
- Request-a-map backend (mailto only); flagship queue UI; new-paper prefill from family pages.
- Lean alignment (v1 Phases 2–3), Lean declaration names on family pages.
- Admin Runs list, Review-queue index, Agent-stats page; MCP tools for families; `/about`; ⌘K search.
- Analytics beyond Vercel Web Analytics; firewall rules beyond the one rule.

## Open Questions
1. **Hero headline copy.** "OpenAI wrote 721 math papers" vs the repo's own framing ("produced by an unnamed internal OpenAI model"). Keep the storyboard line?
2. **Request-a-map address.** `kyle@monumentlabs.io` or a GPE-specific inbox?
