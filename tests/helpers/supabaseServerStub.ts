// `#supabase/server` in tests (vitest.config.ts alias). Tests must never reach the real project (dev and prod are one
// database), so any code path that would build the real client throws; inject a fake with setSupabase().
const refuse = () => {
  throw new Error('tests must inject a fake via setSupabase(createFakeSupabase().client)')
}

export const serverSupabaseServiceRole = refuse
export const serverSupabaseClient = refuse
export const serverSupabaseUser = refuse
export const serverSupabaseSession = refuse
