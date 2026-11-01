-- Atomic run counters (server/utils/runs.ts) and the agent trace high-water claim (outline-agent.ts ingestTrace).
-- Parallel fan-out steps, the sandbox callback and the poll step write the same run row at once; a client-side
-- read-modify-write would lose spend or clobber progress keys. Service role only.

-- runs.cost_usd += usd
create or replace function public.add_run_cost(p_run_id uuid, p_usd numeric)
returns void
language sql
set search_path = ''
as $$
  update public.runs set cost_usd = cost_usd + p_usd where id = p_run_id;
$$;

-- runs.progress = progress || patch (shallow merge; concurrent writers of different keys don't clobber each other)
create or replace function public.patch_run_progress(p_run_id uuid, p_patch jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.runs set progress = progress || p_patch where id = p_run_id;
$$;

-- runs.progress[key] += by (a missing key counts as 0)
create or replace function public.bump_run_progress(p_run_id uuid, p_key text, p_by numeric default 1)
returns void
language sql
set search_path = ''
as $$
  update public.runs
  set progress = jsonb_set(progress, array[p_key], to_jsonb(coalesce((progress ->> p_key)::numeric, 0) + p_by))
  where id = p_run_id;
$$;

-- Raises progress.agent_trace_seq / agent_cost_usd to at least the given maxima under a row lock and returns the
-- previous values, so of two concurrent deliveries only one logs a given line or adds a given dollar.
create or replace function public.claim_agent_trace(p_run_id uuid, p_max_seq integer, p_max_cost numeric)
returns table (seq integer, cost numeric)
language sql
set search_path = ''
as $$
  update public.runs r set progress = r.progress || jsonb_build_object(
    'agent_trace_seq', greatest(prev.seq, p_max_seq),
    'agent_cost_usd', greatest(prev.cost, p_max_cost))
  from (
    select coalesce((x.progress ->> 'agent_trace_seq')::integer, 0) as seq,
           coalesce((x.progress ->> 'agent_cost_usd')::numeric, 0) as cost
    from public.runs x where x.id = p_run_id for update
  ) prev
  where r.id = p_run_id
  returning prev.seq, prev.cost;
$$;

revoke execute on function public.add_run_cost(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.patch_run_progress(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.bump_run_progress(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.claim_agent_trace(uuid, integer, numeric) from public, anon, authenticated;
grant execute on function public.add_run_cost(uuid, numeric) to service_role;
grant execute on function public.patch_run_progress(uuid, jsonb) to service_role;
grant execute on function public.bump_run_progress(uuid, text, numeric) to service_role;
grant execute on function public.claim_agent_trace(uuid, integer, numeric) to service_role;
