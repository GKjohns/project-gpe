-- Read-side SQL PostgREST can't express (aggregates are off by default, and a client-side aggregate would hit the
-- 1000-row cap). Service role only.

-- Per-paper counts computed from the digest, so list pages never download 1–2 MB digests (agentApi.ts digestCounts).
create or replace view public.paper_digest_stats
with (security_invoker = true)
as
select
  p.id,
  p.slug,
  p.title,
  p.authors,
  p.source_ref,
  p.public,
  p.manuscript_dir,
  p.created_at,
  p.updated_at,
  p.digest is not null as has_digest,
  jsonb_array_length(p.digest -> 'nodes') as nodes,
  jsonb_array_length(p.digest -> 'sections') as sections,
  (select count(*) from jsonb_array_elements(p.digest -> 'nodes') n where n ->> 'classification' = 'novel')::integer as novel,
  (select coalesce(sum(jsonb_array_length(n -> 'friction')), 0) from jsonb_array_elements(p.digest -> 'nodes') n)::integer as friction,
  (p.digest -> 'render' ->> 'pages')::integer as pages,
  p.digest -> 'summary' ->> 'headline' as headline
from public.papers p;

revoke all on public.paper_digest_stats from public, anon, authenticated;
grant select on public.paper_digest_stats to service_role;

-- The operator readout of agent_requests (agentStats.ts): requests, unique callers (distinct ip_hash) and errors
-- (status >= 400) since now() - p_days, in total and by day (UTC, newest first, ≤ 366), surface, client, tool,
-- paper and ref (top 25 by requests). A null key reads '—'.
create or replace function public.agent_request_stats(p_days integer default 30)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with since as (
    select now() - make_interval(days => p_days) as at
  ),
  r as (
    select a.*, to_char(a.at at time zone 'UTC', 'YYYY-MM-DD') as day
    from public.agent_requests a, since
    where a.at >= since.at
  ),
  dims as (
    select d.dim, coalesce(d.key, '—') as key,
           count(*)::integer as requests,
           count(distinct d.ip_hash)::integer as callers,
           (count(*) filter (where d.status >= 400))::integer as errors
    from (
      select 'byDay' as dim, day as key, ip_hash, status from r
      union all select 'bySurface', surface, ip_hash, status from r
      union all select 'byClient', client, ip_hash, status from r
      union all select 'byTool', tool, ip_hash, status from r
      union all select 'byPaper', paper, ip_hash, status from r
      union all select 'byRef', ref, ip_hash, status from r
    ) d
    group by d.dim, coalesce(d.key, '—')
  ),
  ranked as (
    select dims.*,
           row_number() over (
             partition by dim
             order by case when dim = 'byDay' then key end desc, requests desc, key
           ) as rn
    from dims
  ),
  grouped as (
    select dim, jsonb_agg(
             jsonb_build_object('key', key, 'requests', requests, 'callers', callers, 'errors', errors) order by rn
           ) as rows
    from ranked
    where rn <= case when dim = 'byDay' then 366 else 25 end
    group by dim
  )
  select jsonb_build_object(
    'since', (select at from since),
    'total', (
      select jsonb_build_object(
        'key', 'total',
        'requests', count(*)::integer,
        'callers', count(distinct ip_hash)::integer,
        'errors', (count(*) filter (where status >= 400))::integer)
      from r
    ),
    'byDay', coalesce((select rows from grouped where dim = 'byDay'), '[]'::jsonb),
    'bySurface', coalesce((select rows from grouped where dim = 'bySurface'), '[]'::jsonb),
    'byClient', coalesce((select rows from grouped where dim = 'byClient'), '[]'::jsonb),
    'byTool', coalesce((select rows from grouped where dim = 'byTool'), '[]'::jsonb),
    'byPaper', coalesce((select rows from grouped where dim = 'byPaper'), '[]'::jsonb),
    'byRef', coalesce((select rows from grouped where dim = 'byRef'), '[]'::jsonb)
  );
$$;

-- For /api/health: how many migrations have been applied. supabase_migrations isn't exposed over the Data API, so
-- this reads it as the function owner.
create or replace function public.applied_migration_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from supabase_migrations.schema_migrations;
$$;

revoke execute on function public.agent_request_stats(integer) from public, anon, authenticated;
revoke execute on function public.applied_migration_count() from public, anon, authenticated;
grant execute on function public.agent_request_stats(integer) to service_role;
grant execute on function public.applied_migration_count() to service_role;
