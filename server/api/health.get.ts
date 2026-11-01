import { must, useSupabase } from '../utils/supabase'

export default defineEventHandler(async () => {
  return {
    db: 'supabase',
    // supabase_migrations.schema_migrations isn't on the Data API; db_migrations/0004 exposes the count (service role).
    migrations: must(await useSupabase().rpc('applied_migration_count')),
    gateway: Boolean(process.env.AI_GATEWAY_API_KEY)
  }
})
