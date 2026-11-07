# Meta-tracker: can an outside agent learn the ETH paper through the Proofmap API?

Loop: fresh learner (API only, path log) -> evaluator (grades understanding + mines log for API pain) -> planner
(updates this file, writes next learner brief). Project code is untouched during the loop; rounds vary agent
strategy so API-side pain can be separated from agent-side pain.

## Standing questions
- Does the learner's stated theorem match across rounds (consistency = signal the API conveys it)? **Answered after
  round 2: yes.** Theorem, engine node, dead sections, crux location and classification doubts agree across models.
- Which pain points recur regardless of strategy? (API-side) Which vanish with a better brief? (agent-side)
  **Recur:** unlabeled crux outside any node; +-2-line search window; no friction histogram / severity=high trap;
  `\frac12` not normalized; routine-vs-"new" classification. **Vanished:** "hits lack file", `+` encoding, call-log
  undercount, ancestors-without-edges.
- Did the learner read LaTeX for load-bearing steps, or stop at summaries? Were summaries faithful? Both rounds read
  16-17 nodes' LaTeX; summaries checked faithful in round 1; round 2 found no unfaithful summary either.
- Can the API support depth on one step, not just breadth over the paper? Is the wall a cost problem or a capability
  problem? **Answered after round 3: cost wall.** A strong agent recovered 228 of 240 lines of the crux and verified
  the three equations in 60 calls, 53 of them +-2-line searches. Sonnet had stopped after 7 such searches in round 2.

## Round log

### Round 1 (2026-11-06) — open brief, strong model, GET endpoints. Files: eth_learner_log.md, eth_understanding.md, round1_eval.md
- **Theorem stated:** thm-main, deterministic #k-CNF counting in (n+m)^{O_k(1)} 2^{O_k(n loglog n/sqrt(log n))} time,
  poly space; 2^{O_{k,D}(n/sqrt(log n))} when m <= Dn; n >= 20. Verified against read_node LaTeX. Learner also flagged
  that the abstract's 2^{n/(log n)^{1/2+o(1)}} is weaker-than-stated; evaluator confirmed the paper itself equates the
  two at main_full_version.tex:89-91 (sign slip in the paper's o(1), not a lost theorem).
- **Engine found:** yes, thm-tensor-contraction (novel, App. D); body Secs 3-5 shown disconnected from thm-main via trace.
- **Grades (1-5):** theorem precision 5, architecture 5, weakest-point 4, honesty 5. Read LaTeX for 16 nodes; 6
  summaries checked, all faithful.
- **Calls:** 69 actual (27 search_paper, 16 read_node, 16 get_node, 3 get_friction, 2 trace, 1 ancestors, 1 overview,
  1 list_nodes, 1 family, 1 llms.txt). Log claimed 48: undercount in the batched entries. ~24 searches were keyhole
  reads of D.4.3-D.4.6 prose.
- **Top pain points:** (1) proof crux is unlabeled prose outside any node, readable only via +-2-line search windows
  [API]; (2) no load-bearing view; ancestors is flat levels without edges [API]; (3) main_results omits the novel
  engine theorem, no novel list in overview [API]; (4) 71 friction notes, no histogram [API]; (5) classification
  inconsistency (cite says "new lemma", node says routine) [API/digest]; (6) "hits lack file" [AGENT: hits carry
  `file`; learner jq'd a nonexistent key]; (7) `+` encoding [DOCS] and `\frac12` not normalized to 1/2 [API, small];
  (8) /families camelCase vs snake_case [API, trivial]; (9) Lean scope unknown [upstream]; (10) undercounted call log
  [AGENT/brief].

### Round 2 (2026-11-06) — same open brief, sonnet, GET endpoints. Files: eth_learner_log_r2.md, eth_understanding_r2.md, round2_eval.md, r2_responses/
- **Theorem stated:** identical to round 1 and exact against read_node. Went further on the abstract: found the
  paper's line 90-91 remark via `search_paper?query=sqrt log n` and diagnosed the o(1) sign slip itself.
- **Engine found:** yes, thm-tensor-contraction by call 6-7. Secs 3-5 (+6.4) shown non-load-bearing with one
  `ancestors?id=def-layout&direction=supports` call. 11-step chain; disagreed with routine labels on tapered-hermite,
  tensor-integrality, sparse-checks.
- **Grades (1-5):** theorem precision 5, architecture 4, weakest-point 4, honesty 5. Read LaTeX for 17 nodes; two
  inductions verified by hand. Lower depth inside the engine (no packets/modes/recursion decomposition); one sharper
  new suspect (per-depth edge shrinkage M <= Cs 8^{-d} at quantitative-contraction.tex:580-588).
- **Calls:** 40, log exact (one line per call, totals match r2_responses/). 9 search, 17 read_node, 6 get_node, 2
  ancestors, 2 friction, 1 trace, 1 list_nodes, 1 overview, 1 llms.txt. ~3 avoidable.
- **Hypotheses:** H1 (sonnet misses the engine / negative traces) refuted. H2 (reads < 8 nodes' LaTeX) refuted. H3
  confirmed: pains 1, 3-4, 7-normalization recur; 6, 8, undercount vanish; pain 2 (ancestors edges) did NOT recur, so
  it is demoted. H4: the crux reached sonnet through get_node's inline friction (log 7), not get_friction; the
  histogram is a convenience, not the gate.
- **New pains (verified live):** read_node thm-main returns only the first proof environment (67-98), the general
  proof at ~317-369 is reachable only by reading claims and claim briefs carry no location [API]; list_nodes has no
  `headline` on any of 89 rows though docs promise it (eth never got the graph-labels pass) [digest + docs];
  `get_friction?severity=high` is empty and is llms.txt's own example call [docs]; 36 of 68 overview sections have 0
  nodes [API]; claim-thm-tensor-contraction-1..4 all sit inside the 60-line wrapper proof, none inside the 180-line
  argument [digest]; abstract text is not searchable [API/docs].
- **Consistency verdict:** the API robustly conveys WHAT is claimed and WHERE the weak point is; it does not let any
  agent read the weak point. Model quality changed depth and the verdict's confidence, not the findings.

### Round 3 (2026-11-06) — targeted depth brief, strong model, GET endpoints, 60-call cap. Files: eth_learner_log_r3.md, eth_understanding_r3.md, round3_eval.md, r3_responses/
- **Task:** extract the unlabeled D.4.4-D.4.6 argument behind thm-tensor-contraction and verify or break
  eq:tensor-recursion-identity (D.16), eq:tensor-partition-count (D.15), eq:tensor-precision-bound (D.11) and the
  per-depth shrinkage M <= Cs 8^{-d}.
- **Coverage (audited from raw responses):** 228 of 240 non-blank lines of quantitative-contraction.tex 380-619; 170 of
  the 180 node-less lines 380-559 through 53 search windows (3.2 lines per call; 33 of 53 searches added a new line; 4
  returned nothing from the target file; 7 hit the 15-hit cap). Learner's coverage list exact.
- **Verification (audited):** D.15 VERIFIED, D.16 VERIFIED (the learner's own proof of the factorization is correct;
  the paper gives five lines), D.11 VERIFIED with the inductive step (355-356) unread and H inferred (confirmed live:
  H = ceil(s/floor(sqrt lambda)), r = 64, epsilon = 1/131072 at lines 81-83). Shrinkage downgraded from VERIFIED to
  CONDITIONAL: the one-step bound 6M/r = 3M/32 < M/8 follows from lem-tensor-packets item 3, but the induction rests
  on unread parameter invariants (100-111) and on a routine-classified lemma no round has verified.
- **Grades (1-5):** extraction 5, tag honesty 4, verification rigor 5, verdict defensibility 4, log accuracy 5 (60
  entries, 60 files, every byte count matches).
- **Verdict on the step:** goes through on the text read; posterior about four in five for the local step, which the
  evaluator accepts for the three equations and narrows for the whole appendix. Round 2's suspect (580-588) is
  resolved: the shrinkage is an iterated proved bound, not an assertion. Suspicion moves to lem-tensor-packets and
  the parameter block 100-111.
- **Hypotheses:** H5 refuted (94 percent coverage), H6 refuted (identity and child-edge step verified), H7 confirmed
  (88 percent of calls on search; coverage honest). => cost wall.
- **Calls:** 60: 53 search_paper, 4 read_node, 1 get_overview, 1 get_friction, 1 llms.txt. ~24 searches were windows
  guessed from previous windows; ~20 added no new target line.
- **New pains:** file-order 15-hit cap with no offset/file/section filter (7 calls lost); `equations[]` in read_node
  has no file:line (3 calls); punctuation-insensitive match makes `u_d`/`a_d` 79- and 113-hit queries; equation bodies
  cut by the window (D.12 took 3 calls, D.11 three). Recurring: no range read; zero nodes in D.4.5/D.4.6.

## Ranked API change candidates (after round 2; superseded by the final list below; shapes in round2_eval.md section 4)
1. `read_source(file, from, to | section, offset)`. Evidence R1+R2. API. Effort low (~40 lines). Only change that
   would let either agent verify the crux.
2. `get_overview`: `novel[]`, `engine[]`, `friction_counts`, `unmapped_sections`, zero-node sections flagged.
   Evidence R1+R2. API. Effort trivial.
3. NEW: `read_node` — `location` on claim briefs; `proofs[]` for theorems with a second `\begin{proof}[Proof of ...]`
   elsewhere. Evidence R2 (log 5, 31). API. Effort trivial-low.
4. `search_paper`: `context` 1-10, `file`/`section` filters, `\frac12` normalization, `normalized_query`, abstract
   indexed. Evidence R1+R2. API. Effort low.
5. `ancestors`: `kind` filter (R2), `edges[]`/`roots` (R1). Demoted: neither recurred. Effort trivial.
6. `get_node` `equations` + `friction_count`; `list_nodes` `friction` per row. Evidence R1. Effort trivial.
7. Digest pipeline: (a) claim nodes for labeled equations justified in unlabeled prose, allocated by equation label
   not proof environment (root fix for 1; R1+R2); (b) run graph-labels pass on eth for headlines (R2); (c) lint
   routine-vs-"new" cite (R1+R2); (d) lint editorializing cites (R2, cosmetic).
8. llms.txt only: friction example without `severity=high`; `headline` optional; `read_node.proof` is an object and
   first proof env only; `+` encoding and hits carry `file`; search excludes the abstract. Evidence R1+R2.

## Round 3 plan
- **Variation chosen: (a) targeted verification brief**, strong model (the round-1 model), unchanged GET API.
  The learner is told the two prior readers' consensus (crux = unlabeled recursion in Appendix D.4.4-D.4.6 behind
  thm-tensor-contraction) and asked to extract that argument as completely as the API allows and verify or break it.
- **Why not (b) or (c):** (b) MCP transport exposes the same functions; neither round's pain was transport-shaped.
  (c) a docs-workaround brief would recover ~3 calls in round 2 and ~6 in round 1 (the agent-side pains were small and
  mostly vanished on their own in round 2), so its information value is low and partly already answered by the
  consistency table. Leaking the engine's identity is no longer a cost: consistency is settled.
- **What (a) teaches:** whether the API's wall is a cost wall or a capability wall. Round 1 recovered a partial
  reconstruction with ~24 keyhole searches spread across the whole paper; round 2 stopped at 7. Nobody has spent a
  whole budget on the crux. The result sets the priority of change 1 against change 7a: if a dedicated 60-call effort
  still cannot read or verify the argument, read_source is a must; if it can, read_source is a 10x cost saving but the
  API is "deep enough, just slow", and the pipeline fix (claim nodes for the recursion) matters more. It also yields
  the first mathematical verdict on the step itself, which is what a mathematician using Proofmap actually wants.
- **Hypotheses:** H5 the learner recovers at most half of quantitative-contraction.tex ~380-558 as contiguous text in
  60 calls (search window +-2 lines, 15 hits max, no range read). H6 it can state eq:tensor-recursion-identity,
  eq:tensor-partition-count and eq:tensor-precision-bound verbatim (they are labeled, so a label search hits them)
  but cannot verify the identity's exactness or the "M <= Cs 8^{-d}" child-edge claim because the construction of the
  child networks (D.4.6, ~484-530) is unlabeled prose. H7 it spends > 70% of calls on search_paper and reports
  coverage honestly.
- **Confirm / refute:** H5+H6 confirmed (low coverage, no verdict) => capability wall; change 1 stays top, and the
  measured calls-per-recovered-line is the headline number for the write-up. H5 refuted (coverage > 80%) and a verdict
  reached => cost wall; promote change 7a above change 1 and record the call count as the read_source saving. Partial
  (high coverage, no verdict) => the mathematics itself is the obstacle, which is a finding about the paper, not the
  API, and the loop should stop here.
- **Metric added for round 3:** line coverage. The learner must list every source line range it saw verbatim; the
  evaluator computes coverage of 380-619 and calls per covered line.
- **After round 3:** implement changes 1-3 and 8, re-run the open brief on sonnet (round 2 is the baseline), compare
  calls and depth.

## Round 3 plan: executed as written (variation (a)). Outcome above. Loop closed 2026-11-06.

## Final ranked list (after three rounds; full shapes and effort in docs/20261106_eth_agent_study/report.md section 3)
1. `read_source(file, from, to | section)` — API, ~40 lines in chatTools.ts. Evidence all three rounds; round 3 measured
   the saving: 53 search calls for 170 lines become 2 calls. Also fixes the second-proof problem (R2) and the unread
   parameter block 100-111 (R3).
2. Pipeline: claim nodes for labeled equations justified in unlabeled prose, allocated by equation label (promoted from 7).
   Round 3 showed the digest already knew where the crux was (warn note names the three labels); only the node is
   missing. Makes the crux reachable through get_node/read_node/trace/ancestors and gives search hits a `node`.
3. `search_paper`: `file`/`section` filters, `offset`, `context` 1-10, `exact` mode, `\frac12` normalization, abstract
   indexed, `normalized_query`. Round 3 lost 7 of 60 calls to the file-order cap alone; R1/R2 lost 2-3 to normalization.
4. `get_overview`: `novel[]`, `engine[]`, `friction_counts`, `unmapped_sections[]`, flag zero-node sections. R1+R2.
5. `read_node`: `location` on `equations[]` (R3: 3 calls) and on `claims[]` briefs; `proofs[]` for theorems proved in a
   later proof environment (R2).
6. llms.txt: friction example without `severity=high`; `headline` optional; hits carry `file`; labels are searchable
   strings; +-2 window and 15-hit file-order cap stated; `+` is %2B; search excludes the abstract. R1-R3 (the round-3
   brief had to supply these hints itself).
7. `get_node`: `equations`, `friction_count`; `list_nodes`: `friction` per row. R1 only.
8. `ancestors`: `kind` filter, `edges[]`/`roots`. R1 and R2 each once, never recurred; R3 did not use ancestors at all.
Do not bother: multi-id read_node; search `max` above 15 (the fix is filters, not count); MCP transport work;
/families camelCase (R1 only); statement-string vs proof-object shape (jq slip); `+` encoding as an API change.

## Round 4 (2026-11-07) — round 3's depth brief, hints removed, against feat/read-source on localhost:3120. Files: eth_learner_log_r4.md, eth_understanding_r4.md, round4_eval.md
- **Variation:** the API changed for the first time. `read_source` (file+from/to or section id, 150 lines, next_from)
  plus `file`/`line` on overview sections. Same model and cap as round 3. The brief no longer named the tool or gave
  search hints, so discovery through llms.txt was also tested.
- **Outcome:** 23 of 60 calls (6 read_source, 4 read_node, 7 get_node, 2 search, 1 list_nodes, 1 overview, 1 friction,
  1 llms.txt). Zero keyhole searches. The learner found read_source in llms.txt at call 1 and planned five range reads
  from the overview before any search. Whole file quantitative-contraction.tex returned: 576 of 576 non-blank lines, 0
  differences from the source (checked against tests/fixtures/latex/eth). Target 380-619: 223 of 223 non-blank lines.
  Response volume 133 KB, flat against round 3's 134 KB.
- **Verification:** round 3's CONDITIONAL on M <= Cs 8^{-d} is VERIFIED: the parameter block 73-112 and the proof of
  lem-tensor-packets 131-171 were read and the argument (6M/r = 3M/32 < M/8 from item 3; H_pad <= 3M/D_arr from the
  packing conditions; the 2M Delta second-moment bound; depth <= log2(lambda)/6 + O(1); induction not circular) checks.
  D.11 verified on the paper's own lines 354-368 (round 3's FRAGMENT caveat closed). Orientation convention behind
  D.16 checked and holds. No downgrades. Grades 5/5/5/5/5.
- **Verdict:** 85-90 percent that D.4 is internally correct from its hypotheses. Residual doubt moves to the reduction
  (D.2, D.3, lem-tensor-sparse-query: vertex count and entry-time hypotheses at s = n loglog n), the descriptions
  paragraph 544-555, and the prior.
- **Pains:** overview from/to null [A, FIXED after the round, verified live]; no end-of-file flag [A, FIXED:
  `file_lines`]; range read labelled by first line's section only [A, remains, small]; top-level key names and
  claim-node field names undocumented [D]; get_node has no line numbers so 3 read_node calls duplicated text [A+G];
  blank lines dropped from numbered text [A, cosmetic]; friction note names sections not lines [P].
- **Ranking after round 4:** item 1 done. Remaining order unchanged: 2 pipeline claim nodes (+ file:line on friction
  notes), 3 search filters (still unimplemented; live `file=` ignored), 4 overview additions, 5 read_node claim
  locations/proofs (equation locations done), 6 llms.txt leftovers, 7 get_node equations, 8 ancestors. Next: round 2's
  open brief on Sonnet against the branch, then a depth brief on the reduction.
