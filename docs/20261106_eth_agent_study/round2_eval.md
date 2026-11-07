# Round 2 evaluation: ETH learner on sonnet (API-only, proofmap.ink `eth`)

Evaluator inputs: eth_learner_log_r2.md, eth_understanding_r2.md, the 40 files in r2_responses/, round1_eval.md,
eth_understanding.md (round 1), server/utils/mcpTools.ts + chatTools.ts, and live checks against
https://proofmap.ink/api/v1 saved under eval_r2_checks/ (ln.json, fr.json, rn_main.json, gn_main.json).

## 1. Grades (same rubric as round 1)

**Theorem precision: 5/5.** Statement matches read_node thm-main (main_full_version.tex:73-85) exactly: fixed k, n >= 20,
(n+m)^{O_k(1)} 2^{O_k(n loglog n/sqrt(log n))} bit ops, poly space, 2^{O_{k,D}(n/sqrt(log n))} when m <= Dn. Found the
abstract mismatch and, unlike round 1, settled it: it located the paper's own line 90-91 remark (log 37) and diagnosed
the o(1) sign slip, which is the conclusion the round-1 evaluator reached only by reading the repo. Better than round 1 on
this item, reached with "sqrt log n" instead of the symbolic query that failed in both rounds.

**Architecture: 4/5.** Found the engine (thm-tensor-contraction) by call 6-7; showed Sections 3-5 are not load-bearing
with one `ancestors?id=def-layout&direction=supports` call (log 40), a cheaper device than round 1's two traces; gave an
11-step chain with classifications and reasoned disagreements (tapered-hermite and tensor-integrality should be novel,
sparse-checks "routine" is generous). Read LaTeX for 17 nodes, verified two inductions by hand (greedy-hashes
(27/32)^n, insertion bound 4*3^{j-1}). Not a 5 because the inside of thm-tensor-contraction is a single opaque step
(round 1 decomposed it into packing / deformation / mode budget / recursion / taper / assembly, reading
lem-tensor-packets and D.13-D.16 fragments), and the general-density proof was read through claim-thm-main-5 only
(claims 3 and 4 were not read). One quibble: step 7 says the "wire count bound ... checks out", which is a fair
reading, but "sum leaf counts with sigma ~ 1/sqrt(log n)" in step 11 compresses the general-density assembly to one
line without the (n+1)-bit accumulator detail it had actually read.

**Weakest-point analysis: 4/5.** Three suspects with file:line and quotes. (1) The unlabeled D.4.5-D.4.6 recursion
(same crux as round 1, with the identity sentence quoted from a search hit). (2) New and sharper than anything in round
1: the per-depth edge shrinkage "M <= Cs 8^{-d}" at quantitative-contraction.tex:580-588 with the "or bounding the number
of nodes on each level in this way" hedge quoted; this is the geometric series the whole saving depends on, and the
learner correctly notes it saw the child-network edge count only through a 3-line fragment. (3) lem-sparse-checks is
a soft third: the learner admits it read the proof only superficially, so this is a gesture rather than a located
step. No attempt to reconstruct the taper/precision arithmetic from fragments as round 1 did. Same grade as round 1
for a different mix: less depth, one sharper target.

**Honesty: 5/5.** Log has exactly one line per call; 40 logged calls, 40 files in r2_responses/ (2 ancestors, 2
get_friction, 6 get_node, 17 read_node, 9 search_paper, 1 trace, 1 list_nodes, 1 overview, 1 llms.txt). Per-tool totals
in the log match the files. Section 5 names what it could not check and the call that would settle each. Verdict
hedged appropriately. The round-2 brief's logging rule fixed the round-1 undercount completely.

Call count: 40 (round 1: 69). Searches 9 vs 27; read_node 17 vs 16; get_node 6 vs 16. The drop is mostly fewer
keyhole searches into D.4.3-D.4.6 (7 vs ~24), which is exactly where round 2's depth is lower. Avoidable calls:
~3 (log 35 symbolic search, 36 abstract search, 30 severity=high; the last is docs-induced, see pain 5).

## 2. Consistency: round 1 (strong model) vs round 2 (sonnet)

| Item | Round 1 | Round 2 | Agree? | Explanation |
|---|---|---|---|---|
| Main theorem | thm-main, exact statement incl. m <= Dn case, n >= 20 | Same, exact | Yes | API: overview + read_node make this robust |
| Abstract vs theorem | Flagged mismatch, could not settle (symbolic search failed) | Flagged and settled via line 90-91 (sign slip) | Yes, R2 deeper | Model/strategy: R2 searched "sqrt log n" after the symbolic query failed; API search normalization failed both |
| Engine node | thm-tensor-contraction (novel, App D) | Same | Yes | API: get_node thm-main `uses` + classification makes it findable in 2-3 calls |
| Where loglog comes from | s = n*nu in lem-tensor-sparse-query | Same | Yes | API (read_node LaTeX) |
| Non-load-bearing | Secs 3-5 (two negative traces), corollaries, App C | Secs 3-5 + 6.4 (ancestors direction=supports), corollaries, App C | Yes | API: two different tools reach the same answer |
| Crux location | Unlabeled D.4.4-D.4.6 prose (eqs D.13-D.16), not a node | Same (eq:tensor-recursion-identity ~516, partition-count 457) | Yes | API: the warn friction note and search hits with `node: null` both point here |
| Internals of engine | 6-part decomposition (packets, deformation, modes, recursion, taper, assembly) | Single step; taper and integrality lemmas read, rest opaque | No | Model/strategy: R1 spent ~24 keyhole searches reconstructing; R2 spent 7. The API offers no cheaper route, so a less persistent agent gets less |
| Suspect steps | (a) D.16 identity + group factorization; (b) mode count D.15 + precision D.11; (c) packet-vertex entry-time hypothesis | (1) same as (a)/(b) combined; (2) M <= Cs 8^{-d} per-depth shrinkage at 580-588; (3) lem-sparse-checks | Partly | Overlap on the crux (API-driven: the warn note). R2's (2) is a genuine new target from reading the wrapper proof; R1's (c) and R2's (3) are each model-specific |
| Classification disagreements | tapered-hermite should be novel (paper's own cite says "new lemmas") | tapered-hermite and tensor-integrality should be novel; sparse-checks "routine" generous | Yes | API conveys the mismatch (classification_cite vs classification); both agents noticed |
| Verdict | "much more likely wrong than right, no specific false step" | "plausible but unverified, somewhat below even odds" | Same direction, R2 more generous | Model: R1 added the complexity-theoretic argument (theorem implies 2^{o(s)} for all bounded-arity #CSP), which R2 did not make. Not an API difference |
| Calls | 69 (27 search) | 40 (9 search) | - | Strategy: R2 stopped probing the crux sooner |

**Verdict on consistency:** the API conveys theorem, engine, dead sections, crux location and classification doubts
robustly across models. What varies with the model is depth inside the crux and how far the agent pushes the
verdict, and the API gives a weaker agent no lever to close that gap: both agents stalled at the same wall (unlabeled
prose readable only through +-2-line windows). Round-2 hypotheses: H1 refuted on the engine (sonnet found it as fast
as round 1) and on the negative traces (it ran an equivalent check); H2 refuted (17 nodes' LaTeX read, more than round
1); H3 confirmed for pains 1, 3, 4 (recur) and 6, 8, undercount (did not recur); pain 2 (ancestors edges) did NOT recur,
so it is demoted below. H4: sonnet read the warn friction (log 32) only after severity=high came back empty (log 30),
and it had already located the crux from the warn note surfaced inside get_node thm-tensor-contraction (log 7); so
get_node's inline friction is the channel that carried the crux, and the overview histogram is a convenience, not the
thing that hides it.

## 3. Pain triage, round 2 (A = API-side, G = agent-side, D = docs-side, P = digest pipeline; RECURS = seen in round 1)

1. **Core recursion has no node** (log 7, 13-17; und. 6.1). A/P. RECURS (R1 pain 1). Verified again: D.4.5/D.4.6 have 0
   nodes; search hits in 380-558 carry `node: null`. Strongest evidence in the experiment: both agents, both strategies.
2. **claim-thm-tensor-contraction-1 repeats the wrapper proof** (log 14; und. 6.2). P. New. Verified: its span is
   561-569 inside the 560-619 wrapper; all four claims of thm-tensor-contraction sit inside the wrapper and none covers
   the 380-558 argument. Same root cause as 1 seen from the claim side: claim granularity follows proof environments,
   not where the mathematics is.
3. **Search window is +-2 lines; D.4.5-D.4.6 not readable contiguously** (log 13, 15-19; und. 6.3). A. RECURS (R1 pain 1,
   ~24 calls; here 7 calls and the agent gave up sooner). Verified in chatTools searchPaper (hard-coded line-2..line+2).
4. **read_node thm-main returns only the fixed-density proof; the general-density proof (quantitative-reduction.tex
   ~317-369) is reachable only by reading each claim** (log 5, 31; und. 6.4). A. New. Verified live: `proof.location` =
   quantitative-reduction.tex:67-98; the skeleton holds one `proof` per statement (chatTools nodeSpans/scanSpans), so a
   second `\begin{proof}[Proof of Theorem ...]` is never linked; the `claims[]` briefs in read_node carry no location, so
   the agent cannot see that claim-thm-main-3..5 live at 317-369 without three more calls. Round 1 hit the same
   structure but read all five claims, so it did not register it as pain.
5. **get_friction?severity=high is empty; the real weak point is only `warn`** (log 30, 32; und. 6.5). D + A. Partly
   RECURS (R1 wasted the same call; R1 pain 4 = no histogram). Verified: 0 high, 4 warn, 67 info (round 1 counted 61+6
   info by kind; totals match 71). Newly identified cause: llms.txt's own endpoint example is
   `get_friction?severity=high` (mcpTools.ts:370), so the docs steer every agent into an empty call on this paper.
6. **list_nodes has no headline for any of 89 nodes** (log 3; und. 6.6). P + D. New. Verified: 0/89 rows carry the key;
   `brief()` only emits `headline` when the digest has one (mcpTools.ts:47), and eth's digest never got the annotate
   graph-labels pass. The tool description and llms.txt (line 129) promise "id, kind, name, headline, section,
   classification", so the docs over-promise. Round 1 did not complain because it used names and the claim-id naming
   convention, as round 2 also did.
7. **read_node: statement is a string, proof is an object** (log 6; und. 6.7). G (jq slip) with a D note: the shape is
   reasonable and documented by example, but llms.txt does not state it. Did not recur from round 1.
8. **Symbolic search zero hits; abstract text not searchable** (log 35, 36; und. 6.8). A + G. RECURS (R1 pain 7) for the
   normalization half: `1%2F2%2Bo(1)` was correctly encoded this time (so the `+`-encoding part of R1's pain was
   agent-side and did not recur) and still got 0 hits because the source spells `\frac12`. The abstract half is new:
   the catalog abstract is not in the searched corpus; a docs line ("search covers LaTeX source only; the abstract is in
   get_overview.catalog") or indexing the abstract would remove it.
9. **Classification labels disagree with substance** (log 11, 24; und. 6.9). P. RECURS (R1 pain 5). Both agents flagged
   tapered-hermite; round 2 added tensor-integrality and sparse-checks.
10. **Missing DAG edges (greedy-hashes -> sparse-checks is inferred, flagged by the map itself)** (log 23; und. 6.10).
    P. Mild RECUR (round 1 noted the same inferred edge in its architecture step 4 without calling it pain).
11. **Overview sections list is noisy: 36 of 68 sections have 0 nodes** (log 2). A. New. Verified from
    r2_responses/overview.json. Ties to change 2 (`unmapped_sections` or a `nodes>0` filter).
12. **ancestors interleaves claims and lemmas with no kind filter** (log 8). A, trivial. New. Round 1 wanted edges
    instead; neither complaint recurred in the other round, so both are low priority.
13. **classification_cite editorializes ("nothing prior gives one")** (log 4). P content, cosmetic.

Agent-side only (not pains of the API): skipping lem-tensor-packets and claim-thm-main-3/4; stopping keyhole reads at
7 searches; get_node+read_node pairs on 5 nodes (same minor cost as round 1).

## 4. Ranked API changes after two rounds

Recurring pains (1, 3, 5/4-histogram, 8-normalization, 9) are the strongest evidence; new round-2 pains 4, 6 and the
llms.txt example are cheap and certain.

1. **`read_source(file, from, to | section, offset)`** — CONFIRMED, rank unchanged. Shape as in round1_eval.md section 4
   (numbered comment-stripped lines, `nodes_in_range`, `equations`, 150-line cap, `section` resolves via
   digest.sections; add `file`/`line` to overview `sections[]`). Evidence: R1 log 13-47 (~24 calls); R2 log 13, 15-19
   and understanding section 5 bullet 1, which asks for exactly this ("read_node over a line range"), and 6.4 (the
   general-density proof at 317-369 is also a range read). Effort low (~40 lines; spanText, sectionFor, nodeSpans
   exist). Pain removed: 1, 3, 4, most of 8; the only change that would have let either agent verify the crux.
2. **`get_overview`: `novel[]`, `engine[]`, `friction_counts{by_severity,by_kind}`, `unmapped_sections[]`, and drop
   or flag zero-node sections in `sections[]`** — CONFIRMED, rank unchanged, scope widened by R2 pain 11. Evidence: R1
   log 2-3, 6-9; R2 log 2 (36/68 empty sections), 3 (had to pull list_nodes?limit=200 to find the 5 novel ids), 30
   (empty severity). Effort trivial (~20 lines in paperOverview). Pain removed: 5, 11, R1 pains 3-4.
3. **NEW: `read_node` multi-proof awareness** — `location` on each `claims[]` brief, and `proofs[]` (all proof
   environments whose `\begin{proof}[...]` names the label, or the hull of the claims' spans when it lies outside the
   first proof) with a note "proof continues at quantitative-reduction.tex:317-369". Evidence: R2 log 5, 31, und.
   6.4; R1 read all five claims (log entries for claim-thm-main-1..5) which is the 5-call workaround. Effort: claim
   `location` is one line in readNode (claims already resolve through `all.get(c.id).claim`); detecting a second proof
   env needs a regex over `\begin{proof}[Proof of ...\ref{label}]` in nodeSpans, ~20 lines. Pain removed: 4. Ranked
   above search changes because it is certain, cheap and affects every theorem proved in an appendix.
4. **`search_paper`: `context` 1-10, `file`/`section` filters, `\frac12`/`\tfrac`/`\dfrac` -> `1/2` normalization,
   `normalized_query` in output, and index the catalog abstract as a pseudo-file `abstract`** — CONFIRMED, abstract
   indexing added. Evidence: R1 log 42-48; R2 log 35, 36 (both zero-hit), 13-19 (window). Effort low (~25 lines).
   Pain removed: 8, part of 3.
5. **`ancestors`: `kind` filter (R2) and `edges[]`/`roots` (R1)** — DEMOTED from 3 to 5: neither complaint recurred.
   Evidence: R1 log 5; R2 log 8. Effort trivial. Pain removed: 12 and R1 pain 2.
6. **`get_node`: `equations`, `friction_count`; `list_nodes`: `friction` per row** — unchanged. Evidence R1 only.
7. **Digest-side (pipeline, not mcpTools.ts):**
   a. Emit claim nodes for labeled equations justified in unlabeled prose when an `unresolved_ref` friction names them
      (R1 change 6). Evidence now R1+R2 pains 1-2; R2 pain 2 shows the current claims of thm-tensor-contraction are
      all inside the 60-line wrapper and none inside the 180-line argument, so claim allocation should follow equation
      labels, not proof environments. Effort medium-high; the root fix.
   b. Run the annotate graph-labels pass on eth so `headline` is populated (R2 pain 6). Effort: a re-run, no code.
   c. Lint: node `routine` while a dependent's `classification_cite` says "new" (R1 pain 5, R2 pain 9).
   d. Lint: `classification_cite` phrases that assert rather than cite (R2 pain 13). Cosmetic.
8. **llms.txt-only fixes (zero code risk):** change the friction example from `severity=high` to no filter plus a
   sentence "severity counts for a paper are in get_overview" (once change 2 lands) or "most notes are info; warn is
   the useful tier" (now); state that `headline` is optional and absent for papers without a summary pass; note that
   `read_node.proof` is an object and covers only the first proof environment, with claims pointing to the rest; note
   `+` must be %2B-encoded and that hits always carry `file`; note that search covers LaTeX source only, not the
   catalog abstract. Evidence: R2 log 3, 5, 6, 30, 36; R1 log 42-47.

Not recommended, unchanged from round 1: multi-id read_node, search `max` > 15. Added: no MCP-transport work is
indicated by either round (the functions, not the transport, are the limit).
