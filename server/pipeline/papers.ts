// The paper reads the stages share (fetch, render, finalize want the row; annotate, classify, figures the title).
import { must, useSupabase } from '../utils/supabase'
import { paperRow } from '../utils/rows'
import type { PaperRow } from '../utils/rows'

export async function getPaper(paperId: string): Promise<PaperRow | undefined> {
  const row = must(await useSupabase().from('papers').select('*').eq('id', paperId).maybeSingle())
  return row ? paperRow(row) : undefined
}

export async function paperTitle(paperId: string): Promise<string | undefined> {
  const row = must(await useSupabase().from('papers').select('title').eq('id', paperId).maybeSingle())
  return row?.title
}
