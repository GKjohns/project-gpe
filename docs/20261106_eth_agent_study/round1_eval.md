# Round 1 evaluation: ETH learner (API-only, proofmap.ink `eth`)

Evaluator inputs: eth_learner_log.md, eth_understanding.md, the 68 saved API responses in this directory,
server/utils/mcpTools.ts + chatTools.ts, and live spot-checks against https://proofmap.ink/api/v1 (listed in section 3).

## 1. Understanding quality

**Theorem precision: 5/5.** The stated theorem matches `read_node?id=thm-main` (main_full_version.tex:73-85) exactly:
deterministic #k-CNF counting in (n+m)^{O_k(1)} 2^{O_k(n loglog n/sqrt(log n))} time, poly space, with the
2^{O_{k,D}(n/sqrt(log n))} bound when m <= Dn, n >= 20. The learner also caught that the abstract's
2^{n/(log n)^{1/2+o(1)}} is not what the theorem proves. Spot-check: the source (main_full_version.tex:89-91) itself
writes n(loglog n)^2/sqrt(log n) "= n/(log n)^{1/2+o(1)}", i.e. the paper treats polylog(log n) factors as
(log n)^{o(1)} with the sign of the o(1) wrong (loglog n = (log n)^{+o(1)}, so the exponent is 1/2 - o(1)). So the
discrepancy is a notational slip in the paper, not a lost sharper theorem. The learner could not settle this because
the source spells it `\frac12+o(1)` and the search normalizer does not map `\frac12` to `1/2` (see pain point 7).

**Architecture: 5/5.** Found the real engine (`thm-tensor-contraction`, novel, App. D.1/D.4) in call 7-9, confirmed
with two negative `trace` calls that body Sections 3-5 (two of the five novel nodes) are disconnected from thm-main,
reconstructed both proofs of thm-main (fixed density via the clause network; arbitrary density via sparsify +
parity checks + sparse-query), and located where the loglog comes from (s = n*nu in lem-tensor-sparse-query). The
8-step DAG in section 2 of the understanding is consistent with ancestors(thm-main) (46 nodes, 3 levels) and with the
claim LaTeX it read. It read LaTeX (read_node) for 16 nodes including every claim of thm-main and of
thm-tensor-contraction, and checked 6 plain summaries against LaTeX (all faithful). This is not a summary-level read.

**Weakest-point analysis: 4/5.** Three concrete suspects, ranked, each tied to a line range and an equation number:
(a) exactness of the recursion identity D.16 and the factorization over groups (D.4.5-D.4.6, ~484-529), (b) the
mode-budget count D.15 and the inherited-precision bound D.11, (c) whether packet-vertex entries satisfy the inductive
entry-time hypothesis. (a) and (b) are exactly the places the map's own `warn unresolved_ref` note points at, and the
learner went further: it reconstructed the taper/precision arithmetic from fragments and reported it self-consistent.
Not a 5 because it could not quote the suspect step's LaTeX in full (the API would not let it; see pain point 1) and
because (c) is asserted from a one-line proof fragment rather than from the construction.

**Honesty about limits: 5/5.** Section 5 lists exactly what could not be determined and what tool would have settled
each. The verdict ("much more likely wrong than right, but I could not exhibit a specific false step") is correctly
hedged. One honesty gap: the log claims 48 calls; the scratchpad holds 68 API response files plus llms.txt (27
search_paper, 16 read_node, 16 get_node incl. 1 deliberate bad id, 3 get_friction, 2 trace, 1 ancestors, 1 overview,
1 list_nodes, 1 family), so entry 28-41 logged "14 calls" for ~34 fetches, and read_node of
claim-lem-tensor-sparse-query-3/4/6 and get_node of claim-thm-tensor-contraction-1/2 were never logged. Undercount,
not fabrication, but the round-2 brief should demand one numbered line per call.

## 2. Efficiency

Actual calls by tool (from saved responses): search_paper 27, read_node 16, get_node 16, get_friction 3, trace 2,
ancestors 1, get_overview 1, list_nodes 1, families 1, llms.txt 1. Total 69 fetches (budget was 25-60).

- **Forced keyhole reads (API-side), ~25 calls:** 24 of the 27 searches were attempts to read D.4.3-D.4.6 prose through
  +-2-line windows ("w_Z", "mode tuple", "u_d", "tiles", "real columns", "source group", "child network", "packet
  vertex", "at most M/8 edges", "Z_{g,beta}", ...). Live check: sections D.4.5 and D.4.6 have 0 nodes, D.4 and D.4.1
  have 0, and the proof span of thm-tensor-contraction is quantitative-contraction.tex:560-619 while the identity's
  justification sits at ~431-530. No tool reads that range. A better agent could not have avoided this; a `read_source`
  or `read_section` would have replaced ~24 calls with 2-3.
- **Wasted / avoidable (agent-side), ~6 calls:** `get_friction?severity=high` (0 results; a histogram in the overview
  would make it unnecessary but the learner could also have pulled all 71 in one call), the two "1/2+o(1)" searches
  (would have hit with "o(1)" or "frac12"; the first was also unencoded `+`), `families/378` plus the re-read (the
  overview already carried `catalog.family.has_lean`), the deliberate bad-id probe (fine as an experiment, not as
  learning), and get_node calls on nodes it then also read_node'd (get_node + read_node pairs on
  thm-tensor-contraction, lem-sparsify, lem-tensor-integrality, lem-tapered-hermite: read_node carries uses/used_by,
  equations and statement, so get_node adds only explanation/classification/friction; for load-bearing nodes the
  learner needs both, so this is a minor cost).
- **Where a better-informed agent saves calls:** (i) read `equations` from read_node first: read_node of
  thm-tensor-contraction already returns the LaTeX of D.16, D.15 and D.11 (verified live), which the learner
  partly re-found by search; (ii) use `ancestors` once at depth 3 and `list_nodes?section=D.4.x` instead of
  inferring section coverage from the node list; (iii) search with the `file` field in hand (hits do carry `file`,
  see pain point 6). Realistic floor with the current API for this depth of understanding: ~40 calls; with a
  `read_source` tool: ~20.

## 3. Pain-point triage (A = API-side, G = agent-side, D = docs-side; "verified" = checked against the live API or code)

1. **Crux of the proof is unlabeled prose outside any node; readable only through +-2-line search windows.** A.
   Verified: D.4.5/D.4.6 have 0 nodes; search context is hard-coded to line-2..line+2 (chatTools.ts searchPaper);
   there is no range or section read. ~24 of 69 calls. The single biggest pain and the only one that limited the
   understanding rather than the call count.
2. **No "which nodes are load-bearing for X" view; ancestors returns flat levels without parent pointers.** A.
   Verified in depClosure: levels are `{depth, nodes[]}` only. Partly mitigated by trace, which the learner used well.
3. **main_results lists only root_ids; the novel engine theorem is absent.** A (+D). Verified: `main_results` = `root_ids`
   = [thm-main]; thm-tensor-contraction is used_by thm-main so it is never a root. The overview has `counts.novel: 5`
   but no list of novel ids; the learner had to pull list_nodes?limit=100 to find them. Cheap to fix.
4. **Friction is 71 notes with no histogram; 61 are long inferred_dep critiques.** A. Verified: 61 info/inferred_dep,
   6 info/structure_uncertain, 4 warn/unresolved_ref, 0 high. Overview exposes only the total. Cheap to fix; the
   4 warn notes were the useful ones and pointed straight at the crux.
5. **Classification inconsistency: thm-tensor-contraction's cite calls tapered-Hermite and integrality "the paper's
   new lemmas" while both nodes are `routine`.** A (digest content, not tool shape). Verified. Harmless for learning,
   but it is a map-quality signal the pipeline could lint (a node called "new" by a dependent's cite but classified
   routine).
6. **"Search hits have location: null and do not name their file."** G. Verified false: hits are
   `{file, line, section, node, part, context}`; `file` is always present. The learner jq'd a key that does not exist.
   What IS true (A): `node: null` for every prose line outside a node span, which is pain 1 again.
7. **"1/2+o(1)" returns 0 hits; `+` must be %2B-encoded; LaTeX punctuation normalized away.** Mixed. `+` encoding is
   plain URL semantics (D: one line in llms.txt). Zero hits even when encoded is because the source says `\frac12`
   (verified at main_full_version.tex:35, 91); normalizeForSearch strips `\ { } ^` but does not expand `\frac12` /
   `\tfrac12` to `1/2`. A small A fix; also G, since "o(1)" alone would have found it.
8. **Family endpoint uses camelCase (hasLean, pdfUrl), paper endpoints snake_case.** A, verified. Trivial fix, low value:
   the overview's `catalog` block already re-maps to snake_case, so an agent rarely needs /families directly.
9. **Lean status says nothing about scope.** A/upstream. The catalog only knows has_lean from the openai/math index;
   the API cannot say what is formalized. Only fixable by indexing the Lean README; out of scope for the tool layer.
10. **\eqref{eq:solution-count} unresolved in get_node, resolved only in read_node.** A, minor. get_node could include
    `equations` the same way read_node does (equationsIn is already a pure helper).
11. **Call-log undercount (48 logged vs 69 actual).** G/brief. Fix in the round-2 brief.

## 4. Top API changes, ranked by pain removed / effort (effort judged against mcpTools.ts + chatTools.ts)

1. **`read_source` — read a line range or a whole section of the LaTeX.** Removes pain 1, most of 6 and 7, and
   about a third of the round-1 calls.
   Shape: `GET /papers/<slug>/read_source?file=quantitative-contraction.tex&from=420&to=530` or
   `?section=D.4.5` (+ optional `offset` for paging). Returns `{file, from, to, section, text (numbered,
   comment-stripped lines, same "431| ..." format as read_node), nodes_in_range: [brief...], equations: [...],
   next_from?}`. Cap: 150 lines or READ_NODE_CHARS, whichever first; `section` resolves via digest.sections
   (file, line) to the span up to the next section in the same file. Also add `file`+`line` to `sections[]` in
   get_overview so an agent can go section -> read_source without search.
   Evidence: log 13-19, 20-27, 28-41, 42-47; understanding sections 3(a), 3(b), 5, 6.1.
   Effort: low (~40 lines: ChatSources already holds comment-stripped lines per file, spanText exists, sectionFor
   exists, nodeSpans gives nodes_in_range). Why not only "bigger search context": a window of +-10 still cannot
   read 110 contiguous lines, and the agent must still guess search terms. Why not only "digest nodes for unlabeled
   equations": that is the right long-term fix (item 6) but needs a pipeline change and a re-digest of every paper;
   read_source is the floor that makes any map navigable regardless of digest quality.

2. **`get_overview`: add `novel: [brief...]`, `friction_counts: {by_severity, by_kind}`, and
   `unmapped_sections` (sections with 0 nodes that fall inside some node's proof span or are
   named in a friction note).** Removes pains 3, 4 and half of 2.
   Shape: three new keys on the existing object; `main_results` unchanged (root_ids is the right definition) but add
   `engine: [...]` = novel non-root nodes that are in the ancestors of a root, which is exactly thm-tensor-contraction
   here. Effort: trivial (~15 lines in paperOverview; everything is a filter over digest.nodes). Evidence: log 2, 3,
   6, 7-9; understanding 6.3, 6.4.

3. **`ancestors`: return edges, not just levels.** Removes pain 2 and the need to guess which depth-2 node hangs
   off which depth-1 node.
   Shape: add `edges: [{from, to, kind: 'cited'|'inferred'|'claim of'}]` for every edge traversed (cap 200), and
   `roots` = nodes in the closure with no further support (the leaves of the proof). Optionally a `novel_only`
   filter. Effort: trivial (~15 lines in depClosure; linkKind already exists). Evidence: log 5; understanding 6.2.
   This is a cheaper substitute for a dedicated `load_bearing_path(thm)`: with edges + classification the agent can
   compute the novel spine itself in one call.

4. **`search_paper`: `context` (1-10 lines), `file` and `section` filters, `\frac12`/`\tfrac`/`\, ` normalization,
   and a `normalized_query` field in the output.** Removes pain 7, reduces pain 1 for one-off lookups.
   Shape: `?query=&max=&context=6&file=quantitative-contraction.tex&section=D.4.5`. Output adds
   `normalized_query` so an agent sees that "1/2+o(1)" became "1/2 o 1". Effort: low (~20 lines in searchPaper and
   normalizeForSearch). Evidence: log 42-48; understanding 6.7. Rank 4 not 1 because read_source removes more of the
   same pain.

5. **`get_node`: include `equations` (as read_node does) and `friction_count`; `list_nodes`: include
   `friction: n` per row.** Removes pains 10 and part of 4. Effort: trivial (equationsIn is a pure helper; two
   one-line additions). Evidence: log 4; understanding 6.4, 6.10.

6. **Digest-side: emit nodes (kind `claim`, parent = the theorem) for labeled equations whose justification is
   unlabeled prose, when a friction `unresolved_ref` names them.** This is what makes pain 1 disappear at the source:
   eq:tensor-recursion-identity, eq:tensor-partition-count and eq:tensor-precision-bound would become
   claim-thm-tensor-contraction-5..7 with spans covering D.4.5-D.4.6, so read_node reaches them and `node` on search
   hits stops being null. Effort: medium-high (pipeline outline step + re-run per paper; not in mcpTools.ts). Rank
   it as the follow-up once read_source shows what agents actually read.

7. **Cheap consistency fixes:** snake_case in /families (pain 8; trivial), `+`-encoding note and a "hits carry `file`"
   note in llms.txt (pains 6, 7; docs), and a pipeline lint that flags a node classified `routine` while a dependent's
   `classification_cite` calls it "new" (pain 5; small).

Not recommended: a `read_node` that accepts several ids (the learner's call pattern was one node at a time anyway and
outputs are already near the 12k cap); raising search `max` above 15 (the problem was window size, not hit count).
