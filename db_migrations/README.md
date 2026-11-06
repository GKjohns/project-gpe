# Proofmap database migrations

Numbered, forward-only SQL for the Supabase project `gpe` (ref `qnsjllrorhxmtfcoqlks`).
Files are `NNNN_snake_case_name.sql`, applied in order via the Supabase MCP
(`apply_migration`) — never by the app at runtime. Dev and production are the same project.

Every migration is written to be idempotent (`if not exists`, `on conflict do nothing`,
`create or replace`, `drop policy if exists` before `create policy`), so re-running one is a no-op.
Schema changes go in a **new** numbered file; never edit an applied one.

After a schema change, run MCP `get_advisors` (security and performance) and regenerate
`app/types/database.types.ts` with MCP `generate_typescript_types` — `@nuxtjs/supabase` reads it
for the `Database` generic (`#supabase/database`).

RLS is on for every table with no policies, and the `blobs` bucket is private with no storage
policies: the app reads and writes only through the service-role client, so the advisor's INFO
`rls_enabled_no_policy` findings are the intended state.
