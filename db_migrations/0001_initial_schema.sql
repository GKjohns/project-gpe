-- GPE schema: the twelve tables of the Drizzle era (server/db/migrations/0000–0004), same names, types, defaults,
-- FKs and indexes, except `blobs` keeps only metadata (bytes live in the private Storage bucket `blobs`, 0002).
-- Added over Drizzle: btree indexes on the FK columns the app filters by (run_events, runs, sources, review_items,
-- source_assets.blob_sha), which PGlite never needed and the performance advisor flags.

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  authors text[] not null default '{}'::text[],
  source_kind text not null,
  source_ref text not null,
  tier text,
  digest jsonb,
  latest_run_id uuid,
  public boolean not null default false,
  -- Soft link to manuscripts.dir (no FK) so catalog sync and data import can run in any order.
  manuscript_dir text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint papers_slug_unique unique (slug)
);
create index if not exists papers_manuscript_idx on public.papers using btree (manuscript_dir);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  parent_run_id uuid,
  status text not null default 'queued',
  stage text,
  profile text not null,
  structure_method text not null,
  progress jsonb not null default '{}'::jsonb,
  metrics jsonb,
  budget_usd numeric not null,
  cost_usd numeric not null default 0,
  error text,
  agent_token text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists runs_paper_idx on public.runs using btree (paper_id);

create table if not exists public.run_events (
  id bigserial primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  ts timestamptz not null default now(),
  stage text not null,
  level text not null,
  message text not null,
  data jsonb
);
create index if not exists run_events_run_idx on public.run_events using btree (run_id, id);

create table if not exists public.stage_outputs (
  run_id uuid not null references public.runs (id) on delete cascade,
  stage text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint stage_outputs_run_id_stage_pk primary key (run_id, stage)
);

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  decision text,
  decided_at timestamptz
);
create index if not exists review_items_run_idx on public.review_items using btree (run_id);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  path text not null,
  content text not null,
  bytes integer not null
);
create index if not exists sources_paper_idx on public.sources using btree (paper_id);

-- Content-addressed (sha256 hex) metadata; the bytes are Storage object `blobs/<sha>`. A row is written only after
-- its object exists, so source_assets' FK always points at real bytes.
create table if not exists public.blobs (
  sha text primary key,
  content_type text not null,
  size integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.source_assets (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  path text not null,
  blob_sha text not null references public.blobs (sha),
  bytes integer not null
);
create index if not exists source_assets_paper_idx on public.source_assets using btree (paper_id);
create index if not exists source_assets_blob_idx on public.source_assets using btree (blob_sha);

create table if not exists public.agent_requests (
  id bigserial primary key,
  at timestamptz not null default now(),
  surface text not null,
  tool text,
  paper text,
  status integer not null,
  ms integer not null,
  client text not null,
  user_agent text,
  ip_hash text,
  ref text
);
create index if not exists agent_requests_at_idx on public.agent_requests using btree (at);

create table if not exists public.families (
  number integer primary key,
  title text not null,
  description text not null,
  discipline text not null,
  discipline_slug text not null,
  position integer not null,
  member_count integer not null,
  has_lean boolean not null default false,
  reasoning_trace text
);
create index if not exists families_discipline_idx on public.families using btree (discipline_slug);

create table if not exists public.manuscripts (
  dir text primary key,
  family_number integer not null references public.families (number),
  position integer not null,
  title text not null,
  abstract text not null,
  pdf_file text not null,
  published_on date,
  has_lean boolean not null default false
);
create index if not exists manuscripts_family_idx on public.manuscripts using btree (family_number);

create table if not exists public.catalog_meta (
  key text primary key,
  value jsonb not null
);

-- The app reads and writes only with the service-role key (bypasses RLS). RLS with no policies closes the Data API
-- to the anon/publishable key.
alter table public.papers enable row level security;
alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.stage_outputs enable row level security;
alter table public.review_items enable row level security;
alter table public.sources enable row level security;
alter table public.blobs enable row level security;
alter table public.source_assets enable row level security;
alter table public.agent_requests enable row level security;
alter table public.families enable row level security;
alter table public.manuscripts enable row level security;
alter table public.catalog_meta enable row level security;
