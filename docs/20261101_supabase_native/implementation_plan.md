# Supabase-Native Data Layer — Implementation Plan

> Swap GPE's data layer from Drizzle + postgres-js/PGlite to vanilla Supabase through `@nuxtjs/supabase`, the way Camera Shy and Daylight do it. Routes, pages, API shapes and behaviour do not change.

**Created:** November 1, 2026
**Status:** In Progress (Sprints 1–4 complete Nov 1; Sprint 5 next)
**Context:** GPE (branch `openai-explorer`, large uncommitted tree) finished Sprints 1–4 of [../20261101_openai_explorer/implementation_plan.md](../20261101_openai_explorer/implementation_plan.md) locally on Drizzle with PGlite in dev and a planned Supabase Postgres (`DATABASE_URL`, poolers) in prod. Kyle decided (final) that consistency with his other codebases beats the rewrite cost: Supabase used idiomatically, one database (dev talks to the production project directly), no PGlite, no local Docker stack. The Supabase project exists and is empty: ref `qnsjllrorhxmtfcoqlks` (name `gpe`, us-east-1), URL `https://qnsjllrorhxmtfcoqlks.supabase.co`, no tables, no migrations (checked Nov 1 via MCP `list_tables` / `list_migrations`).

**Goal:** Every server read and write goes through `serverSupabaseServiceRole` from `#supabase/server`; schema lives in numbered SQL migrations applied through the Supabase MCP; database types are generated; blob bytes live in a private Supabase Storage bucket and `/api/blobs/:sha` still serves PDFs with HTTP Range 206; the five public digests (eth, logspace, intmult, unit-distance, noncoordinate) and the openai/math catalog are in Supabase; Drizzle, PGlite, postgres-js and drizzle-kit are gone.

**Scope:** Module install + config, migrations, generated types, Storage bucket, a service-client util, porting the ~44 server DB consumers, the five operator scripts moved into Nitro tasks, the DB-integration tests moved onto a small fake client, data move (catalog sync + import of the five), cleanup, README and `.env.example`. **Not in scope:** Supabase Auth (operator auth stays the sealed-cookie `OPERATOR_TOKEN` flow), Vercel env, deploys, the firewall, any UI change.

---

## Handoff / Execution Notes (read first; this plan is self-contained)

**Repo & runtime.** App root is the repo root (no `src/`). Nuxt 4.6, Node ≥ 22.19, npm. Commands: `npm run dev -- --port 3120` (or `preview_start {name:"digest"}` from [.claude/launch.json](../../.claude/launch.json)), `npm run lint`, `npm run typecheck`, `npm test` (vitest). Read [README.md](../../README.md) once for the pipeline, agent API and operator auth.

**Hard rule from Kyle: the Nuxt module only.** Install with `npx nuxi module add supabase` (adds `@nuxtjs/supabase` to `package.json` and `modules`). Do **not** add `@supabase/supabase-js` as a direct dependency and do not import it, even type-only, in `app/`, `server/`, `shared/` or `scripts/`. Allowed surface: `serverSupabaseServiceRole` (and, if ever needed, `serverSupabaseClient` / `serverSupabaseUser`) from `#supabase/server`; `useSupabaseClient` on the client (not needed here); `Database` from `#supabase/database` (the module's alias for the generated types). For the client type use `type Supa = ReturnType<typeof serverSupabaseServiceRole<Database>>`. This deviates from Camera Shy and Daylight on one point: both import `type { SupabaseClient } from '@supabase/supabase-js'` in server code (e.g. `camera_shy/src/server/utils/storage/supabase.ts:4`), Daylight builds an Inngest client with `createClient` in `ProjectDaylight/src/server/utils/worker-client.ts`, and Camera Shy's `scripts/*.mjs` call `createClient` with the secret key. None of that is allowed here.

**Where the module can't reach, and what replaces it.**
- *Code with no H3 event* (Inngest steps, the LocalRunner's background execution, Nitro plugins). `serverSupabaseServiceRole(event)` uses the event only for `useRuntimeConfig(event)` and to cache the client on `event.context` (see `node_modules/@nuxtjs/supabase/dist/runtime/server/services/serverSupabaseServiceRole.js`). `server/utils/supabase.ts` therefore holds one process-wide client built once from a stub event `{ context: { nitro: {} } }` (Nitro's `useRuntimeConfig` reads `event.context.nitro`; see `node_modules/nitropack/dist/runtime/internal/config.mjs`). Every consumer, with or without an event, calls `useSupabase()`. The service-role client carries no cookies or user, so one instance is safe to share.
- *Operator scripts run by tsx outside Nuxt* (`catalog:sync`, `papers:import`, `paper:public`, `agent:stats`). They become **Nitro tasks** under `server/tasks/` (`nitro.experimental.tasks: true`), run with `npx nuxt task run <name>` against the running dev server (the CLI finds it from the lock file; `--url` overrides). Task HTTP routes exist only in dev, so nothing new is exposed in prod. This **inverts** today's PGlite rule: the dev server must be **up** for these commands. `papers:export` reads PGlite and is used once more (Sprint 4) before it is deleted.

**Conventions to mirror (file pointers).**
- Module block: `camera_shy/src/nuxt.config.ts` lines 131–156 and `~/claude-ops/conventions/supabase_auth.md` § 1. GPE takes `url` / `key` / `secretKey` / `redirect: false` / `build.transpile` and **none** of the auth pieces (no `redirectOptions` paths that collide with GPE's own `/login`, no auth plugins, no middleware). `redirect: false` is mandatory: the module defaults to `true` and would bounce every page to `/login`.
- Env names: `SUPABASE_URL`, `SUPABASE_KEY` (publishable, `sb_publishable_…`), `SUPABASE_SECRET_KEY` (`sb_secret_…`), exactly as `camera_shy/src/.env.example` and `ProjectDaylight/src/.env.example`. The module also reads `SUPABASE_SECRET_KEY` directly (`dist/module.mjs` line 20).
- Migrations: **`db_migrations/NNNN_snake_case.sql` at the repo root, forward-only, idempotent, applied in order with Supabase MCP `apply_migration`, never by the app** (`camera_shy/db_migrations/README.md`; Daylight has 95 files in `ProjectDaylight/db_migrations/` and an unused `supabase/.temp`). Neither app uses a `supabase/migrations/` folder or `supabase db push` (see Open Question 1). Run MCP `get_advisors` (security + performance) after every migration (`~/claude-ops/conventions/project_bootstrap.md` § "proven decisions").
- Types: MCP `generate_typescript_types` → `app/types/database.types.ts`, the module's default `types` path (`~/types/database.types.ts`), same file as `camera_shy/src/app/types/database.types.ts` and `ProjectDaylight/src/app/types/database.types.ts`. Regenerate after every migration. If ESLint's stylistic rules flag the generated file, add it to the ignores in [eslint.config.mjs](../../eslint.config.mjs).
- Storage + Range: Camera Shy's `SupabaseSessionStore.openArtifactRead` (`camera_shy/src/server/utils/storage/supabase.ts` ~lines 450–480): `createSignedUrl(path, 60)`, then `fetch` with the `Range` header passed through, `Readable.fromWeb(body)`, and `sendStream` with 206 + `Content-Range` (`camera_shy/src/server/utils/serveArtifact.ts`). Uploads `upload(path, bytes, { contentType, upsert })`.
- Tests: Daylight unit-tests DB code with hand-rolled chainable stubs (`ProjectDaylight/src/server/__tests__/utils/cases.test.ts` `makeStub()`), never a live DB; Camera Shy has no unit tests. GPE generalizes the Daylight stub into one shared fake (Sprint 1.9).
- Code style (unchanged): ESLint stylistic, no trailing commas, 1tbs; TypeScript strict; short why-comments; `#shared/*` for shared types.

**Env.** `.env` (Kyle, before Sprint 1):
```
SUPABASE_URL=https://qnsjllrorhxmtfcoqlks.supabase.co
SUPABASE_KEY=sb_publishable_Yp4cv215Wjc5HBKnPWKrOg_kQnTXv61
SUPABASE_SECRET_KEY=<Kyle pastes: Supabase dashboard → Project Settings → API Keys → Secret keys>
```
The secret key can't be read through MCP (only publishable keys are). **Kyle pastes it into `.env` himself**, and later into Vercel (not authorized yet). Once it is in `.env`, `npm run dev` reads and writes production data. That is the decision, not an accident.

**Contracts (fixed by Sprint 1; change this section first if a later sprint must).**
- `server/utils/supabase.ts`: `useSupabase(): Supa`, `setSupabase(client)` (test seam, same role as today's `setDb`), `must<T>(res): T` (unwraps `{ data, error }`, throws an `Error` whose message leads with PostgREST's `message`/`code`), `selectAll(build: (from, to) => query)` (pages with `.range()` past the 1000-row cap), `BLOB_BUCKET = 'blobs'`. As built: `must` also sets `err.code` (PostgREST code, e.g. `23505`) on the thrown Error so routes can map it; Storage errors (no `code`) go through `must` too. `selectAll` needs a unique `.order()` in `build`. Tests: `setSupabase(createFakeSupabase(seed).client)` from `tests/helpers/fakeSupabase.ts`.
- `server/utils/rows.ts`: `PaperRow`, `RunRow`, `RunEventRow`, `ReviewItemRow`, `FamilyRow`, `ManuscriptRow`, `StageOutputRow`, `SourceRow`, `SourceAssetRow`, `BlobMeta` with the **same camelCase field names and types as today's Drizzle `$inferSelect`** (timestamps as `Date`, `numeric` as `number`, jsonb typed with the `#shared` types), plus `paperRow(dbRow)`-style mappers (snake → camel, ISO string → `Date`, `Number()` on numerics). Every API keeps returning exactly the JSON it returns today (`Date` still serializes via `toISOString()`).
- Exported signatures of `blobStore`, `blobUrl`, `stageOutputs`, `createRun`/`getRun`/`appendEvent`/`setStage`/`setStatus`/`addCost`/`patchProgress`/`bumpProgress`/`getRunView`, `storeSources`/`replaceAssets`/`loadAssets`, `syncCatalog`/`linkPapers`, `loadDigest`/`loadFigureImage`/`loadChatSources`, and the agentApi loaders **do not change** except that the `db` parameter disappears where one exists (`syncCatalog(opts)`, `linkPapers()`, `agentRequestStats(opts)`). `blobStore` gains `stream(sha, range?)`; `range()` goes.
- Blob URLs stay `/api/blobs/<sha>`; nothing in stored digests or stage outputs is rewritten.

**Execution order.**
- **Sprint 1** first, alone (module, config, migrations, types, bucket, utils, fake). Applying its migrations to Supabase is the first outbound step: confirm with Kyle once, then apply all four.
- **Sprints 2 and 3 in parallel** after 1. File ownership is disjoint: Sprint 2 owns `server/pipeline/**`, `server/utils/{runs,stageOutputs,sourceStore,blobs,dispatch}.ts`, `server/plugins/runner.ts`, `server/api/blobs/**` and tests `runner`, `inngest-runner`, `outline-agent`, `extract`, `figure-vision`. Sprint 3 owns every other `server/api/**` route, `server/utils/{agentApi,agentLog,agentStats,digests,chatSources}.ts`, `server/catalog/**`, `server/plugins/operator.ts`, `server/routes/**` and tests `agent-api`, `catalog`. `server/utils/{supabase,rows}.ts` are frozen after Sprint 1; a needed change goes into this plan's Contracts first and is made by whoever needs it, announced to the other sprint.
- **Sprint 4** (tasks + data move) after 2 and 3: it needs the ported import path and a dev server that runs on Supabase. Writing data to Supabase is the second outbound step: confirm with Kyle before the import.
- **Sprint 5** (cleanup) last. It deletes files from an uncommitted tree (see Open Question 2).

**Per-sprint loop.** Announce → execute (a subagent gets this plan, its sprint and these notes) → `npm run lint && npm run typecheck && npm test` → browser check against `http://localhost:3120` (Playwright MCP or the in-app browser) → update this file (status badge, deviations) → report.

**Commit/push policy.** Don't commit or push. Never commit `.env`, `.data/`, a Supabase access token or the secret key.

**Outbound steps and who confirms.**

| Step | Sprint | Status |
|---|---|---|
| Apply `db_migrations/0001–0004` to `qnsjllrorhxmtfcoqlks` (MCP `apply_migration`) | 1 | Done Nov 1 (Kyle authorized via the orchestrator) |
| Write data: catalog sync + import of the five digests and their blobs | 4 | Done Nov 1 (Kyle authorized via the orchestrator) |
| Rollback-wrapped RPC checks via MCP `execute_sql` (`begin … rollback`) | 1 | covered by the Sprint 1 confirmation |
| Vercel env (`SUPABASE_*`, removing `DATABASE_URL`), preview/prod deploy, firewall | n/a | **Not authorized.** Stays in the openai_explorer plan's Sprints 0 and 5 |

---

## Current State

### What exists
- **Driver seam:** [server/db/index.ts](../../server/db/index.ts) (`useDb`, `createDb({ url | memory | dir })`, `setDb`, `dbDriver`, `appliedMigrations`), PGlite at `.data/pg/` (200 MB, ~42 papers: the five digests, human-written fixtures pfr/sensitivity/sunflowers-rao/sunflower-alwz, `-agent`/`-e2e` copies, corpus runs) or postgres-js on `DATABASE_URL`. Sprint 0 guards: remote-URL refusal in dev, `VERCEL` without `DATABASE_URL` throws, runner skips the boot sweep on Postgres.
- **Schema:** [server/db/schema.ts](../../server/db/schema.ts), drizzle-kit migrations `server/db/migrations/0000–0005` (`papers`, `sources`, `runs`, `run_events`, `stage_outputs`, `review_items`, `blobs` with a `bytea data` column, `source_assets`, `agent_requests`, `families`, `manuscripts`, `catalog_meta`; 0003 sets nine public flags; 0005 enables RLS on all twelve).
- **Consumers (44 server files):** `server/utils/{runs,stageOutputs,sourceStore,blobs,digests,chatSources,agentApi,agentLog,agentStats}.ts`, `server/catalog/{sync,query}.ts`, `server/pipeline/{runner,summary}.ts`, all 14 files in `server/pipeline/stages/`, `server/plugins/runner.ts`, and 15 routes (`papers.post`, `papers/[slug].get`, `papers/[slug]/{chat,labels,public,summary}.post`, `runs/[id].get`, `runs/[id]/{retry,review}.post`, `admin/papers.get`, `admin/catalog/sync.post`, `corpus.get`, `corpus/[slug]/ingest.post`, `health.get`, `blobs/[sha].get`).
- **SQL beyond CRUD:** atomic `cost_usd + x`, `progress || patch`, `jsonb_set` counter (`server/utils/runs.ts` 63–84); `ingestTrace`'s `FOR UPDATE` high-water claim (`server/pipeline/stages/outline-agent.ts` 131–148); jsonb counts over `digest->'nodes'` and joins to the catalog (`server/utils/agentApi.ts` 53–82, 136–146); `count(distinct)` / `filter` / `group by` readout (`server/utils/agentStats.ts`); `count(*)` (`finalize.ts` 213); `bytea` `substring()` for ranges (`server/utils/blobs.ts`).
- **Transactions (3 files):** `server/catalog/sync.ts:121` (diff + upsert families, manuscripts, catalog_meta, link papers), `server/utils/sourceStore.ts:25,38` (delete + insert a paper's `sources` / `source_assets`), `scripts/import-papers.ts:39` (one transaction per exported paper).
- **Blobs:** content-addressed bytea; written by `render.ts` (PDF, SyncTeX gz, figure PNGs) and `sourceStore.replaceAssets`; read by `figures.ts`, `sourceStore.loadAssets`, `digests.loadFigureImage` (≤ 3 MB images for chat) and `GET /api/blobs/:sha` (ETag, immutable cache, 304, single-range 206, 416).
- **Runner:** `LocalRunner` in dev (one run at a time, DB-wide "anything running?" check, boot `sweep()` + `drain()`); Inngest in prod (`server/pipeline/runners/inngest.ts`, no direct DB). Both append `run_events` per step and write `stage_outputs` per stage.
- **Agent API:** `ttlCache` (60 s, 16 entries) for digests, sources, catalog; `agent_requests` written fire-and-forget via `waitUntil` (`server/utils/agentLog.ts` 104–148). Chat limits are in memory (`server/utils/chatLimits.ts`), no DB.
- **Scripts (tsx):** `scripts/{db,agent-stats,set-public,sync-catalog,export-papers,exportFormat,import-papers}.ts`. `.data/export/` already holds the five (8.8 MB: JSON + 6 blobs; eth and unit-distance have PDFs/figures, the other three have no render).
- **Tests:** ~274 vitest tests in 24 files; 7 files open in-memory PGlite (`createDb({ memory: true })` + `setDb`): `agent-api`, `catalog`, `extract`, `figure-vision`, `inngest-runner`, `outline-agent`, `runner`.

### What changes
- `@nuxtjs/supabase` replaces `drizzle-orm`, `@electric-sql/pglite`, `postgres`, `drizzle-kit`. `db_migrations/0001–0004` replace `server/db/migrations/`. `app/types/database.types.ts` and `server/utils/rows.ts` replace `schema.ts`. `server/utils/supabase.ts` replaces `server/db/index.ts`.
- Blob bytes move to the private Storage bucket `blobs` (object key = sha); the `blobs` table keeps `sha, content_type, size, created_at` so `source_assets.blob_sha` keeps its FK and `meta()` stays one indexed read.
- `LocalRunner` serializes per process, not per database, and the dev boot sweep/drain goes (dev now shares prod's `runs`).
- Operator scripts become Nitro tasks; `npm run` names stay, now wrapping `nuxt task run` (dev server up).
- `GET /api/health` keeps its keys; values become `db: 'supabase'`, `migrations: <applied count>`.

### What stays
- Every page, route, API response shape, the pipeline and stages' behaviour, Inngest, the reader/tree/graph/chat, chat limits, agent tools, operator auth, the public/private rules, caching TTLs. `.data/pg/` stays on disk untouched as an archive.

---

## Architecture

```
Nitro (routes · Inngest steps · LocalRunner · tasks)
   └─ useSupabase()  ── serverSupabaseServiceRole(stub event), one per process (server/utils/supabase.ts)
         ├─ PostgREST  → public.* tables (RLS on, no policies; service role bypasses)
         │               + view paper_digest_stats, RPCs for atomic run counters and the stats readout
         └─ Storage    → private bucket "blobs" (<sha>) ← /api/blobs/:sha streams via 60-s signed URL + Range
Browser → Nitro only (no anon-key reads)
```

**RLS / reads decision: all reads stay server-side on the service-role key; RLS is on for every table with no policies; the anon key is configured (the module requires it) but grants nothing.** Kyle's apps read through `serverSupabaseClient` + RLS because their rows belong to Supabase Auth users (`camera_shy/src/server/utils/storage/index.ts` `requestContext`). GPE has no Supabase users: visibility is `papers.public` or the operator cookie (`canSeePaper`), and public reads must pass through the agent-request logging, the TTL caches and the chat limits. Anon reads through RLS policies would bypass all three and duplicate the visibility rule in SQL. Camera Shy uses the service role the same way for server-authoritative writes (`camera_shy/src/server/utils/analytics.ts` header comment). Storage bucket `blobs` is private with no storage policies. Expect the advisor's INFO-level `rls_enabled_no_policy` findings; they are the intended state.

**Transactions decision.** No multi-statement transactions. Each former transaction becomes idempotent ordered writes; RPCs only where concurrent writers would otherwise lose updates:

| Former transaction / SQL | Supabase-native replacement | Why that is enough |
|---|---|---|
| `storeSources` / `replaceAssets` (delete then insert) | Insert the new rows, then delete the paper's rows whose `id` is not in the new set | No moment with zero sources; the only reader during a fetch is the same run. A crash leaves extra rows that the next fetch removes. |
| Catalog sync | Upsert `families` (onConflict `number`), then `manuscripts` (onConflict `dir`, chunks of 500), then `catalog_meta`, then `linkPapers()` | Each step is idempotent and FK-ordered; a failed sync re-run converges. Stale rows were never deleted anyway. |
| Import of one exported paper | Upload blobs → upsert `blobs` meta (ignoreDuplicates) → upsert `papers` by id → `runs` (ancestors first) → `stage_outputs` (onConflict `run_id,stage`) → `sources` → `source_assets`, all by primary key, ignoreDuplicates; then `linkPapers()` | Re-running finishes a partial import. A slug that exists under a **different** id is skipped with a message (today's "slug exists → skip"). |
| LocalRunner `claim` | `update({status:'running'}).eq('id').eq('status','queued').select('id')` inside the existing in-process `exclusive()` lock | Conditional update is atomic in one statement. |
| Review decision, papers.post slug check | Conditional update `.is('decision', null)`; unique constraint on `slug` (23505 → today's 409) | One statement each. |
| `addCost` | RPC `add_run_cost(run_id, usd)` | Parallel fan-out steps (annotate/classify batches, Inngest parallel steps) increment concurrently; read-modify-write loses spend and breaks the budget checkpoint. |
| `patchProgress` | RPC `patch_run_progress(run_id, patch jsonb)` (`progress = progress || patch`) | The agent callback, the poll step and stages write different keys at once; a client-side merge clobbers keys. |
| `bumpProgress` | RPC `bump_run_progress(run_id, key, by)` | Counters bumped by parallel fan-out. |
| `ingestTrace` high-water claim | RPC `claim_agent_trace(run_id, max_seq, max_cost)` returning previous `seq`/`cost` (`FOR UPDATE` inside) | Callback and polling deliver the same trace lines concurrently; each line must be logged once and each dollar added once. |

Read-side SQL that PostgREST can't express (aggregates are off by default, and a client-side aggregate would hit the 1000-row cap): view `paper_digest_stats` (per-paper `nodes`, `sections`, `novel`, `friction`, `pages`, `headline` computed from `digest`, so list pages never download 1–2 MB digests), RPC `agent_request_stats(days)` returning the readout as jsonb, RPC `applied_migration_count()` reading `supabase_migrations.schema_migrations` (not exposed over the Data API) for `/api/health`.

---

## Sprint Breakdown

### Sprint 1: Module, schema, types, bucket, service client, test fake (foundational) [Complete]
**Goal:** The module is installed and configured, the Supabase project has the full schema, RPCs, view and bucket, types are generated, and `useSupabase()` / row mappers / the test fake exist. No consumer is ported yet; the app still runs on Drizzle.
**Estimated effort:** 4 hours

#### Tasks
- 1.1 `npx nuxi module add supabase`. Confirm `package.json` gains only `@nuxtjs/supabase` (no direct `@supabase/supabase-js`).
- 1.2 [nuxt.config.ts](../../nuxt.config.ts): add the module's block `supabase: { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY, secretKey: process.env.SUPABASE_SECRET_KEY, redirect: false }` (types path left at the default), the `build.transpile` list from `supabase_auth.md` § 1, and `nitro.experimental.tasks: true`. Update the runtimeConfig comment (no more `DATABASE_URL`).
- 1.3 `db_migrations/README.md` (copy Camera Shy's wording: forward-only, idempotent, MCP `apply_migration`, regenerate types after). Then:
  - `0001_initial_schema.sql`: the twelve tables, FKs, indexes and defaults exactly as today's 0000–0004 (same names, `text[]`, `jsonb`, `numeric`, `timestamptz`, `bigserial`), except `blobs` has no `data` column. `create table if not exists` / `create index if not exists`. `alter table … enable row level security` on all twelve. No public-flag seed (0003 was for dev rows; the import carries `public`).
  - `0002_storage_blobs.sql`: `insert into storage.buckets (id, name, public, file_size_limit) values ('blobs', 'blobs', false, 52428800) on conflict (id) do nothing` (precedent: `ProjectDaylight/db_migrations/0003_storage_setup.sql`).
  - `0003_run_rpcs.sql`: `add_run_cost`, `patch_run_progress`, `bump_run_progress`, `claim_agent_trace` (SQL lifted from `runs.ts` 63–84 and `outline-agent.ts` 138–147). `language sql` or `plpgsql`, `set search_path = ''`, schema-qualified names, `revoke execute … from public, anon, authenticated; grant execute … to service_role`.
  - `0004_read_views.sql`: view `public.paper_digest_stats` `with (security_invoker = true)` (columns `id, slug, title, authors, source_ref, public, manuscript_dir, created_at, updated_at, has_digest, nodes, sections, novel, friction, pages, headline`, expressions from `agentApi.ts` 53–57, 72–73), `revoke all … from anon, authenticated`; `agent_request_stats(p_days int) returns jsonb` (the readout from `agentStats.ts`, `{ since, total, byDay, bySurface, byClient, byTool, byPaper, byRef }`); `applied_migration_count() returns int` (`security definer`, `search_path = ''`, service_role only).
- 1.4 **Outbound (Kyle confirms):** MCP `apply_migration` for 0001–0004 in order on `qnsjllrorhxmtfcoqlks`; `list_migrations` shows four; `get_advisors` security + performance: fix every WARN (function search_path, view security), accept INFO `rls_enabled_no_policy`.
- 1.5 RPC checks (MCP `execute_sql`, each wrapped in `begin; … rollback;`): insert a paper + run, call `add_run_cost` twice and `patch_run_progress` with two keys and `bump_run_progress`, `claim_agent_trace` twice (second returns the first's maxima), select back; `select * from paper_digest_stats` returns no rows; `agent_request_stats(30)` returns zero totals. Paste results into Deviations.
- 1.6 MCP `generate_typescript_types` → `app/types/database.types.ts`.
- 1.7 `server/utils/supabase.ts` (Contracts): `useSupabase()` (lazy, memoized `serverSupabaseServiceRole<Database>({ context: { nitro: {} } } as unknown as H3Event)`, with a comment on why the stub event is safe), `setSupabase`, `must`, `selectAll`, `BLOB_BUCKET`. `import type { Database } from '#supabase/database'`.
- 1.8 `server/utils/rows.ts`: the row types and mappers (Contracts). Types are hand-written to match today's `schema.ts` `$inferSelect` field for field, so typecheck catches any drift in consumers.
- 1.9 Tests infra: `tests/helpers/fakeSupabase.ts` (≤ 200 lines): in-memory tables; `from(t)` with `select(cols)` (`*`, column lists, `alias:col`), `insert`, `upsert({ onConflict, ignoreDuplicates })`, `update`, `delete`, filters `eq/neq/in/is/not('x','is',null)/gte/lt`, `order`, `limit`, `range`, `single`, `maybeSingle`, `.select()` after writes; `paper_digest_stats` computed from `papers` in JS; `rpc(name, args)` dispatching to JS twins of the four run RPCs; `storage.from(b)` with `upload/download/info/createSignedUrl` over a `Map` (signed URL served by a stubbed `fetch` that honours `Range`). [vitest.config.ts](../../vitest.config.ts): aliases `#supabase/server` → `tests/helpers/supabaseServerStub.ts` (throws "tests must inject a fake via setSupabase") and `#supabase/database` → `app/types/database.types.ts`. That stub is the guarantee that **tests never reach prod**.
- 1.10 `.env.example`: the three `SUPABASE_*` lines with Camera Shy's comment ("URL + publishable key are safe client-side; the secret key is server-only"), plus "dev talks to the production project; there is one database". Remove the `DATABASE_URL` / `ALLOW_REMOTE_DEV_DB` block in Sprint 5, not now (the Drizzle path still runs).

#### Verification
- [x] `npm ls @supabase/supabase-js` shows it only under `@nuxtjs/supabase`; `grep -rn "@supabase/supabase-js" app server shared scripts tests` is empty
- [x] Four migrations applied; advisors have no WARN; ~~RPC checks pass~~ (write-side checks not run, see Deviations) and no rows (`select count(*) from runs` = 0)
- [x] `npm run dev` boots with no module warnings about URL/key; `/` and `/eth` still render (still on PGlite)
- [x] lint, typecheck, tests green (nothing ported yet, so all ~274 pass) — 279 in 25 files (274 + 5 new in `tests/supabase.test.ts`)

#### Deviations (Sprint 1)
- **Module version.** `nuxi module add` installed `@nuxtjs/supabase` **2.1.0** (not 2.0.9); `serverSupabaseServiceRole.js` is unchanged (event used only for `useRuntimeConfig(event)` + `event.context` cache). Pinned `~2.1.0` per Risks.
- **h3 pinned at the root (`"h3": "~1.15.11"`, a direct dependency).** The root `node_modules/h3` was **v2** (hoisted for `inngest`'s `>=1.8.1` peer and `@nuxt/eslint`'s devframe), while Nitro runs h3 v1. `@nuxtjs/supabase` doesn't declare h3 and resolved the root v2, so its SSR plugin threw `event.req.headers.get is not a function` as an unhandled rejection on **every page render**. Pinning the root to Nitro's v1 fixed it (inngest now dedupes to v1; it serves via `inngest/edge`, unaffected). `tests/catalog.test.ts` and `tests/operator-session.test.ts` imported `node_modules/@nuxt/nitro-server/node_modules/h3/...` (no longer nested) and now import `'h3'` — a one-line change in each; Sprint 3 owns `catalog.test.ts` from here.
- **`alias['#supabase/database']` in nuxt.config.** The module maps it only for Nitro and the server tsconfig; the app tsconfig also compiles `server/utils/*` via Nitro's generated auto-import/route types and failed typecheck. Same target file.
- **Schema additions over Drizzle (0001):** btree indexes on `runs.paper_id`, `run_events(run_id, id)`, `review_items.run_id`, `sources.paper_id`, `source_assets.blob_sha`. FK names are Postgres defaults (`runs_paper_id_fkey`), not Drizzle's.
- **`paper_digest_stats` also carries `title, authors, source_ref`** (so `publicDigestRows` is one view read plus the cached catalog, no second papers read). Contract for Sprint 3.
- **`rows.ts` extras:** `DbRow<'t'>` / `DbInsert<'t'>` helpers, `AgentSurface` (moved from schema.ts), `CatalogMetaRow`, `AgentRequestRow` and a mapper for every table (`paperRow, runRow, runEventRow, stageOutputRow, reviewItemRow, sourceRow, sourceAssetRow, blobMeta, familyRow, manuscriptRow, catalogMetaRow, agentRequestRow`).
- **Fake shape:** `createFakeSupabase(seed?)` returns `{ client, tables, objects, rpcs, fetchStub }`; inject with `setSupabase(fake.client)`. `fetchStub(fallback?)` serves signed URLs with Range and defers other URLs (stub it with `vi.stubGlobal('fetch', fake.fetchStub())`). Defaults, PK/unique (`papers.slug` → 23505) and `PGRST116` on `single()` are modelled. ~290 lines, not ≤ 200. `rpcs` also has `applied_migration_count` (→ 4); `agent_request_stats` is not faked (add a twin if a test needs it).
- **1.5 RPC checks: write-side not run.** The rolled-back `do $$ … raise exception $$` block (insert paper + run, the four RPCs, read back) was **refused by the session's permission classifier** for `execute_sql` writes, even rolled back. Run instead, read-only: `paper_digest_stats` = 0 rows; `agent_request_stats(30)` = `{ total: { requests: 0, callers: 0, errors: 0 }, byDay: [], … }`; `applied_migration_count()` = 4; `runs` = 0; bucket `blobs` private, 50 MB limit; anon has no execute on `add_run_cost` and no select on the view. Over REST with the publishable key: `papers` → `[]` (RLS), view and RPC → 42501. The RPC semantics are covered by the fake's JS twins in `tests/supabase.test.ts`; the SQL itself is first exercised by Sprint 2's real ingest (verify cost and progress there), or Kyle can allow the rolled-back check.
- **Service-client smoke (secret key present).** A temporary Nitro task `supabase:smoke` (deleted after) ran `useSupabase()` from a task (no H3 event) against the dev server: `papers` head count 0, view 0 rows, `applied_migration_count` 4, `agent_request_stats` zero totals, `storage.from('blobs').list()` ok with 0 objects. `nuxt task run` works with `nitro.experimental.tasks`.
- **Advisors after 0004:** security = 12× INFO `rls_enabled_no_policy` (intended); performance = INFO `unused_index` ×10 (empty tables) and INFO `auth_db_connections_absolute`. No WARN.
- **Migrations recorded:** `0001_initial_schema` (20261101190447), `0002_storage_blobs` (…448), `0003_run_rpcs` (…515), `0004_read_views` (…516).
- `.env` gained `SUPABASE_URL` and `SUPABASE_KEY` (publishable); Kyle added `SUPABASE_SECRET_KEY`.

---

### Sprint 2: Port the write path: runs, stage outputs, sources, blobs on Storage, runner, stages [Complete]
**Goal:** Every pipeline write and read, the runner and `/api/blobs/:sha` run on `useSupabase()`; a full local ingest of a small paper succeeds against Supabase.
**Estimated effort:** 5 hours (parallel with Sprint 3)

#### Tasks
- 2.1 [server/utils/runs.ts](../../server/utils/runs.ts): CRUD via `useSupabase()` + `rows.ts` mappers; `addCost` / `patchProgress` / `bumpProgress` call the RPCs; `getRunView` keeps "last 200 events newest-first then reversed" and pending review items ordered by id. Timestamps written as `new Date().toISOString()`.
- 2.2 [server/utils/stageOutputs.ts](../../server/utils/stageOutputs.ts): `put` = upsert onConflict `run_id,stage` with `created_at` refreshed; `copyForward` = select parent rows `in('stage', …)` then upsert `ignoreDuplicates`. Keep `jsonbSafe` (PostgREST rejects `\u0000` the same way).
- 2.3 [server/utils/blobs.ts](../../server/utils/blobs.ts): `put` = `storage.from('blobs').upload(sha, bytes, { contentType, upsert: false, cacheControl: '31536000' })`, treating "already exists" as success, **then** upsert the `blobs` meta row `ignoreDuplicates` (so a meta row always has bytes behind it); `meta` = one row read; `get` = meta + `download` → `Uint8Array`; new `stream(sha, range?)` = Camera Shy's signed-URL + `Range` fetch returning a Node `Readable`. Remove `range()`. Comment header rewritten (no "transactional with the rest").
- 2.4 [server/api/blobs/[sha].get.ts](../../server/api/blobs/[sha].get.ts): same headers, 304, 416 and 206 logic; body via `sendStream(event, await blobStore.stream(sha, { start, end }))` with `Content-Length` set from the range, and the full response streamed the same way (no whole-file buffer).
- 2.5 [server/utils/sourceStore.ts](../../server/utils/sourceStore.ts): insert-new-then-delete-old (table above) for `sources` and `source_assets`; `loadAssets` reads via `blobStore.get`.
- 2.6 [server/pipeline/runner.ts](../../server/pipeline/runner.ts): `claim` / `claimQueued` / `drain` on Supabase. **Dev-shares-prod fix:** the "is anything running?" check and `drain()` consider only runs this process started or queued (an in-memory set/queue), so a dev server never queues behind, steals, or drains a production run. `errorText` keeps its 2000-char cap; drop the Drizzle "Failed query:" branch (`must()` already produces short messages).
- 2.7 [server/plugins/runner.ts](../../server/plugins/runner.ts): remove the boot `sweep()` + `drain()` entirely (every dev DB is now prod). Keep `runner.sweep` deleted too; a run orphaned by a dev restart is cancelled from its run page. Note it in README (Sprint 5).
- 2.8 [server/pipeline/stages/](../../server/pipeline/stages/) (`fetch, chunk, outline, outline-agent, extract, resolve, annotate, classify, critique, figures, render, finalize, stub`) and [server/pipeline/summary.ts](../../server/pipeline/summary.ts): replace each Drizzle call one for one. Specifics: `outline-agent.ingestTrace` calls `claim_agent_trace`, then inserts fresh trace events as **one** batch insert (not one request per line); `finalize` reads the run's events with `selectAll` (agent runs exceed 1000 events) and counts review items with `select('id', { count: 'exact', head: true })`; `loadSummaryCatalog` does two reads (manuscript, then family) instead of a join; `critique`'s review-item insert stays a single batch.
- 2.9 [server/utils/dispatch.ts](../../server/utils/dispatch.ts): only import paths change, if any.
- 2.10 Tests (fake via `setSupabase(createFakeSupabase())` in `beforeEach`; buckets in § Tests below): port `runner`, `inngest-runner`, `outline-agent`, `extract`, `figure-vision`; delete the listed plumbing tests; add one test that a dev process doesn't treat another process's `running` row as busy.

#### Verification
- [ ] ~~Real ingest of `toy-supa-dev`~~ **not run** (no model spend authorized for Sprint 2); replaced by a scratch write-path check against real Postgres (Deviations). The first real ingest on Supabase is still pending (Sprint 4 / Kyle).
- [x] `/api/blobs/<sha>` (scratch 4104-byte PNG) answers `Range: bytes=0-1023` with 206, `Content-Range: bytes 0-1023/4104`, `Content-Length: 1024`; `bytes=-100` → 206 `4004-4103/4104`; full → 200 with matching sha256; `If-None-Match` → 304; `bytes=99999-` → 416; unknown sha → 404
- [x] `grep -rn "drizzle-orm\|useDb\|server/db" server/pipeline server/utils/{runs,stageOutputs,sourceStore,blobs,dispatch}.ts server/plugins/runner.ts server/api/blobs` is empty
- [x] lint, typecheck, tests green — 285 tests in 26 files (with Sprint 3's tree, Nov 1)

#### Deviations (Sprint 2)
- **Verification without a real ingest.** A temporary dev-only route (`server/api/blobs/zz-sprint2-verify.post.ts`, deleted after; a new `server/tasks/` file isn't registered by a running dev server without a restart) drove the ported utils on the dev server against `qnsjllrorhxmtfcoqlks` with a private scratch paper `zz-sprint2-scratch`. Results: `claimQueued` true then false; `add_run_cost` 0.25 + 0.5 + 10 parallel × 0.01 + agent trace 0.4 → `cost_usd` exactly 1.25; `patch_run_progress` three keys (two concurrent) all kept; `bump_run_progress` 1 + 5 parallel × 2 → 11; `claim_agent_trace` via `ingestTrace` logged 3 lines, a direct claim with the same maxima returned `[{ seq: 3, cost: 0.2 }]` (numbers), re-delivering seq 2–5 logged only 4–5; batch trace insert and `getRunView` order correct; `stage_outputs` upsert overwrote, `\u0000` stripped, `copyForward` copied `chunk, outline`; `storeSources` twice left one text row and one asset. Storage duplicate upload returns `StorageApiError` status 400 / `statusCode: '409'` / `code: 'KeyAlreadyExists'`; `blobStore.put` treats it as stored and writes the meta row. All scratch rows and the Storage object were then deleted; MCP SQL shows every table and `storage.objects` (bucket `blobs`) at 0 rows.
- **New helpers in owned files** (not Contracts changes): `appendEvents(runId, events[])` in `runs.ts` (one insert per trace batch); `loadSourceText(paperId)` in `sourceStore.ts`, shared by the seven stages that read `sources` (`selectAll`, ordered by `path, id`; Drizzle had no ORDER BY); `server/pipeline/papers.ts` (`getPaper`, `paperTitle`).
- **`replaceRows`** reads the paper's old ids, inserts the new rows, then deletes the old ids in chunks of 200 (`.in('id', …)`) rather than `not in (new ids)`. Same guarantees.
- **`blobStore.put`** checks the meta row first and skips the upload when present.
- **Runner.** Per-process `active` set and `waiting` FIFO; `drain()` starts only runs this process queued (FIFO, not oldest `started_at`). A run left `queued`/`running` by a dead dev process is never auto-started or swept: cancel or retry it from its run page (README in Sprint 5). `server/plugins/runner.ts` now only logs the runner mode at dev boot.
- **Tests.** The five files on the fake; deleted "boot sweep fails runs left running" and "put overwrites an existing row"; `errorText` test rewritten (PostgREST message stays short, 2000-char cap); added the per-process busy/drain test; new `tests/blobs.test.ts` (5 tests: put idempotency, orphaned object, Range stream via `fetchStub`, sourceStore replace).
- **For Sprint 4:** stage payload sizes over PostgREST are still unproven until a real run. `paperImport` can call `blobStore.put` (handles existing objects). Restart the dev server after adding `server/tasks/*` files.

---

### Sprint 3: Port the read path: routes, agent API, catalog, chat loaders, health [Complete]
**Goal:** Every other route and util runs on `useSupabase()` with byte-identical responses; agent logging and stats work.
**Estimated effort:** 4 hours (parallel with Sprint 2)

#### Tasks
- 3.1 [server/utils/agentApi.ts](../../server/utils/agentApi.ts): `publicDigestRows` reads `paper_digest_stats` (filter `has_digest`, `public` or dev `toy`), joins `manuscripts` / `families` in memory from `loadCatalog()`'s rows (373 + 721 rows, already cached); `loadCatalog` reads `families` and `manuscripts` with `selectAll`, `catalog_meta`, and the stats view; `loadPublicDigest` reads one row. Caches and TTLs unchanged.
- 3.2 [server/utils/agentLog.ts](../../server/utils/agentLog.ts): the sink inserts `agent_requests` rows (batch). **Skip the write when `import.meta.dev`** (unless `AGENT_LOG_DEV=1`) so local curls don't pollute prod's agent stats. Never throws, as today.
- 3.3 [server/utils/agentStats.ts](../../server/utils/agentStats.ts): `agentRequestStats({ days })` calls RPC `agent_request_stats`; `formatAgentStats` unchanged.
- 3.4 [server/utils/digests.ts](../../server/utils/digests.ts), [server/utils/chatSources.ts](../../server/utils/chatSources.ts): one-for-one.
- 3.5 [server/catalog/sync.ts](../../server/catalog/sync.ts): `syncCatalog(opts)` and `linkPapers()` per the transactions table (diff against current rows read with `selectAll`, upsert only changed rows, families before manuscripts, then meta, then link). [server/catalog/query.ts](../../server/catalog/query.ts): row type imports from `rows.ts`.
- 3.6 Routes: `papers.post`, `papers/[slug].get`, `papers/[slug]/{chat,labels,public,summary}.post`, `runs/[id].get` (`hasDigest` from the stats view or `digest is not null` via `.not('digest','is',null)` count), `runs/[id]/{retry,review}.post`, `admin/papers.get` (runs via `selectAll`), `admin/catalog/sync.post`, `corpus.get`, `corpus/[slug]/ingest.post`. Map unique violations (`23505`) to today's status codes.
- 3.7 `health.get.ts`: `{ db: 'supabase', migrations: await rpc('applied_migration_count'), gateway }`.
- 3.8 [server/plugins/operator.ts](../../server/plugins/operator.ts): `REQUIRED_ENV` swaps `DATABASE_URL` for `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY` (names only, never values).
- 3.9 Tests: port `agent-api` and `catalog` to the fake; delete the aggregate test (SQL now lives in 0004 and was checked in 1.5).

#### Verification
- [x] Before porting, save JSON from the PGlite app for `/api/papers`, `/api/papers/eth`, `/api/v1/papers`, `/api/v1/families?limit=5`, `/api/admin/papers` (operator) into the scratchpad — saved (plus `/api/v1/families`, `/api/v1/disciplines`, `/api/corpus`, `/api/health`, `/llms.txt`, `/sitemap.xml`) to **`.data/baseline-pglite/`** (gitignored, survives the session). **The after-import comparison is Sprint 4's** (4.5): diff the same calls once the five are imported.
- [x] `curl localhost:3120/api/health` → `{ db: 'supabase', migrations: 4, gateway: true }`
- [x] `grep -rln "drizzle-orm\|useDb(\|server/db" server` lists only `server/db/**` (deleted in Sprint 5)
- [x] lint, typecheck, tests green — 280 tests in 25 files (with Sprint 2's tree as of Nov 1)
- [x] Empty-DB smoke (curl against the shared dev server, Supabase empty of rows): `/`, `/papers`, `/admin`, `/api/papers` (dev toy only), `/api/v1/papers`, `/api/v1/families` (`total: 0`), `/api/v1/disciplines`, `/llms.txt`, `/agents.md`, `/sitemap.xml`, `/api/admin/papers`, `/api/corpus` all 200; `/eth`, `/api/papers/eth`, `/papers/378`, `/api/v1/families/049` 404 (no rows yet). No 500s.

#### Deviations (Sprint 3)
- **Catalog sync not run** (it is 4.4's outbound step). `/api/v1/families` reads `total: 0` until then.
- **`publicDigestRows`**: one `paper_digest_stats` read (`has_digest`, `public` in prod) ordered `created_at desc, id`, joined in memory to `loadCatalog()`'s families/manuscripts. In dev the `public OR slug = 'toy'` rule is applied in JS (the fake has no `.or()`; the dev row count is small). `loadCatalog` = `selectAll` families (order `number`) + manuscripts (order `dir`) + `catalog_meta` + the stats view (`public`, `has_digest`, `manuscript_dir not null`, order `updated_at, id`).
- **No digest downloads on list routes.** `admin/papers.get` takes counts from the stats view (was `select *` from papers, i.e. every digest over HTTP), `corpus.get` and `runs/[id].get` take `has_digest` from it. Same JSON.
- **Unique violations.** `papers.post` drops the check-then-insert and maps the insert's `23505` → 409 (same message). `corpus/[slug]/ingest.post` maps a concurrent first-ingest `23505` → its existing 409.
- **Write semantics kept as conditional single statements:** `review.post` updates `.is('decision', null)` and reads the result; `linkPapers` updates `.is('manuscript_dir', null)`.
- **`syncCatalog`**: no transaction (families → manuscripts in chunks of 500 → `catalog_meta` → `linkPapers()`, each idempotent); diff still against current rows (`selectAll`, mapped with `familyRow`/`manuscriptRow`) so a re-sync writes 0/0.
- **`agentLog`**: `AgentRequestEntry` is now an explicit camelCase interface (was Drizzle `$inferInsert`); the default sink maps to snake_case and **skips in dev unless `AGENT_LOG_DEV=1`**. Document `AGENT_LOG_DEV` in README/.env.example (Sprint 5).
- **`agentRequestStats(opts)`** = RPC `agent_request_stats` + `since` revived to a `Date`.
- **`chatSources`** orders sources by `path` (order is irrelevant: `buildChatSources` rebuilds it).
- **Tests.** `agent-api`: the aggregate test is replaced by (a) the default sink inserts snake_case rows into the fake, (b) `agentRequestStats` calls the RPC and revives `since` (RPC twin added in-test via `fake.rpcs`), (c) `formatAgentStats` on a fixed readout. `catalog`: sync asserts fake tables + `catalog_meta`. Seeds carry `id`/timestamps/`manuscript_dir` themselves — **the fake's seed bypasses column defaults** (worth knowing for Sprint 4 tests).
- **tsx scripts are now dead**: `scripts/{sync-catalog,agent-stats,import-papers}.ts` still call `syncCatalog(db, …)` / `agentRequestStats(db, …)` / `linkPapers(db)` and import modules that resolve `#supabase/server`. They are outside typecheck and lint passes; Sprint 4 replaces them with tasks (4.3).
- No change to `server/utils/{supabase,rows}.ts`.

---

### Sprint 4: Tasks and data move: catalog sync, import of the five, archive export [Complete]
**Goal:** Supabase holds the catalog (373 families / 721 manuscripts) and the five public digests with their blobs; the site works end to end on Supabase; the operator commands are Nitro tasks.
**Estimated effort:** 3 hours

#### Tasks
- 4.1 **Archive export first (PGlite, dev server stopped):** add `--all` to [scripts/export-papers.ts](../../scripts/export-papers.ts) (every paper with a digest; a paper that fails the chunk/outline check is skipped with a warning instead of aborting). Run `npm run papers:export -- --all`. Report count and MB. This JSON archive is how any other paper reaches Supabase after Sprint 5 deletes PGlite access.
- 4.2 `server/utils/paperImport.ts`: the export format type (moved from `scripts/exportFormat.ts`, `EXPORT_VERSION = 1`, camelCase keys and ISO strings as written) and `importPaper(file, blobDir)` per the transactions table: verify every blob's sha256 + size **before** any write (corrupt → nothing from that file is written), upload missing objects, then the ordered upserts with snake_case mapping, `agent_token` null. Returns per-table counts.
- 4.3 Tasks (thin wrappers, results returned as text/JSON):
  - `server/tasks/papers/import.ts` → `papers:import`, payload `slugs` (comma string or array; resolves to `.data/export/<slug>.json`) or `all: true`; then `linkPapers()`.
  - `server/tasks/catalog/sync.ts` → `catalog:sync`, payload `force`, `json`; calls `syncCatalog` + `invalidateCatalog`, prints today's report.
  - `server/tasks/paper/public.ts` → `paper:public`, payload `on` / `off` (slug lists); no payload lists every paper and flag; `invalidateCatalog()`.
  - `server/tasks/agent/stats.ts` → `agent:stats`, payload `days` (default 30); returns `formatAgentStats` text.
  - `package.json`: `"catalog:sync": "nuxt task run catalog:sync"`, `"paper:public": "nuxt task run paper:public"`, `"agent:stats": "nuxt task run agent:stats"`, `"papers:import": "nuxt task run papers:import"` (payload flags appended by the caller, e.g. `npm run papers:import -- --payload.slugs=eth,logspace`). Delete `scripts/{sync-catalog,set-public,agent-stats,import-papers,exportFormat}.ts`.
- 4.4 **Outbound (Kyle confirms):** with `npm run dev` up on Supabase: `npm run catalog:sync` → 373 families, 721 manuscripts; `npm run papers:import -- --payload.slugs=eth,logspace,intmult,unit-distance,noncoordinate` → counts match the Sprint 5.1 export notes in the openai_explorer plan (1 paper, 1 run, 8–10 stage_outputs, 1–18 sources, 6 blobs total); `npm run paper:public` → exactly the five public; re-running the import skips/no-ops all five. MCP `get_advisors` again.
- 4.5 Browser check (signed out and signed in with `OPERATOR_TOKEN` set): `/`, `/papers` (373 total, Digested 5), `/papers/378`, `/eth` overview, `/eth/<node>?view=graph`, `?view=paper` (PDF loads; network shows 206 from `/api/blobs/…`), a figure image, one chat turn on `/eth`, `/admin` table, Sync catalog button, Public switch round-trip on the `toy-supa-dev` scratch paper (not on the five). Agents: `/api/v1/papers` = five; MCP `tools/call list_papers` = five; `/llms.txt` 200.
- 4.6 Confirm `/_nitro/tasks` is absent from a production build: `npm run build && node .output/server/index.mjs` then `curl -i localhost:3000/_nitro/tasks` → 404.

#### Verification
- [x] Import counts per table equal the export's; Storage `blobs` holds 6 objects; `select count(*) from blobs` = 6 (papers 5, runs 5, stage_outputs 44, sources 51, source_assets 0, blobs 6, objects 6)
- [x] 4.5 checks pass except the signed-in, chat, Sync-button and Public-switch items (see Deviations); screenshots in `verification/screenshots/` (`papers.webp`, `eth-overview.webp`, `eth-thm-main-paper-view.webp`)
- [x] `.data/pg/` untouched (`du -sh` 198 MB before and after); `.data/export/` holds the archive (39 papers, 73 MB)
- [x] lint, typecheck, tests green — 288 tests in 27 files; `npm run build` green

#### Deviations (Sprint 4)
- **4.1 archive:** `npm run papers:export -- --all` (PGlite, dev server down) wrote **39/39** papers with a digest, 216 blob files, 73 MB on disk (74.6 MB counting shared blobs per paper); none failed the chunk/outline check. It re-exported the five in place (same rows; `exportedAt` changed). `scripts/export-papers.ts` no longer imports `exportFormat.ts` (deleted): it keeps `EXPORT_VERSION = 1` inline and imports only the `PaperExport` type from `server/utils/paperImport.ts` (a value import would resolve `#supabase/server` under tsx).
- **4.2 `importPaper(path, blobDir)`** returns `{ slug, status: 'imported' | 'unchanged' | 'skipped', counts }`, counts as `written/of` per table plus `objects` (Storage uploads). Blob objects are uploaded directly (not via `blobStore.put`) so the `blobs` meta row keeps the export's `created_at`; `storageKeyExists` is now exported from `blobs.ts` for that. Stage outputs go one row per request (payloads ~1 MB); everything else is one batch per table. **No PostgREST payload limit bit**: logspace (2.1 MB JSON) and the ~1 MB digests imported in one pass (five papers in ~15 s). New `tests/paper-import.test.ts` (3 tests: full import + no-op re-run, corrupt blob writes nothing, slug under another id skipped).
- **4.3 tasks:** `server/tasks/{papers/import,catalog/sync,paper/public,agent/stats}.ts`; payload parsing in `server/utils/taskPayload.ts` (`payloadFlag`, `payloadList`; a helper file inside `server/tasks/` would be scanned as a task). Flags are `--payload.all=true`, `--payload.force=true`, `--payload.json=true`, `--payload.on=a,b`, `--payload.off=a`, `--payload.days=7`. `papers:import` also accepts `--payload.all=true` (every JSON in `.data/export`; not run). `paper:public` with an unknown slug throws (non-zero exit, stack in the CLI output). Deleted `scripts/{sync-catalog,set-public,agent-stats,import-papers,exportFormat}.ts`; `scripts/{db,export-papers}.ts` remain for Sprint 5.
- **4.4 results:** `catalog:sync` → openai/math @ `4eaee87`, 373 families, 721 manuscripts, 17 disciplines, Lean 138 families / 175 manuscripts, written 373/721, one warning (`lean/formalization.yaml` names Taming-implies-compatibility…, not in CONTENTS.md). Import: eth (objects 2, blobs 2, stage_outputs 10, sources 4), logspace (8, 18), intmult (8, 16), unit-distance (objects 4, blobs 4, 10, 12), noncoordinate (8, 1); one paper and one run each. `linked: (none)` because the exported rows already carried `manuscript_dir` (all five linked, checked by SQL). The five arrived **public** (the export carries the flag), so `paper:public` listed exactly the five public with no flip needed. Re-run: all five "already imported, nothing written" (0/n everywhere).
- **Advisors after import:** security = 12× INFO `rls_enabled_no_policy` (intended); performance = INFO `unused_index` ×2 (`families_discipline_idx`, `manuscripts_family_idx`) and INFO `auth_db_connections_absolute`. No WARN.
- **4.5 checks run (signed out, dev, curl + Playwright):** `/`, `/papers` (373 results · 721 papers · 17 disciplines · 5 digested), `/papers/378`, `/papers/049`, `/eth`, `/eth/thm-main`, `/eth/thm-main?view=paper` (PDF renders; network: one 200 then 206s on `/api/blobs/3e93d8…`), `/admin`, `/llms.txt`, `/sitemap.xml` all 200. Range `bytes=0-1023` → 206 `0-1023/887965`; unit-distance figure PNG 200, bytes match its sha. `/api/v1/families?digested=1` → total 5; `/api/papers` → five + dev `toy`; `/api/v1/papers` → five + dev `toy` (same as the baseline); MCP `tools/call list_papers` lists them. `/eth?view=paper` stays on the overview by design (`view` is read on node pages only; the overview's "Read the paper" link goes to the node route). **Not run:** signed-in pass, a chat turn (model spend), the Sync-catalog button (the task did the same sync) and the Public switch round-trip (no `toy-supa-dev` scratch paper exists in Supabase; the task's `on` path was exercised on `eth`, a no-op).
- **Baseline diff (`.data/baseline-pglite/` vs after import):** identical: `/api/papers`, `/api/papers/eth`, `/api/v1/papers`, `/api/v1/families`, `/api/v1/families?limit=5`, `/llms.txt`, `/sitemap.xml`. Expected differences only: `/api/health` (`pglite`/6 → `supabase`/4); `/api/v1/disciplines` `stats.syncedAt` (new sync); `/api/admin/papers` 42 → 6 rows (the five + dev toy), each of the five byte-identical to its baseline row; `/api/corpus` loses the `-agent` runs and runs of non-imported papers, and unit-distance's `lineageCostUsd` drops 3.63 → 0.12 (its ancestor runs weren't needed for chunk/outline, so weren't exported).
- **4.6 + a build fix:** the first `node .output/server/index.mjs` **failed to boot** (`ERR_MODULE_NOT_FOUND …/tslib/modules/index.js`; file tracing drops it once a Supabase package is in a server chunk). Added `nitro.externals.inline: ['tslib']` (Camera Shy's and Daylight's fix). After that: `/_nitro/tasks` and `/_nitro/tasks/paper:public` → 404, `/api/health` 200, `/eth` 200, blob Range 206.
- **Build output holds the secret key.** The module's `secretKey: process.env.SUPABASE_SECRET_KEY` is read at build time, so a local `npm run build` with `.env` present writes the key into `.output/server` (one file). `.output/` is gitignored and was deleted after the check; on Vercel the env var is the source anyway.

---

### Sprint 5: Cleanup, README, env example [Not Started]
**Goal:** No Drizzle, PGlite or postgres-js code or dependency remains; docs describe the Supabase setup.
**Estimated effort:** 2 hours

#### Tasks
- 5.1 `npm uninstall drizzle-orm @electric-sql/pglite postgres drizzle-kit`; remove `db:generate`, `db:migrate`, `papers:export` from `package.json`. Keep `tsx` only if something still uses it (else remove).
- 5.2 Delete `server/db/` (index, schema, migrations, meta), `drizzle.config.ts`, `scripts/db.ts`, `scripts/export-papers.ts`, and the now-empty `scripts/` if nothing is left.
- 5.3 Remove what the Sprint 0 PGlite guards were for: `ALLOW_REMOTE_DEV_DB`, `assertDevDbIsLocal`, the `VERCEL`-without-`DATABASE_URL` throw (all inside `server/db/index.ts`), the `dbDriver()` branch in `server/plugins/runner.ts` (gone in 2.7), `SCRIPT_PGLITE_DIR`. Keep `server/utils/appUrl.ts` and the boot env report.
- 5.4 `vitest.config.ts`: drop the "each file's in-memory PGlite" comment; `isolate: true` stays (the fake is per test). Grep tests for `createDb` / `setDb` → none.
- 5.5 [README.md](../../README.md): replace the Drizzle/PGlite storage paragraph, "No database to install", the operator-commands block (dev server **up**, `nuxt task run`), the env table (`SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SECRET_KEY`; drop `DATABASE_URL`), the migrations note (`db_migrations/` + MCP `apply_migration` + `generate_typescript_types`), the tree (`db/` → `db_migrations/`, `server/tasks/`), and a "dev is prod" warning (scratch papers stay private; cancel orphaned runs from the run page; agent requests aren't logged in dev). [.env.example](../../.env.example): drop `DATABASE_URL` / `ALLOW_REMOTE_DEV_DB`.
- 5.6 Cross-reference: mark in [../20261101_openai_explorer/implementation_plan.md](../20261101_openai_explorer/implementation_plan.md) Status and Sprint 0 / Sprint 5 that the DB items moved here (mapping below), without rewriting that plan's history.
- 5.7 `npm ci` from a clean `node_modules` to prove the lockfile.

#### Verification
- [ ] `grep -rniE "drizzle|pglite|postgres-js|DATABASE_URL|useDb|createDb|setDb" --exclude-dir=node_modules --exclude-dir=.nuxt --exclude-dir=.output --exclude-dir=docs .` is empty (docs keep history)
- [ ] Every `npm run` command quoted in README exists in `package.json`
- [ ] Fresh `npm run dev` → 4.5's checks still pass (spot-check `/`, `/eth?view=paper`, `/admin`)
- [ ] lint, typecheck, tests green; `npm run build` succeeds

---

## Tests

Pure-function tests stay untouched: `annotate, chat-tools, chat, chunk, corpus, equations, figures, finalize, graph-labels, graph-layout, mcp, node-card, operator-auth, operator-session, summary, synctex, viewport` (17 files). Any of them that imports a ported module transitively resolves `#supabase/server` to the throwing stub and never touches it.

The 7 DB-integration files move to the fake (Daylight-style stubs, shared once), except tests whose only subject was SQL plumbing now owned by Postgres:

| File | Stays pure | Moves to fake | Deleted (why) |
|---|---|---|---|
| `catalog.test.ts` | 6 parse tests | sync writes + links + idempotent re-sync; validation/force + stale kept; queries (public-only digested); `GET /api/papers` list; agent log skips same-origin (spy on the sink) | none |
| `agent-api.test.ts` | UA classification, log entries, swallowed failing write, MCP call logging | public flag: list, private = missing, new papers start private | "writes rows and the readout aggregates them" (aggregation is RPC `agent_request_stats`; checked in 1.5) |
| `extract.test.ts` | ids, outline normalization, prose mentions, cycle rejection | stored outline reuse, extract, resolve end to end (mocked model) | none |
| `figure-vision.test.ts` | schema, `cleanVision`, prompt order | figuresStage, retry skip, finalize render+figures (fake Storage) | none |
| `inngest-runner.test.ts` | none | all 6 (run row + progress flags via fake `patch_run_progress`) | none |
| `outline-agent.test.ts` | model-id mapping, callback URL, malformed outline, `validate_outline.mjs` | `ingestTrace` dedupe + cost delta (fake `claim_agent_trace`), structure_partial | none |
| `runner.test.ts` | `jsonbSafe` | LocalRunner steps/budget/waitForEvent, lifecycle queue/drain (per-process), budget fail, cancel, ingest end to end, `copyForward` | "boot sweep fails runs left running" (sweep removed); "put overwrites an existing row" (upsert plumbing); `errorText` Drizzle case (rewritten as one test that a PostgREST error message comes out short) |

Net: ~4 tests deleted, 1 added (per-process busy check), the rest kept. No test talks to Supabase; the RPC and view SQL are verified once in Sprint 1.5 inside rolled-back transactions.

---

## Mapping of the openai_explorer plan's remaining items

| Item there | Here |
|---|---|
| 0.1 `prepare: false`, dev remote-DB refusal, `VERCEL` without `DATABASE_URL` throws | Obsolete (no pooler, no driver); deleted in 5.3. Dev uses prod by decision. |
| 0.2 skip boot sweep on Postgres | Superseded by 2.6–2.7 (per-process runner, no sweep). |
| 0.3 `appUrl` fallback, 0.4 boot env report | Kept; 0.4's list changes in 3.8. |
| 0.5 `.env.example` `DATABASE_URL` note | Replaced by 1.10 / 5.5. |
| 0.6 migrate via session pooler; `.cursor/mcp.json` | Migrations via MCP `apply_migration` (1.4). An MCP config file stays optional, shaped like `camera_shy/.cursor/mcp.json`, token from env. |
| 0.7 Vercel env | Still pending Kyle, **with new names**: add `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY`; never set `DATABASE_URL`. Don't use the Vercel↔Supabase integration (it injects legacy names, per `project_bootstrap.md`). |
| 0.8 preview deploy + health | Still pending Kyle; expect `{ db: 'supabase', migrations: 4, gateway: true }`. |
| 5.1 export, 5.2 import | 5.1 done; `--all` archive in 4.1. Import retargeted to the `papers:import` task (4.2–4.3). |
| 5.3 Web Analytics | Unchanged, there. |
| 5.4 prod migrate → sync → import → public → advisors | Done here in 1.4 and 4.4 (dev and prod are one database). |
| 5.5 firewall, 5.6 deploy/promote, 5.7 smoke, 5.8 README deploy section | Stay there, pending Kyle. 5.7 changes: health values above; `agent:stats` runs as a task with the dev server up; no inline `DATABASE_URL`. 5.8 loses the pooler text (README rewritten in 5.5 here). |

**What admin loses by importing only five.** The ~37 other papers (the human-written fixtures, `-agent`/`-e2e` copies, other corpus runs), every run except each digest's own run (plus ancestors if one had been needed; none were), and all `run_events` and `review_items`. The run page for the five shows its run with an empty event log; `/admin/corpus` shows only those five as done. `.data/pg/` keeps everything. To bring more in later: they are already in the 4.1 archive, so `npm run papers:import -- --payload.slugs=<slug>,…` with the dev server up (then `npm run paper:public -- --payload.on=<slug>` if it should be listed). Run history and non-digested papers stay only in `.data/pg/`.

---

## Risks

- **Pipeline write volume over HTTP.** Each `appendEvent`, `patchProgress` and stage write is a PostgREST round trip (~20–60 ms from Vercel `iad1` or Richmond to us-east-1) instead of a pooled TCP query. Steps are already sequential and model calls dominate (seconds each). Mitigations: batch trace inserts (2.8), keep review-item inserts batched. If a long agent run is still slow, batch `run_events` per step.
- **PostgREST limits.** Selects cap at 1000 rows: `selectAll` for `manuscripts` (721 today), `families`, admin runs, a run's events in finalize. Large jsonb bodies: logspace's export is 2.1 MB and a digest is 1–2 MB; Supabase's REST gateway accepts bodies of that size, but 4.4 is the real test. If a write is refused, the fix is per-stage payload trimming, not chunked rows.
- **Range requests through Storage.** `/api/blobs/:sha` now proxies a signed URL fetch. The 60-s signed URL is created per request, so there's one extra Storage call per range (PDF.js issues several). Acceptable at current traffic; immutable caching means browsers and Vercel's CDN absorb repeats. Vercel's 4.5 MB response cap is unchanged because ranges stay small and the full response streams.
- **Type differences.** `timestamptz` arrives as `2026-11-01T12:00:00.123456+00:00` strings; `rows.ts` turns them into `Date` so `toISOString()` output (and API JSON) is unchanged. `numeric` arrives as a JSON number (fine at cent precision); mappers still `Number()` it. `bigint` ids (`run_events.id`, `agent_requests.id`) fit in JS numbers. `date` (`published_on`) stays a `YYYY-MM-DD` string, as with Drizzle.
- **Dev shares prod.** A dev ingest writes real (private) rows; a dev boot no longer sweeps; LocalRunner is per process (2.6); agent requests from dev aren't logged (3.2). Inngest dev and Inngest cloud write the same tables with distinct run ids. Catalog changes from dev reach prod instances within the 60-s TTL.
- **Chat limiter and agent logging.** Chat limits are in memory and unaffected. `agent_requests` writes stay fire-and-forget under `waitUntil`; a Supabase outage logs a warning and serves the request, as today.
- **Stub-event client.** `useSupabase()` depends on the module's current implementation using the event only for runtime config and caching (`@nuxtjs/supabase` 2.0.9). Pin the minor version; a module upgrade re-checks that file.

---

## Considered and rejected

- **`@supabase/supabase-js` as a direct dependency or import** (Daylight's `worker-client.ts` `createClient`, Camera Shy's script and type imports): rejected per Kyle; the stub-event singleton and Nitro tasks cover every case.
- **Keeping tsx scripts that import the transitive `@supabase/supabase-js`**: same rule. Nitro tasks run inside Nuxt with the module.
- **New operator HTTP endpoints for import and stats** instead of tasks: tasks are dev-only and need no auth surface; `agent:stats` deliberately has no endpoint today.
- **Anon key + RLS policies for public reads:** bypasses agent logging, caching and `canSeePaper`; GPE has no Supabase users to scope rows to.
- **`supabase/migrations/` + `supabase db push` or a local Docker stack:** neither of Kyle's apps does this; one database by decision (Open Question 1 if he wants the CLI layout anyway).
- **Keeping bytes in Postgres (`bytea` via PostgREST)**: base64 over JSON, no range reads without an RPC, and Kyle asked for Storage.
- **Dropping the `blobs` table and using Storage `info()` for metadata:** loses the `source_assets` FK and adds a Storage call per `meta()`.
- **A Postgres RPC per former transaction** (sources replace, catalog sync, import): idempotent ordered writes are enough there (table above); RPCs are kept to concurrent counters and the trace claim.
- **Rewriting stored digests' `/api/blobs/<sha>` URLs to Storage URLs:** the route contract and immutable caching stay; nothing in jsonb changes.
- **Deleting every DB-integration test:** they carry the runner, catalog and public-flag behaviour; the fake keeps them cheap.
- **Importing all ~42 dev papers:** the fixtures and copies were never meant for prod; archived in JSON instead.

## Open Questions

1. **Migrations folder.** The brief said `supabase/migrations/`; Camera Shy and Daylight both use `db_migrations/NNNN_name.sql` applied with MCP `apply_migration`, so this plan mirrors them. If you want `supabase/migrations/<timestamp>_name.sql` (Supabase CLI layout) instead, it's a rename before Sprint 1 and nothing else changes.
2. **Commit before Sprint 5?** The `openai-explorer` tree is uncommitted and Sprint 5 deletes `server/db/`, the scripts and PGlite access. A commit of the current tree first (your call; this plan doesn't commit) keeps a way back to PGlite beyond the 4.1 JSON archive.
