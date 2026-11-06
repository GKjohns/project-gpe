# Proofmap

Proofmap is a public reading site for [openai/math](https://github.com/openai/math): all
373 result families (721 machine-written manuscripts) with abstracts and PDF links, and, for the papers that have been
digested, a browsable map of the proof: semantically named nodes, plain-English explanations, dependency edges, links
back to the paper, and a chat that answers questions with links into the map. Behind `/admin` sits the operator tool
that makes the digests: point it at a paper's LaTeX (and, later, the Lean that formalizes it) and watch it run.

The full project brief is in [docs/BRIEF.md](docs/BRIEF.md). Read it before building anything.

## Status

Phase 1 (paper only, no Lean) is built: ingest from the browser, run page, tree + node pages, dependency graph, chat
with node citations, friction table, and a corpus page comparing the two structure methods
([docs/20261029_digest_v1/implementation_plan.md](docs/20261029_digest_v1/implementation_plan.md)). The pivot to a public
openai/math explorer is in progress: catalog, admin move and API guarding are done; the public landing, catalog and
family pages and the paper overview are next
([docs/20261101_openai_explorer/implementation_plan.md](docs/20261101_openai_explorer/implementation_plan.md)).

## How it works

Public pages: `/` (landing), `/papers` (the catalog), `/papers/<code>` (a result family), `/<slug>` (a digested
paper; today it lands on the reader, `/<slug>/<node>?view=paper`), the map (`/<slug>/<node>` with tree, node page,
`?view=graph`, chat) and `/<slug>/friction`. Everything an operator does is under `/admin` (sign in at `/login`): the
papers table (`/admin`: family, run state, cost, Public switch, Sync catalog), `/admin/papers/new` (paste a GitHub
directory or arXiv id, or upload `.tex`), the run page (`/admin/papers/<slug>/run`: stepper, live log, spend, review
queue, Render paper / Re-render) and `/admin/corpus`.

**Pipeline** (`server/pipeline/ingest.ts`, one file per stage in `server/pipeline/stages/`):

| Stage | What it does | Model |
|---|---|---|
| fetch | GitHub directory (contents API) or arXiv e-print (tar/gz), or the uploaded files | none |
| chunk | Deterministic LaTeX → skeleton: sections, every theorem-like environment, proofs, `\ref` edges, macros, display numbers | none |
| outline | The major claims inside every proof of 60+ lines, with line spans and what each rests on | strong (see methods) |
| extract | Each labeled statement becomes a node straight from the skeleton; each outlined claim gets one call for its statement | mid |
| resolve | `\ref` edges are mechanical; edges stated only in prose ("by the previous lemma", "Appendix A proves…") are inferred and flagged | mid |
| critique | One whole-DAG review; fixes ≥ 0.85 confidence apply, the rest wait in a review queue on the run page | strong |
| annotate | Name, plain statement and explanation per node, in dependency order (deps explained first) | mid |
| classify | standard / routine / novel, with a citation or a reason | strong |
| render | Compiles the stored sources with TeX Live 2025 (latexmk; pdfLaTeX, or XeLaTeX/LuaLaTeX when the source asks) in a no-network Vercel Sandbox with SyncTeX on; maps every node to its boxes in the PDF; crops each figure environment out of the PDF (TikZ included) to a PNG. Falls back to arXiv's PDF, then to "unavailable"; never fails the run | none |
| figures | Looks at each figure image: kind, alt-text description, for plots the axes/series/trend and only legible values ("unreadable" otherwise), the nodes it supports, confidence | vision (Opus 5.5; Sonnet on quick) |
| finalize | Digest JSON on the paper row, run metrics, paper-internal friction, golden diff for corpus papers with a golden | none |

The rule behind it: the skeleton comes from the LaTeX, never from a model. Models only add what the source leaves
implicit (claims inside long proofs, prose dependencies) and the prose.

**Paper reader** (`app/components/reader/PaperReader.vue`): the typeset PDF in PDF.js (text selection, the paper's
own links, find, zoom, page nav, an invert option for dark mode). Each statement's SyncTeX boxes are drawn as a faint
overlay with a margin marker; clicking inside a statement or proof selects its node (node card on the right), and
selecting a node in the tree, graph or chat scrolls the PDF to it. Figures get a badge in the PDF; `\ref{fig:…}` in
any rendered text is a "Figure 3" chip whose popover shows the image, caption and the vision description; node pages
list their figures. PDFs, SyncTeX files, figure PNGs and figure source files are content-addressed blobs: the bytes in
the private Supabase Storage bucket `blobs` (object key = sha), metadata in the `blobs` table (`source_assets` points at
it), served by `GET /api/blobs/:sha` with Range support. Design notes:
[docs/20261029_paper_reader/design.md](docs/20261029_paper_reader/design.md).

**Chat** answers from the digest (in the instructions, cached) and, when that isn't enough, calls tools over the stored
LaTeX and the graph: `read_node` (a proof's text), `search_paper`, `trace` / `ancestors` (`server/utils/chatTools.ts`).

**Agent API** (`server/utils/mcpTools.ts`): other people's agents read the maps with their own model. Point an agent
at `/llms.txt` (also `/agents.md`): plain markdown that lists the papers and every tool. The same tools are served two
ways: as GET JSON at `/api/v1/papers` and `/api/v1/papers/<slug>/<tool>?…` (for agents that only have fetch or curl),
and as a stateless MCP server at `/api/mcp`. Tools: `list_papers`, `get_overview`, `list_nodes`, `get_node`,
`read_node`, `search_paper`, `trace`, `ancestors`, `view_figure` (over MCP the PNG comes attached), `get_friction`. All of
them are read-only, need no key and make no model calls. Each one is a database read (cached per instance for a
minute) plus the chat tools' pure functions, with output capped by paging and `READ_NODE_CHARS`. Rate limiting is
meant to be a Vercel Firewall rule on `/api/mcp` and `/api/v1`.

**Catalog** (`server/catalog/`): every openai/math result family (373) and manuscript (721), built from the repo's own
index (`CONTENTS.md`, `overview.tex`, `lean/formalization.yaml`, `README.md`) at a pinned commit, with zero model calls.
`npm run catalog:sync` (dev server up; `-- --payload.force=true` writes even when the index fails validation,
`-- --payload.json=true`) or
`POST /api/admin/catalog/sync` (operator) upserts `families`, `manuscripts` and `catalog_meta`, never deletes, and links
papers to their manuscript (`papers.manuscript_dir`, from `source_ref`). It is served at `GET /api/v1/families`
(`q`, `discipline`, `digested`, `lean`, `sort`, `limit`, `offset`), `/api/v1/families/<code>` (`49` = `049`) and
`/api/v1/disciplines` (totals + per-discipline counts), which the site's pages and agents both read. A family's
`digested` list counts public digests only. Agent rows (`list_papers`, `/api/v1/papers`) carry `family`, `pdf_url`,
`has_lean` and `headline` for openai/math papers; `get_overview` adds `summary` and `catalog`. `GET /api/papers` is the
public list (public digests, no runs); the operator library reads `GET /api/admin/papers`.

Only papers with `papers.public` set are listed or queryable there; a private slug is the same 404 as a missing one.
New papers start private. Supabase holds the five public OpenAI digests (eth, logspace, intmult, unit-distance,
noncoordinate), imported from the pre-Supabase archive; in dev the toy fixture also counts as public. Every request is logged to `agent_requests` (`server/utils/agentLog.ts`): surface
(`llms`, `v1`, `mcp`), tool, paper, status, ms, a client family read off the user-agent (Claude-User, ChatGPT-User,
OAI-SearchBot, PerplexityBot, curl, python-requests, node, browser, …), the truncated user-agent, a salted sha256 of the
IP (never the IP itself) and the `?ref=` param, so links like `/llms.txt?ref=blog` can be attributed (view_figure's own
`ref` argument is not). Over MCP there is one row per `tools/call` and one per `initialize`; `client` is the MCP
client's own name/version when the message carries it (always on `initialize`, and on every request in the modern
protocol's `_meta`), otherwise the user-agent family. The site's own fetches of `/api/v1` are not logged: browser requests that say
`sec-fetch-site: same-origin`, and requests carrying `x-proofmap-site` (pages send it, since SSR fetches run in-process with
no `sec-fetch-*` headers). The write is fire-and-forget behind `event.waitUntil`, and a failed
one is only a warning. **Dev skips the write** (dev shares production's table, so local curls would pollute the stats);
set `AGENT_LOG_DEV=1` to log from dev anyway.

**Operator commands** are Nitro tasks (`server/tasks/`) wrapped by npm scripts around `nuxt task run`. They run inside
the **running dev server** (start `npm run dev` first; the CLI finds it from its lock file, `--url` overrides), with the
Supabase module and `.env`. Arguments are task payload fields: `--payload.<key>=<value>`, lists comma-separated. Task
routes exist only in dev; a production build serves none of them.

```bash
npm run paper:public                                  # every paper and its flag
npm run paper:public -- --payload.on=eth,logspace     # make public (--payload.off=… to make private); live within a minute
curl -X POST localhost:3120/api/papers/eth/public -H 'content-type: application/json' -d '{"public":true}'  # same, over HTTP (operator-only)
npm run catalog:sync                                  # openai/math index → families / manuscripts
npm run agent:stats -- --payload.days=7               # requests, unique callers and errors by day, surface, client, tool, paper, ref
npm run papers:import -- --payload.slugs=eth,logspace # load .data/export/<slug>.json (+ blobs) into Supabase; re-runs are no-ops
```

`papers:import` reads the JSON archive of the pre-Supabase local database in `.data/export/` (39 papers with digests; gitignored, local
only). `--payload.all=true` imports every file; a slug that exists under a different id is skipped.

**Operator auth** (`server/utils/operator.ts`, `server/middleware/operator.ts`): `/admin` and anything that spends money or
changes state is operator-only. That covers new papers and previews, retry/cancel/review, Render paper, graph labels, the public flag
and corpus ingests. Set `OPERATOR_TOKEN` to a long random value and sign in at `/login`, which sets a sealed httpOnly
cookie (`SESSION_SECRET` optionally sets its key). The guard denies every `/api` write by default, with four
exceptions: `/api/inngest` (Inngest signs it), `/api/mcp`, the sandbox callback `/api/runs/:id/events` (it has a
per-run bearer token) and the chat. Reads are open except the operator ones: `/api/admin/*`, `/api/corpus` and
`/api/runs/*` (401 signed out). A private paper (`papers.public` off) is the same 404 as a missing one for everyone
but the operator: its page, `GET /api/papers/:slug` and its chat. In dev with no token everything is open; in
production with no token those routes are denied. Reading public papers, the catalog and the agent API need no sign-in. The chat stays public but bounded for non-operators:
20 turns per IP per hour and a daily spend ceiling (`CHAT_DAILY_USD`, default $5), both counted in memory per function
instance (`server/utils/chatLimits.ts`). A Vercel Firewall rate-limit rule on the chat route is the real backstop.

**Two structure methods** for the outline stage, chosen per run; everything after it is identical:

- **Pipeline**: one whole-paper call over the line-numbered source plus the skeleton. Fixed cost.
- **Agent (sandbox)**: a Claude Agent SDK agent in a Vercel Sandbox reads the source with tools, writes the same
  outline JSON and validates it with a script before finishing. Variable turns and cost; trace on the run page.

The corpus page runs both over a tiered set of papers (`corpus/manifest.json`); the new-paper form's default method
comes from `defaultMethodFor(sizeTokens)` in `server/utils/aiModels.ts`, set from those numbers.

**Profiles** (`PROFILES` in `server/utils/aiModels.ts`): `careful` (Opus 5.5 for outline, critique, classify and the
agent; Sonnet 5.5 for the fan-out), `standard` (GPT-6 Sol for the strong steps, Sonnet agent), `quick` (Sonnet/Haiku).
The form defaults to `careful` over 30 pages or 100k tokens, else `standard`. All calls go through the Vercel AI
Gateway with one key.

**Runners.** Dev runs ingest in-process (LocalRunner, one run at a time per process). Production runs the same
`ingestPaper` under Inngest (one step per stage).

**Data.** Supabase, through the `@nuxtjs/supabase` module only (no direct `@supabase/supabase-js` import). Every server
read and write goes through `useSupabase()` (`server/utils/supabase.ts`): one process-wide service-role client, so it
also works where there is no request (Inngest steps, LocalRunner, tasks). Tables have RLS on with no policies; the
browser never talks to Supabase. Row types and snake→camel mappers are in `server/utils/rows.ts`; atomic run counters,
the agent-trace claim and the stats readout are RPCs, list pages read the `paper_digest_stats` view.

## Stack

- Nuxt 4, Nuxt UI 4, Tailwind 4
- Node ≥ 22.19, npm
- Supabase (Postgres + Storage via `@nuxtjs/supabase`), Vercel AI SDK 7 through the AI Gateway, Inngest, Vercel Sandbox + Claude Agent SDK
- TeX Live 2025 (in the render sandbox), PDF.js (`pdfjs-dist`) for the reader

## Dev

```bash
npm ci
cp .env.example .env        # set SUPABASE_URL / SUPABASE_KEY / SUPABASE_SECRET_KEY and AI_GATEWAY_API_KEY;
                            # VERCEL_OIDC_TOKEN for rendering and the agent method (below)
npm run dev                 # http://localhost:3120
```

Nothing to install locally: there is no local database. Tests never touch Supabase (`#supabase/server` is aliased to a
stub that throws; tests inject `tests/helpers/fakeSupabase.ts` with `setSupabase()`). `npm run lint`,
`npm run typecheck` and `npm test` (vitest) should be clean; CI runs lint and typecheck on every push. Some tests
download their LaTeX fixtures (ETH from GitHub, the sensitivity paper from arXiv) on first run into gitignored folders.

To try it: open `/admin/papers/new`, paste
`https://github.com/openai/math/tree/main/preprints/The-Exponential-Time-Hypothesis-is-False-October-25-2026/build`,
and start the run; or open `/admin/corpus` and press Ingest on any row.

### Dev is prod: one database

`npm run dev` reads and writes the production Supabase project (ref `qnsjllrorhxmtfcoqlks`); there is no dev copy.

- A paper ingested from dev is a real row. New papers start private, so scratch papers stay off the public site; flip
  only what should be listed.
- The dev server never sweeps or drains runs it didn't start. A run orphaned by a dev restart stays `running`/`queued`:
  cancel it (or retry from a stage) from its run page.
- Agent requests made against dev aren't logged (`AGENT_LOG_DEV=1` overrides).
- Catalog and public-flag changes reach production instances within their 60-s cache TTL.

### Schema, types and Storage

Schema changes are numbered, forward-only, idempotent SQL files in `db_migrations/NNNN_snake_case.sql` (see
`db_migrations/README.md`), applied in order with the Supabase MCP `apply_migration` on project `qnsjllrorhxmtfcoqlks`,
never by the app. After each one: run MCP `get_advisors` (security and performance; INFO `rls_enabled_no_policy` is the
intended state), regenerate types with MCP `generate_typescript_types` into `app/types/database.types.ts` (imported as
`#supabase/database`), and update `server/utils/rows.ts` if a column changed. `/api/health` reports
`{ db: 'supabase', migrations: <applied count> }`. Blob bytes live in the private Storage bucket `blobs` (created by
`0002_storage_blobs.sql`, 50 MB per object, no policies); `/api/blobs/:sha` streams them through a 60-s signed URL and
passes `Range` through, so PDF.js gets 206s.

### Runs in dev: LocalRunner by default, Inngest optionally

`npm run dev` runs ingest jobs in-process (LocalRunner, one at a time per process; a server restart leaves whatever was
running orphaned, see above, and "retry from stage" picks it up cheaply). The boot log says which runner is active:
`[proofmap] runner: LocalRunner (dev, no INNGEST_EVENT_KEY)`.

To exercise the production path locally:

```bash
npm run dev:inngest                          # Inngest dev server on :8288, pointed at http://localhost:3120/api/inngest
INNGEST_EVENT_KEY=local npm run dev          # any value works against the dev server; don't put it in .env
```

The boot log then says `runner: Inngest`, each stage shows up as a step in the Inngest UI (http://localhost:8288), and
the run page looks the same as under LocalRunner. Review decisions send `review/decided` to resume the waiting run.

### Rendering papers: the TeX sandbox

The `render` stage compiles in a Vercel Sandbox, so locally it needs the same `VERCEL_OIDC_TOKEN` as the agent method
(below). The first render builds a snapshot of `vercel/sandbox/universal` with TeX Live 2025 from Ubuntu's archive,
poppler, Ghostscript, `rsvg-convert` and Pillow (~2 min, once); it is cached by id in `.data/sandbox-tex-snapshot.json`
(delete it to rebuild, or bump `TEX_IMAGE_VERSION` in `server/pipeline/sandbox/tex.ts`), and `SANDBOX_TEX_SNAPSHOT_ID`
overrides it (set it on Vercel, where the cache file isn't writable). Render sandboxes have no network and are stopped
when the step ends. Papers digested before the reader existed get **Render paper** on their run page: a re-run from
`render` that reuses every other stage (a few seconds of sandbox, ~$0.02–0.04 per figure for the vision pass). In dev,
`POST /api/runs/:id/retry { fromStage: 'render', forceRenderFail: true }` skips the compile to exercise the fallbacks.

### Agent structure method (Method B): sandbox, snapshot, progress transport

Choosing **Agent (sandbox)** on the form runs the outline as a Claude Agent SDK agent in a Vercel Sandbox
(`server/pipeline/stages/outline-agent.ts`, scripts in `server/pipeline/sandbox/`). Locally it needs the repo linked to
the Vercel project and an OIDC token: `npx vercel link`, then `npx vercel env pull .env.vercel --yes` and copy
`VERCEL_OIDC_TOKEN` into `.env` (it lasts ~12 h; repeat when sandbox calls start failing with an OIDC error). The base
snapshot (node:24 + the SDK) is built on the first agent run (~15 s) and cached by id in `.data/sandbox-snapshot.json`;
delete that file to rebuild, or set `SANDBOX_SNAPSHOT_ID` (the cache file isn't writable on Vercel). The gateway key
never enters the VM: the sandbox network policy allows only `ai-gateway.vercel.sh` (plus the app's own host when the
callback is on) and injects the `Authorization` header there.

The agent's progress reaches the run page by two transports, both feeding the same de-duplicated trace ingestion:

- **Polling (dev default, always on).** The agent appends to `/vercel/sandbox/paper/trace.jsonl`; between short waits
  the pipeline runs a quiet `outline:poll-<i>` step that reads new lines into the run log, adds the agent's running cost
  to the run (so the budget check sees it), extends the sandbox timeout, and notices `agent.exit`. Every 10 s under
  LocalRunner, every 60 s under Inngest.
- **HTTP callback (when `NUXT_PUBLIC_APP_URL` is a public `https` host: prod, or a tunnel such as `cloudflared` /
  `ngrok` in dev).** The agent POSTs each trace line and a final `{ finished: true }` to `POST /api/runs/:id/events`
  with a per-run bearer token (`runs.agent_token`); `finished` sets the `agent_finished` flag and, under Inngest, sends
  `structure/agent.finished`, so the run resumes without waiting for the next poll. A latency nicety, not a requirement.

The run waits up to 90 min (200 turns, ≤ 60% of the run budget), then `outline:collect` reads `outline.json`, stops the
sandbox and continues; an agent that ran out of turns, budget or time leaves the run `structure_partial` with whatever
claims it had written. Failed and cancelled runs stop their sandbox too.

## Deploy (Vercel)

No `vercel.json`. Nitro's Vercel preset builds one function; `nuxt.config.ts` sets `maxDuration: 800` (Fluid compute's
maximum), which bounds each Inngest step invocation (the whole-paper outline and critique calls are the longest).

Outside dev every run goes through Inngest (`paper/ingest.requested` → the `ingest-paper` function, one run per paper
at a time). After the first deploy, sync the app in the Inngest dashboard (or install the Inngest Vercel integration,
which syncs on every deploy) at `https://<host>/api/inngest`.

| Variable | Required | What |
|---|---|---|
| `AI_GATEWAY_API_KEY` | yes | Vercel AI Gateway key (every model call). |
| `SUPABASE_URL` | yes | Supabase project URL (`https://qnsjllrorhxmtfcoqlks.supabase.co`). |
| `SUPABASE_KEY` | yes | Publishable key (`sb_publishable_…`). The module requires it; with RLS on and no policies it grants nothing. |
| `SUPABASE_SECRET_KEY` | yes | Secret key (`sb_secret_…`), server-only; every read and write uses it. Never commit it. |
| `OPERATOR_TOKEN` | yes in prod | Unlocks `/admin` and operator routes; unset in production = denied. |
| `INNGEST_EVENT_KEY` | yes | Lets the app send events. Its presence also switches dev to the Inngest runner. |
| `INNGEST_SIGNING_KEY` | yes | Lets Inngest call `/api/inngest` (the Vercel integration sets both keys). |
| `NUXT_PUBLIC_APP_URL` | agent method | Public URL the structure agent's sandbox posts progress to. |
| `GITHUB_TOKEN` | no | Raises the GitHub API rate limit for directory fetches. |
| `ARXIV_CONTACT_EMAIL` | no | Adds a `mailto:` contact to the arXiv fetch User-Agent (default is plain `proofmap-ingest`). |
| `AGENT_LOG_SALT` | recommended | Salt for the hashed IPs in `agent_requests` (a fixed dev salt otherwise). Changing it splits unique-caller counts. |
| `SANDBOX_TEX_SNAPSHOT_ID` | recommended | The TeX snapshot for the render stage (build it once locally and copy the id from `.data/sandbox-tex-snapshot.json`); without it the first render on each instance rebuilds it. |

Sandbox auth (render stage, agent method) is automatic on Vercel. Uploads are capped at 4.4 MB on Vercel (the
platform's request body limit) and 32 MB elsewhere. Migrations never run on boot: apply a schema change through MCP
`apply_migration` (above) before deploying code that needs it. Set the `SUPABASE_*` variables by hand rather than
through the Vercel↔Supabase integration (it injects different names). The boot log names any missing required
variable (never its value). A local `npm run build` with `.env` present bakes `SUPABASE_SECRET_KEY` into `.output/`
(gitignored); delete `.output/` after a local build check.

## Layout

```
app/
  pages/            index (landing), [paper]/[node] (map), [paper]/friction, login;
                    admin/ (operator: papers table, papers/new, papers/[slug]/run, corpus; admin.vue guards them)
  layouts/          default (public), dashboard (explorer), admin (operator sidebar)
  components/       tree/, node/, graph/ (custom dagre DAG), reader/ (PDF.js + SyncTeX overlays), figure/, chat/, run/
  composables/      useDigest, useSelection, usePaperChat
  types/            database.types.ts (generated from Supabase)
server/
  api/              papers, runs (retry/cancel/review/agent events), corpus, chat, inngest, v1/ (agent API + catalog),
                    admin/ (operator reads, catalog sync)
  catalog/          openai/math index: parse (pure), sync, query (pure filters over the cached catalog)
  pipeline/         ingest.ts, runner.ts, stages/, latex/ (chunk, equations, figures, synctex), sources/, prompts/,
                    sandbox/ (agent scripts, TeX snapshot, figure rasterizer), llm.ts
  tasks/            operator commands (Nitro tasks, dev only): papers:import, catalog:sync, paper:public, agent:stats
  utils/            supabase (service client), rows (row types + mappers), aiModels (profiles, prices, defaults),
                    dispatch (LocalRunner vs Inngest), runs, blobs (Storage), corpus,
                    mcpTools/agentApi/agentLog/agentStats (the public agent API)
db_migrations/      numbered SQL migrations, applied with Supabase MCP apply_migration
shared/             types and zod schemas shared by app and server (types, pipeline, api, runs, corpus, catalog, flagship)
corpus/             manifest.json (tiered test set) and golden/ (hand-written statement lists)
tests/              vitest; tests/fixtures/latex/ holds the toy and downloaded sources
docs/               BRIEF.md, the v1 plan, storyboard and verification screenshots
```
