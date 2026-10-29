// Contract: docs/20261029_digest_v1/implementation_plan.md § Stage payloads. Change the plan first.
import type { PaperSection, RunStage, StructureMethod } from './types'

export interface Skeleton {
  files: { path: string, lines: number }[]
  mainFile: string
  macros: Record<string, string>
  sections: PaperSection[]
  statements: {
    label: string
    env: string
    title?: string
    number?: string // best-effort display number ('3.4', 'A.2') from emulated \newtheorem counters
    sectionId: string
    file: string
    startLine: number
    endLine: number
    body: string
    proof?: { file: string, startLine: number, endLine: number, lines: number }
  }[]
  refs: { fromLabel: string, toLabel: string, file: string, line: number }[] // \ref inside a proof → edge
  unresolved: { fromLabel: string, target: string }[] // \ref to a label that is not a statement
}

export interface Outline {
  method: StructureMethod
  claims: {
    id: string
    parentLabel: string
    nameHint: string
    span: { file: string, startLine: number, endLine: number }
    restsOn: string[] // statement labels or claim ids
    confidence: number // 0–1
  }[]
  flags: { kind: 'unused_statement' | 'ref_to_nonstatement' | 'suspect_span' | 'possible_restatement' | 'other', label?: string, note: string }[]
  stats: { calls: number, tokens_in: number, tokens_out: number, cost_usd: number, wallclock_ms: number, turns?: number }
}

export interface CritiqueResult {
  fixes: { kind: 'merge' | 'split' | 'drop' | 'reparent' | 'add_edge' | 'remove_edge', target: string[], note: string, confidence: number }[]
  ok: boolean
}

// Proofs at or above this many lines get claims; both structure methods respect it.
export const CLAIM_PROOF_LINES = 60

// Additive to the contract: the canonical stage order, shared by the runner, run page and retry.
export const RUN_STAGES: readonly RunStage[] = ['fetch', 'chunk', 'outline', 'extract', 'resolve', 'critique', 'annotate', 'classify', 'finalize']

// Additive to the contract: the shape of runs.progress. Stages add their own counters.
export interface RunProgress {
  review_done?: boolean
  agent_finished?: boolean
  [counter: string]: number | boolean | string | undefined
}
