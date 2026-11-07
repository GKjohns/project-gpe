# Can an outside agent learn the ETH paper through the Proofmap API? Four rounds, one answer

Date: 2026-11-06, round 4 added 2026-11-07. Paper: `eth` (openai/math, a claimed refutation of the Exponential Time
Hypothesis). Surface under test for rounds 1-3: the public read-only GET API at https://proofmap.ink/api/v1 as
documented by https://proofmap.ink/llms.txt, with no project code changed. Round 4 reran round 3's brief against a dev
server on branch feat/read-source, which adds the `read_source` tool ranked first below (section 5). Supporting files
are in this directory: `meta_tracker.md` (the loop's running state), `round{1,2,3,4}_eval.md` (audits),
`eth_understanding*.md` (what each learner wrote), `eth_learner_log*.md` (one line per API call). Raw API responses
stayed in the scratchpad.

Status after four rounds: the crux of the paper (Appendix D.4) has been read end to end, verbatim, and verified at the
level of its own sentences. The API change that made that cost 23 calls instead of 60 is implemented. The remaining
doubt about the paper sits in the reduction (D.2, D.3), not in D.4.

## 1. What the agents learned about the paper

### The theorem

All three learners stated `thm-main` identically and exactly against the LaTeX (main_full_version.tex:73-85). Fix
k >= 2. There is a deterministic algorithm that counts the satisfying assignments of a k-CNF on n >= 20 variables and
m clauses in (n+m)^{O_k(1)} 2^{O_k(n loglog n / sqrt(log n))} bit operations and polynomial space; when m <= Dn the
time is (n+m)^{O_{k,D}(1)} 2^{O_{k,D}(n / sqrt(log n))}. Both exponents are o(n), so the theorem contradicts ETH.
Rounds 1 and 2 both noticed that the abstract's 2^{n/(log n)^{1/2+o(1)}} is not what is proved; round 2 found the
paper's own remark at lines 89-91 and diagnosed a sign slip in the o(1) (loglog n is (log n)^{+o(1)}, so the exponent
is 1/2 - o(1)). A front-matter error, not a lost theorem.

### The architecture

The engine is `thm-tensor-contraction` (Appendix D.1, proof in D.4, classified novel). Any bipartite Boolean tensor
network with at most Cs edges, poly(s) vertices, degree at most ceil(s^{9/10}), entries in (Z/2^{P0})[V]/(V^l)
computable in (s+L)^b 2^{A s^{9/10}} time, contracts deterministically in (s+L)^{O(1)} 2^{O(s / sqrt(log s))} bit
operations and polynomial space. The fixed-density case of thm-main is a two-paragraph corollary (a k-CNF is such a
network with O_k(n+m) edges). The general case goes through sparsification (App. A), expander-code parity checks and
greedy hashing (Sec. 6), and `lem-tensor-sparse-query` (D.3), which calls the engine at s = n loglog n; that is where
the loglog comes from. Every round found this chain and read its LaTeX (16, 17 and 4 nodes respectively; round 3 was
told the chain and asked to go deep).

### The dead body

Sections 3-5 and 6.4 (`def-layout`, `def-overview-measurement-structure`, `prop-count`, `thm-overview-sparse-polynomials`
and their lemmas, two of the five nodes the map calls novel) are disconnected from thm-main. Round 1 showed it with two
negative `trace` calls, round 2 with one `ancestors?direction=supports` call. They prove the older, weaker
n (loglog n)^2 / sqrt(log n) bound that the abstract's expression descends from. About half the 67 pages is a
superseded attempt left in the manuscript. All corollaries and Appendix C are also off the load-bearing path.

### The crux

The proof of thm-tensor-contraction in the source (quantitative-contraction.tex:560-619) is sixty lines of bookkeeping
that cite three equations: `eq:tensor-recursion-identity` (D.16), `eq:tensor-partition-count` (D.15) and
`eq:tensor-precision-bound` (D.11). The three are proved in unlabeled prose in Appendix D.4.4-D.4.6 (lines 337-558).
None of that prose is a node; subsections D.4.5 and D.4.6 have zero nodes; the four claim nodes of the theorem all
sit inside the sixty-line wrapper. The map's own `warn` friction note says exactly this. Both open-brief rounds found
the crux at the same place within a few calls (round 1 through the warn note and search hits with `node: null`,
round 2 through the friction surfaced inline by `get_node`). Neither could read it as a block.

### Three verdicts side by side

| | Round 1 (strong model, open brief) | Round 2 (Sonnet, open brief) | Round 3 (strong model, depth brief) |
|---|---|---|---|
| Theorem | exact | exact; settled the abstract slip | taken as given |
| Engine found | call 7-9 | call 6-7 | given |
| Crux located | D.4.4-D.4.6, eqs D.13-D.16, no node | same; identity at ~516, count at 457 | given |
| Crux read | ~24 keyhole searches, partial reconstruction | 7 searches, three fragments | 53 searches, 228 of 240 lines |
| Suspects | D.16 exactness; D.15/D.11 counting; packet-vertex entry cost | the crux; M <= Cs 8^{-d} at 580-588; lem-sparse-checks | none in the three equations; unread parameter block 100-111; 534-539 |
| Verdict | "much more likely wrong than right, no specific false step" | "plausible but unverified, somewhat below even odds" | "goes through on what I could read, about four in five" |

The three verdicts are not in conflict. Rounds 1 and 2 priced in the extraordinary claim and the unreadable crux.
Round 3 read the crux and found it sound locally; its posterior is about the step, not the paper.

### What round 3's audit supports and what it does not

Supports (rechecked line by line against the raw responses, `round3_eval.md` section 2):

- D.15 is a standard generating-function bound. #{beta : sum w_Z beta_Z < p_t} <= exp(theta p_t + (6M/D) sum_j
  -ln(1 - e^{-theta j})) for every theta > 0; the inner sum is sum_h 1/(h(e^{theta h} - 1)) <= pi^2/(6 theta); at
  theta = sqrt(M/(D p_t)) the bound is exp((1 + pi^2) sqrt(M p_t / D)); with p_t = O_C(M D_t / u) and D = D_t this is
  exp(O_C(M / sqrt(u))). The mode count 6M/D (3M/L packets, 2^{i+1} tiles each) and the 2^{w_Z} divisibility of every
  mode coefficient (one factor of 2 from integrality, b from (2^{i+1}/(T - y_0 + x))^b with v_2 <= i) both check.
- D.16 is a correct factorization. Within a packet whose two symbols in coordinate i differ, W(t) is local (a surviving
  pair y - x = t has different i-th bits, hence equal symbols); the crossing entries expand geometrically into modes
  Z = (packet, tile, b); each mode has one target group and one source group, so the formal variables of distinct
  (packet, target) blocks are disjoint, coefficient extraction factors over blocks, each L_Z(X)^{beta_Z} depends only
  on source-group columns, and A(Y)B(X) factors over vertices, each in one group. The sum over bits therefore splits
  into a product over the r groups of exactly the child contractions the paper defines at 487-504. The truncations
  (b + 1 < p_t, sum w_Z beta_Z < p_t) are exact modulo 2^{p_t}.
- D.11 holds given M >= u and u >= lambda^{4/5}: D_t >= 2^{a_{d-1} + u} because a_d - a_{d-1} = 2u_d, and 2^u / u
  dominates every fixed power of lambda, so the inherited precision and the 8M(a+1) term are both O_C(M D_t / u).
- The per-depth shrinkage doubted in round 2 is not an assertion. A child's edges are the retained ports of one
  symbol class; lem-tensor-packets item 3 bounds those by 3M/r per side; with r = 64 (forced by the paper's
  6M/r = 3M/32, confirmed by one live search at line 82) a child has fewer than M/8 edges. Iterated, M_d <= Cs 8^{-d}.

Does not support:

- The induction behind M <= Cs 8^{-d} needs the packing conditions D.6 (M >= 2 D_arr^2 Delta, M >= L D_arr, 2L <= Delta)
  at every active depth. The invariants meant to guarantee them (eq:tensor-parameter-bounds, lines 100-111) were
  never returned beyond line 101. The learner's own arithmetic says epsilon < 1/960 suffices and the live value is
  epsilon = 1/131072, so the numbers are compatible, but the paper's argument was not read.
- lem-tensor-packets itself. Item 3 of that lemma is the single fact that produces the factor 8, and it is classified
  routine. Round 3 read its proof (131-171) and summarised it in one line; no round verified it. After three rounds
  this lemma, not D.4.4-D.4.6, is the most load-bearing unaudited text in the paper.
- The packet-vertex entry cost (534-539 unread) and lem-tapered-hermite's valuation bound D.10 (re-derived by round 3
  at sketch level from the lemma's proof, which is a node and was read).
- Anything about the reduction into the engine beyond what round 2 checked (the wire count and degree bound in
  lem-tensor-sparse-query).

### What the API-only reading could and could not establish about the "slop" question

Established: the paper is not incoherent symbol-pushing. Its theorem is stated precisely, its parameter system
(u_d, a_d, L, D_arr, the taper q_t, p_t, the 6M/D mode count, the (sqrt2/8)^d series) is internally consistent when
redone by hand, three independent readers agree on what it claims and where the weight sits, every plain-English
summary checked against LaTeX was faithful, and the one step the map flags as unverifiable is, on the text, correct.
Also established: it carries the marks of an unedited machine draft. Half the manuscript proves a superseded result,
the abstract overstates the bound, the only novel mathematics is written as unlabeled prose that the main proof
"assembles", and the asymptotic regime is extreme (lambda^{4/5} <= floor(epsilon lambda) with epsilon = 2^{-17} needs
lambda >= 2^85, so s >= 2^(2^85)).

Not established: whether the theorem is true. The result implies 2^{o(s)} deterministic exact counting for every
bounded-degree Boolean tensor network with linearly many edges, which is far stronger than refuting ETH. A
complexity theorist's prior against that is strong, and three rounds moved the evidence from "the crux is unreadable"
to "the crux is locally sound and the remaining risk sits in a routine-labelled packing lemma and an unread parameter
block". That is progress on where to look, not a verdict on the paper. Nobody in this study held the whole chain in
one head, and the API as it stands made that expensive enough that nobody tried.

## 2. How the API performed

### Robust (every round, fast)

Theorem statement (get_overview + read_node, 2-3 calls). Engine identification (get_node thm-main `uses` plus
classification, 3 calls). Dead sections (trace or ancestors, 1-2 calls). Crux location (the warn friction note, inline
in get_node or via get_friction, 1 call). Classification doubts (classification_cite versus classification; all three
rounds flagged lem-tapered-hermite as mislabelled routine). Node LaTeX with line numbers (read_node, one call per
node, never truncated for this paper). These never varied with model or brief.

### What cost the most: keyhole reads

| Round | Total | search_paper | read_node | get_node | other | Calls spent reading node-less prose |
|---|---|---|---|---|---|---|
| 1 (strong, open) | 69 | 27 | 16 | 16 | 10 (3 friction, 2 trace, 1 ancestors, 1 overview, 1 list, 1 family, 1 llms) | ~24 |
| 2 (Sonnet, open) | 40 | 9 | 17 | 6 | 8 (2 ancestors, 2 friction, 1 trace, 1 list, 1 overview, 1 llms) | ~7 |
| 3 (strong, depth) | 60 | 53 | 4 | 0 | 3 (overview, friction, llms) | ~50 |

Response volume: 197 KB, 156 KB, 134 KB of JSON respectively. Round 3 recovered 170 of 180 node-less lines at 3.2
lines per search call; 33 of 53 searches added a new line, 4 returned nothing from the target file, 7 hit the 15-hit
cap. The same passage is two calls with a 150-line range read.

### What varied with model

Depth inside the crux and the confidence of the verdict. Sonnet found the engine and the crux as fast as the strong
model, read more nodes' LaTeX (17 versus 16), and settled the abstract slip that round 1 could not; it stopped
probing the crux after 7 searches where the strong model spent 24, and reached a more generous verdict. The API gave
the weaker agent no cheaper path, which is why two rounds looked like a capability wall and round 3 showed it was a
cost wall.

### Recurring pains, with evidence

| Pain | Rounds | Evidence | Side |
|---|---|---|---|
| Crux is unlabeled prose outside any node; readable only through +-2-line windows | 1, 2, 3 | r1 log 13-47; r2 log 13, 15-19; r3 log 3-60 (53 windows, 10 holes left) | API + pipeline |
| 15-hit cap filled in file order, no offset or file filter; common words return only main_full_version.tex | 3 | r3 log 17 ("child", 28 hits, 0 in target), 21, 24, 39 wasted; 11, 20, 32 mostly wasted | API |
| Equation bodies cut by the window | 1, 3 | r3 log 5, 15, 27, 31, 43, 49 (D.12 took 3 calls, D.11 three, eq:tensor-parameter-bounds still a fragment) | API |
| Search normalisation: `\frac12` not `1/2`; `u_d` matches "u d" (79 hits) | 1, 2, 3 | r1 log 42-47; r2 log 35; r3 log 20, 24 | API |
| read_node `equations[]` has latex but no file:line | 3 | r3 log 2 then 3-5 (three calls to locate text already in hand) | API |
| No novel list, no friction histogram, 36 of 68 sections have 0 nodes | 1, 2 | r1 log 2-3, 6-9; r2 log 2, 3, 30 | API |
| `get_friction?severity=high` is empty and is llms.txt's own example | 1, 2 | r1 log 6; r2 log 30; mcpTools.ts agentGuide endpoint list | docs |
| read_node thm-main returns only the first proof environment; general proof at 317-369 reachable only via claims, whose briefs carry no location | 2 | r2 log 5, 31 | API |
| list_nodes has no `headline` on any of 89 rows though docs promise it | 2 | r2 log 3 | pipeline + docs |
| Classification: cite says "the paper's new lemmas", node says routine | 1, 2 | r1 log 11; r2 log 11, 24 | pipeline |

Attribution over the three rounds: API-side pains dominate the call counts (the window, the cap, the missing range
read, the missing equation locations); pipeline-side pains dominate what the agents could not see at all (no node on
the crux, claims allocated by proof environment rather than by equation label, missing headlines, routine-versus-new
labels); docs-side pains cost one or two calls per round and vanish when a brief supplies the missing sentences, which
the round-3 brief had to do.

## 3. Ranked changes

Status: item 1 (`read_source`, with `file`/`from`/`to` on overview sections and `file_lines`) is implemented on
feat/read-source and measured in section 5. Items 5 and 6 are partly done on the same branch (equation locations in
read_node and read_source; the llms.txt sentences about `headline`, `%2B`, `proof_note` and the warn tier). Items 2,
3, 4, 7 and 8 are open. The re-ranked list is at the end of section 5. The text below is the round-3 list as written.

Effort is judged against `server/utils/chatTools.ts` (581 lines) and `server/utils/mcpTools.ts` (473 lines). All GET
and MCP surfaces share `PAPER_TOOLS` in mcpTools.ts, so one tool definition serves both; llms.txt is generated from the
same table by `agentGuide`, so new tools document themselves.

### 1. `read_source` (API). The change round 3 proved matters most.

Shape: `GET /papers/<slug>/read_source?file=quantitative-contraction.tex&from=380&to=559` or `?section=D.4.5`
(+ optional `offset` for paging). Returns `{file, from, to, section, text, nodes_in_range: [brief...], equations:
[{label, number, latex, line}], next_from?}` with `text` in read_node's numbered comment-stripped format
(`431| ...`). Cap 150 lines or READ_NODE_CHARS, whichever first. `section` resolves through `digest.sections`
(`file`, `line`) to the span up to the next section in the same file. Add `file` and `line` to `sections[]` in
get_overview so section -> read_source needs no search.
Pain removed: the keyhole read, every round (r1 ~24 calls, r2 ~7 and a shallower result, r3 53 calls and 10 holes);
the second-proof problem (r2 log 5, 31); the unread parameter block (r3 und. 6.1). Measured saving: 53 calls to 2.
Effort: low, ~40 lines. `spanText` (chatTools.ts:151), `sectionFor` (268), `nodeSpans` (105) and `equationsIn` (167)
already exist; add one `paperTool` entry to `PAPER_TOOLS` (mcpTools.ts:174) and one function in chatTools.ts.

### 2. Claim nodes for load-bearing unlabeled equations (pipeline).

Shape: in the digest outline step, when a friction note of kind `unresolved_ref` names equation labels, or when a
theorem's proof cites `\eqref{X}` whose `\label{X}` lies outside every node span, emit a `claim` node per equation
with parent = the theorem and span = the paragraph(s) justifying it (from the previous `\subsubsection` or blank-line
paragraph boundary to the equation's end). For eth this gives claim-thm-tensor-contraction-5..7 covering D.4.4-D.4.6.
Then re-digest. Allocate claims by equation label, not by proof environment (today all four claims of
thm-tensor-contraction sit inside the 60-line wrapper, r2 pain 2).
Pain removed: the crux becomes reachable through get_node, read_node, trace and ancestors; search hits inside it get a
`node`; the warn note can point at an id. Evidence r1 pain 1, r2 pains 1-2, r3 pain 6. Promoted from 7 to 2 because
round 3 showed the digest already knows where the crux is; only the node is missing.
Effort: medium-high. Pipeline code, not mcpTools.ts; needs a re-run per paper. Complements 1 rather than replacing it.

### 3. `search_paper` filters, paging, context, exact mode (API).

Shape: add `file` (string), `section` (section id), `offset` (int), `context` (1-10, default 2), `exact` (bool: only the
substring branch, skip normalisation), and return `normalized_query`. Normalise `\frac12`, `\tfrac12`, `\dfrac12` to
`1/2`. Index the catalog abstract as pseudo-file `abstract`.
Pain removed: r3 lost 7 of 60 calls to the file-order cap (log 17, 21, 24, 39 total losses; 11, 20, 32 partial) and
~6 to cut equation bodies (log 5, 15, 27, 31, 43, 49); r1 and r2 lost 2-3 each to normalisation (r1 42-47, r2 35-36);
`u_d` as a 79-hit query (r3 log 20).
Effort: low, ~30 lines in `searchPaper` (chatTools.ts:278-358): filter `src.order` by `file`, filter by `sectionFor`
range, `all.slice(offset, offset + limit)`, replace the hard-coded `line - 2 .. line + 2` at 342 with `context`, extend
`normalizeForSearch` (262), extend the zod input in mcpTools.ts:208-212.

### 4. `get_overview` additions (API).

Shape: `novel: [brief...]`, `engine: [brief...]` (novel non-root nodes in the ancestors of a root), `friction_counts:
{by_severity, by_kind}`, `unmapped_sections: [{id, title, file, line}]` for sections with 0 nodes that fall inside a
node's proof span or are named in a friction note; `nodes: 0` sections otherwise dropped or flagged.
Pain removed: r1 log 2-3, 6-9 (list_nodes?limit=100 to find 5 novel ids; severity=high empty); r2 log 2, 3, 30.
Effort: trivial, ~20 lines in `paperOverview` (mcpTools.ts:51-110); everything is a filter over `digest.nodes`.

### 5. `read_node` locations (API).

Shape: `equations[]` gains `file` and `line` (scan sources for `\label{X}`; cache per paper); `claims[]` briefs gain
`location`; add `proofs[]` listing every `\begin{proof}[Proof of ...\ref{label}]` for the node, with a `proof_note`
"proof continues at quantitative-reduction.tex:317-369".
Pain removed: r3 log 2 then 3-5 (3 calls); r2 log 5, 31 (thm-main's general proof invisible).
Effort: trivial to low. `equationsIn` (chatTools.ts:167) returns label/number/latex; claim `location` is one line in
`readNode` (182) since `all.get(c.id)` already resolves; a second-proof regex over `nodeSpans` is ~20 lines.

### 6. llms.txt fixes (docs; zero code risk).

In `agentGuide` (mcpTools.ts:349): change the example `get_friction?severity=high` (line 370) to no filter and say
"most notes are info; warn is the useful tier"; say `headline` is optional; say hits always carry `file`, LaTeX labels
are searchable strings, the context is +-2 lines and at most 15 hits in file order; say `+` must be %2B in a query
string; say search covers LaTeX source only, not the catalog abstract; say `read_node.proof` is an object and covers
the first proof environment. Evidence r1 log 6, 42-47; r2 log 3, 5, 6, 30, 36; the round-3 brief had to state four of
these hints itself and round 3 then had no docs-side pain.

### 7. `get_node` `equations` and `friction_count`; `list_nodes` `friction` per row (API).

Shape: reuse `equationsIn` in `getNode` (mcpTools.ts:127); add `friction_count: n.friction.length`; add `friction` to
each `listNodes` row (113). Pain removed: r1 log 4 (unresolved `\eqref` in get_node); part of the histogram pain.
Effort: trivial. Evidence round 1 only; kept because it is cheap.

### 8. `ancestors` `kind` filter and `edges[]`/`roots` (API).

Shape: optional `kind` filter; `edges: [{from, to, kind}]` capped at 200; `roots` = closure nodes with no further
support. Effort trivial in `depClosure` (chatTools.ts:449). Evidence r1 log 5, r2 log 8, each once; round 3 never
called ancestors. Lowest priority.

### Do not bother

- `+` URL-encoding as an API change: plain URL semantics; vanished in rounds 2 and 3 (one docs sentence, item 6).
- "Hits lack `file`": false; round 1 jq'd a nonexistent key.
- `read_node` taking several ids: every round read one node at a time and outputs sit near the 12k cap.
- Raising search `max` above 15: round 3 shows the loss is file order without filters, not hit count.
- MCP transport work: the GET and MCP surfaces share the same functions; no round's pain was transport-shaped.
- `/families` camelCase: round 1 only, never used again; the overview's `catalog` block already re-maps.
- `statement` is a string, `proof` an object: a jq slip in round 2, documented by example.
- get_node + read_node pairs on the same node: a minor, deliberate cost; read_node lacks explanation and classification.

## 4. Method notes

The loop: a fresh learner agent per round with no memory of earlier rounds, allowed only the public API and required
to keep a path log (one line per call: URL, reason, bytes, what it learned, lines seen verbatim, friction); an
evaluator that grades the understanding (theorem precision, architecture, weakest point, honesty), recomputes call
counts from the saved responses, verifies pains against the live API and the code, and triages each pain as API,
docs, pipeline or agent side; a planner that updates `meta_tracker.md` and writes the next brief. Project code was
untouched so that pains could be attributed to the API as deployed.

Variation per round and why. Round 1: strong model, open brief ("what does it prove, how, where is it weakest"),
budget 25-60 calls (used 69; the log undercounted to 48). Round 2: same open brief on Sonnet, with a one-line-per-call
logging rule, to separate API-side pains (recur) from agent-side pains (vanish); 40 calls, log exact. Round 3: strong
model, targeted depth brief that gave away the consensus crux and asked for extraction, coverage and a verdict in at
most 60 calls, to decide whether the wall was cost or capability; 60 calls, log exact to the byte. Pre-registered
decision rule: coverage under half and no verdict means capability wall and read_source stays first; coverage over
80 percent with a verdict means cost wall and the pipeline fix is promoted. Outcome: 94 percent coverage, verdict
reached, pipeline fix promoted to second; read_source kept first because the saving is now measured and it is the
universal floor.

Budgets. Calls: 69 / 40 / 60. Response bytes: 197 KB / 156 KB / 134 KB. Model tokens were not metered by the loop;
the learners were instructed to read responses with jq and head, so context cost tracked response bytes loosely.

Round 4, if the API changes. Implement items 1, 3, 5 and 6 (one afternoon against the two files named above), deploy
to a dev server, and rerun round 3's brief unchanged on both models with the same 60-call cap. Measure: calls to reach
228 of 240 lines (target under 10), the number of wasted searches (target 0), whether Sonnet now reaches a verdict on
the step, and whether either learner spends the freed budget on lem-tensor-packets and lines 100-111, which this
study leaves as the paper's most load-bearing unaudited text. Then rerun round 2's open brief on Sonnet as the
breadth baseline (40 calls, 7 keyhole searches) and compare depth inside the engine.

## 5. Round 4: the same brief with read_source

Round 3's depth brief was rerun on 2026-11-07 against a dev server (localhost:3120) running branch feat/read-source,
with the brief's hints removed so that the learner also had to find the new tool through llms.txt. Same model as
rounds 1 and 3, same 60-call cap. Audit in `round4_eval.md`; this time the returned text was also checked against the
paper's source file, line by line, not only against the learner's quotes.

### Round 3 versus round 4

| | Round 3 (live API) | Round 4 (feat/read-source) |
|---|---|---|
| Calls used | 60 of 60 | 23 of 60 |
| Calls per tool | 53 search_paper, 4 read_node, 1 overview, 1 friction, 1 llms.txt | 6 read_source, 4 read_node, 7 get_node, 2 search_paper, 1 list_nodes, 1 overview, 1 friction, 1 llms.txt |
| Keyhole searches | 53 (20 added nothing, 7 capped, 4 empty for the target file) | 0 |
| Lines 380-619 of quantitative-contraction.tex | 228 of 240 line numbers; 10 non-blank lines never seen | 223 of 223 non-blank lines |
| Whole file (619 lines) | not attempted; parameter block 100-111 unread beyond 101 | 576 of 576 non-blank lines, 0 differences from the source |
| Holes | 426-427, 450, 482, 534-539 | none |
| Verified / conditional | 3 verified (one with a FRAGMENT caveat), 1 conditional | 4 verified, 0 conditional; packet lemma proof also checked |
| Found read_source unprompted | did not exist | yes, from llms.txt at call 1; first used at call 5 |
| Redundant calls | about 21 | 5 (three read_node duplicates, one search, one friction) |
| Response bytes | 134 KB | 133 KB |
| Posterior on the step | about four in five | 85-90 percent that D.4 is internally correct from its hypotheses |

### What round 4 adds to the picture of the paper

The two things round 3 could not read are now read and checked. The parameter block (lines 73-112) states the
invariant H < M <= Cs 8^{-d}, the depth bound d <= log2(lambda)/6 + O_C(1), and the packing conditions D.6; the
learner derived the parameter bounds from the depth bound with the live constants (eps = 2^{-17}, so L <= (2s)^{4 eps}
and D_arr <= (2s)^{48 eps}, both under s^{1/1000}) and showed that the packing conditions follow, which the paper
asserts with one worked example. The proof of lem-tensor-packets (131-171) was checked sentence by sentence: the
second-moment identity E sum (X_gamma - M/D_arr)^2 <= 2M Delta (disjoint edge pairs contribute zero, at most 2M Delta
pairs share an endpoint), the padding bound H_pad <= 3M/D_arr from the two packing inequalities, the packet partition
by orientation bits, and item 3, 3M/r real ports per symbol per side. With that, the child-edge bound 6M/r = 3M/32 <
M/8 is a corollary and the induction M_d <= Cs 8^{-d} closes without circularity. Round 3's CONDITIONAL is VERIFIED.

The precision bound D.11 is now verified on the paper's own lines (354-368 complete), so round 3's "by own induction"
caveat is gone. The learner flagged one point for fresh eyes, the orientation convention behind "different groups
iff equal bit i"; the audit checked it against lemma item 2 and lines 394-404 and it holds, with no alternative
convention available. No downgrades this round.

Where the residual doubt moves. Nothing in quantitative-contraction.tex is now unread or unverified at the level of its
own sentences. The doubt that remains is about the paper, not the appendix, and it sits in three places. First, the
reduction into the engine (D.2, D.3, lem-tensor-sparse-query, the general case of thm-main): whether the networks it
builds meet the engine's hypotheses at quantitative-reduction.tex:27-40, in particular polynomially many vertices and
the entry-time bound, at s = n loglog n. Round 2 checked the wire count and the degree bound only, and no round has read
that file end to end. Second, the "descriptions are immutable, no composition with depth" paragraph (544-555), read and
accepted but not tested against a concrete depth-2 child. Third, the prior: 2^{o(s)} deterministic exact contraction
for every bounded-degree Boolean tensor network with linearly many edges is a very strong statement, and the regime
in which the constants work (s >= 2^(2^85)) admits no instance check. Four rounds have moved the evidence from "the
crux is unreadable" to "the crux is locally sound on a complete verbatim read". The next brief is the reduction.

### Measured effect of the change

60 calls to 23 for a strictly larger read (the whole file instead of 228 of 240 lines of one passage), 53 window
searches to 0, both round-3 holes that mattered closed, one conditional item verified. Response volume was flat (134
KB to 133 KB), so the saving is in calls and in agent effort, not in bytes: a range read returns about 115 non-blank
lines per call against 3.2 for a window search. The learner planned the five range reads from the overview before its
first search, which is the behaviour llms.txt's workflow step 4 asks for. It then stopped 37 calls under budget because
nothing in the file was left to read.

### Fixed after round 4

Two of the learner's three API-shaped pains were fixed on the branch after the round and verified live on
localhost:3120. Overview sections now carry `from` and `to` (`to` omitted for the last section of a file): D.4.5 is
384-483, D.4.7 is 557 to end, D.1 is 12-64. read_source responses carry `file_lines` (619 for
quantitative-contraction.tex) on both section and range reads, so the end of a file no longer has to be inferred. The
third, a range read labelled by the section of its first line only (380-529 says "D.4.4"), remains and is small now
that sections have bounds. The other five pains cost one retry each (top-level key names, claim-node field names, no
line numbers on get_node, blank lines dropped from the numbered text, a friction note without a line number).

### Remaining changes, re-ranked

1. Done: `read_source` with section and range reads, `file`/`from`/`to` on overview sections, `file_lines`, equation
   locations in read_source. Measured above.
2. Pipeline: claim nodes for load-bearing unlabeled equations, allocated by equation label (old item 2). Still the
   only change that makes the crux reachable through get_node, trace, ancestors and search `node`; round 4 still had
   to find it through the warn note and section ids. Add a `file:line` to friction notes that name labels (round-4
   pain 8).
3. `search_paper` filters, `offset`, `context`, `exact`, `\frac12` normalisation (old item 3). Unchanged on the branch
   (a live `file=` parameter is ignored). Less urgent now that range reads exist, but round 3's seven capped calls
   would recur for any agent that searches first.
4. `get_overview` additions: `novel[]`, `engine[]`, `friction_counts`, `unmapped_sections` (old item 4). Unchanged.
5. `read_node` locations on `claims[]` briefs and `proofs[]` (old item 5, half done: `equations[]` now carry
   file:line). Round-4 pain 6 (three duplicate read_node calls) is the claims half.
6. llms.txt (old item 6, mostly done). Still missing: the top-level keys `nodes` and `nodes_in_range`, the claim-node
   field names, that read_source drops blank lines and that `section` names the first line's section (round-4 pains
   2, 4, 5, 7).
7. `get_node` `equations` and `friction_count`; `list_nodes` `friction` per row (old item 7). Unchanged.
8. `ancestors` `kind` filter and `edges[]` (old item 8). Unchanged, lowest.

Next round, when the loop resumes: round 2's open brief on Sonnet against the branch (the breadth baseline, 40 calls)
to see whether the weaker model now reaches the crux with range reads; then a depth brief on the reduction
(quantitative-reduction.tex, D.2 and D.3, lem-tensor-sparse-query) checked against the engine's hypothesis list, which
is where this study leaves the paper's doubt.
