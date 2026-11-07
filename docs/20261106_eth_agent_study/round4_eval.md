# Round 4 evaluation: round 3's depth brief rerun against `read_source` (strong model, 60-call cap, 23 used)

Evaluator inputs: eth_learner_log_r4.md, eth_understanding_r4.md, the 23 files in r4_responses/, round3_eval.md (audit
method and the CONDITIONAL on M <= Cs 8^{-d}), the dev server at http://localhost:3120 (branch feat/read-source), and the
paper's source at tests/fixtures/latex/eth/quantitative-contraction.tex (619 lines), which let this audit check the
returned text for verbatim fidelity, not only for line coverage. The audit script is audit_r4/coverage_r4.py (adapted
from round 3's audit/coverage.py to parse read_source `text`); its reconstruction is audit_r4/qc_reconstructed_r4.txt.
Live checks are saved as audit_r4/live_D45.json and audit_r4/live_D47.json.

The brief was round 3's with the hints removed (no mention of read_source, no search tips), so tool discovery through
llms.txt was also under test.

## 1. Log accuracy

23 numbered log entries, 23 response files, every logged byte count equals the file size (01_llms.txt 14421 ...
23_src_D1.json 3120). Per-tool totals match the log: 6 read_source, 4 read_node, 7 get_node, 2 search_paper, 1
list_nodes, 1 get_overview, 1 get_friction, 1 llms.txt. Total response volume 136,063 bytes (133 KB), against round 3's
134 KB for 60 calls. The "source lines seen verbatim" column is accurate for every entry, including the three it marks
as duplicates (calls 10-12) and the cross-file proof location on call 13.

## 2. Coverage audit

Method: union of the `NNN| ` numbered lines in every read_source `text` with `file == quantitative-contraction.tex`,
every read_node proof or statement located in that file, and every search-hit context in that file. Then each
returned line was compared, comment-stripped, with the same line of the source file.

| Range | Learner claimed | Recomputed | Note |
|---|---|---|---|
| 380-619 | 240 of 240 | 224 line numbers of 240; the 16 absent (383, 386, 393, 401, 431, 448, 483, 486, 495, 509, 524, 543, 556, 559, 570, 602) are all blank in the source | 223 of 223 non-blank lines, all from read_source calls 5 and 6. The learner's "240/240 (all non-blank lines)" is right as stated. |
| 1-619 (whole file) | whole file | 577 of 619 line numbers; the 42 absent are all blank | 576 of 576 non-blank lines returned (line 530, blank, appeared only as search context). |
| Text fidelity | "verbatim" | 0 of 577 returned lines differ from the source after comment stripping | First round in which fidelity could be checked against the file rather than against the learner's quotes. |
| 73-172 (parameter block and packet lemma) | read | 95 of 100; the 5 absent are blank | Closes round 3's "never returned beyond line 101". |

Round 3's ten unseen non-blank lines (426-427, 450, 482, 534-539) are all present. Cost per line: 5 read_source calls
on this file returned 576 non-blank lines, 115 per call; round 3's 53 searches returned 170 of 180 target lines, 3.2
per call. The two search calls of round 4 were lookups (the network definition in quantitative-reduction.tex; the
three uses of eq:tensor-parameter-bounds), not window reads. Zero keyhole searches.

## 3. Verification audit

### M <= Cs 8^{-d}: round 3 CONDITIONAL, learner now VERIFIED. Audit: VERIFIED.

Round 3 left this conditional on two unread things: the parameter block 100-111 and the proof of lem-tensor-packets
(131-171). Both are now in the responses (call 7 covers 1-150, call 8 covers 151-300; call 10 duplicates 114-171). The
learner's argument was checked step by step against those lines:

- Child edge count. A child for group g keeps the ports of the group-g vertices on both sides (490-493). Item 3 of the
  lemma (167-170): in a fixed coordinate a given symbol occurs in exactly 1/r of the padded pair labels on either
  side, so its real ports are at most H_pad D_arr / r <= 3M/r. Two sides give 6M/r; r = 64 (82) gives 3M/32 < M/8
  (525-526). Follows.
- H_pad <= 3M/D_arr (156-158). H_pad <= M/D_arr + sqrt(2M Delta) + L (max load plus rounding up to a multiple of L).
  sqrt(2M Delta) <= M/D_arr is M >= 2 D_arr^2 Delta; L <= M/D_arr is M >= L D_arr; both are eq:tensor-packing-conditions
  (106-108). Follows.
- Second-moment bound E sum_gamma (X_gamma - M/D_arr)^2 <= 2M Delta (134-141). Expanding, the expectation equals the
  sum over ordered edge pairs of P[same pair label] - 1/D_arr. Four distinct endpoints with independent uniform labels
  in [r]^a give exactly 1/D_arr, contribution 0. Pairs sharing an endpoint number at most 2M Delta (each edge has at
  most Delta neighbours at each end, itself included) and contribute at most 1 each. Follows; derandomisation by
  conditional expectation (142-147) is standard and the per-step computation is polynomial as stated.
- Packet count H_pad D_arr / L <= 3M/L (166) and the slot-bit convention (159-165): with a' unequal coordinates, 2^{a'}
  orientation labels times 2^{a-a'} slots each make a packet of L = 2^a slots; H_pad divisible by L makes the
  partition exact. Follows.
- Degree. Old vertices keep their ports; a packet vertex is joined to the retained ports of one packet, at most L row
  plus L column ports, so <= 2L <= Delta (527; 108). Follows.
- Depth and parameter bounds (92-104). H < M <= Cs 8^{-d} gives 8^d < Cs/H <= C sqrt(lambda), so d <= log2(lambda)/6 +
  O_C(1). Then 2^d = O_C(lambda^{1/6}) gives u_d = floor(eps lambda / 2^d) = Theta_C(lambda / 2^d) >= lambda^{4/5};
  a_d = 2 sum u_j <= 4 eps lambda; L = 2^a <= (2s)^{4 eps}; D_arr = 2^{12a} <= (2s)^{48 eps} with 48 eps = 48/131072 <
  1/1000. Packing: 2 D_arr^2 Delta = O(s^{9/10 + 2/1000}) = o(H) < M; L D_arr <= s^{2/1000} < H; 2L <= Delta. The paper
  gives only the first of these ("the other inequalities follow in the same way", 110-111); the learner supplied the
  rest and the arithmetic is right.
- Induction. At depth d with H < M_d <= Cs 8^{-d}: the depth bound gives the parameter bounds, the parameter bounds give
  the packing conditions, the lemma applies to the current network, every child has <= M_d/8 <= Cs 8^{-(d+1)} edges and
  degree <= Delta. Root: M_0 <= Cs by hypothesis. Not circular. Follows.

Both conditions round 3 named are discharged on the text, so the upgrade stands. One honesty note, not a downgrade: the
lemma's proof is checked at the level of the paper's own sentences (the second-moment identity, the padding bound,
the packet partition); the learner's tag "VERIFIED (given lem-tensor-packets(3), read and checked)" is accurate.

### Re-check of eq:tensor-precision-bound (D.11): learner VERIFIED. Audit: VERIFIED, round 3's FRAGMENT note closed.

Round 3 saw 348-354 and 357-367 but not 355-356 and supplied its own induction for the first assertion. All of
348-368 are now in call 9. The paper's argument (354-358): root P0 <= Cs; along a path the increments are
8 h D_t + 8M(a+1) with h <= 4M/u, M <= Cs, D_t <= 2^{a_d}; sum over O(log lambda) depths. Rechecked: a depth-j call
passes p_t = p + 8hD_t + 8M(a+1) to its children with D_t <= 2^{a_j} and a_j <= a_{d-1} for j <= d-1, so the input
precision at depth d is at most Cs + d (32 Cs 2^{a_{d-1}}/u_j + 8Cs(4 eps lambda + 1)) = s lambda^{O(1)} 2^{a_{d-1}}
with d = O(log lambda). Matches the paper. Second assertion (359-366): q_t > 0 means i <= u-1, D_t = 2^{a_d - i} >=
2^{a_d - u} = 2^{a_{d-1} + u} since a_d - a_{d-1} = 2u_d; M > H >= s/sqrt(lambda) and u >= lambda^{4/5} make
s lambda^{O(1)} 2^{a_{d-1}} <= lambda^{O(1)} sqrt(lambda) (u/2^u) (M D_t / u) = o(M D_t / u); 8M(a+1) <= 8M(4 eps lambda
+ 1) = O(M D_t / u) because D_t / u >= 2^u / u; 8 h D_t <= 32 M D_t / u. All three pieces are O_C(M D_t / u). Matches
the learner's "p_t <= 34 M D_t / u for large s". Polynomial precision: 2^{a_d} <= (2s)^{4 eps}. VERIFIED on the paper's
own lines this time; round 3's "by own induction" caveat no longer applies.

### The learner's own flagged point: the orientation convention in (E1)(a)

The learner said the whole mode expansion depends on "different groups iff equal bit i" and that it would fail under
the opposite convention. Checked against 122-125 (item 2), 162-165 ("use one orientation convention throughout each
packet") and 394-404. An edge occupies the same slot at both ends (item 1), and bit i of the slot says which of the
packet's two symbols sits at the row end. So the row vertex at slot x has symbol sigma_{bit_i(x)} and the column
vertex at slot y has the other symbol, sigma_{1 - bit_i(y)}; they agree exactly when the bits differ. Different bits
means same group (local), equal bits means different groups (crossing), as the paper says at 402-404. The convention is
fixed by item 2 and is the same for every edge of the packet, so there is no "opposite convention" available. The
learner's reading is correct and the worry is closed.

### Summary

| Item | Round 3 audit | Round 4 learner | Round 4 audit |
|---|---|---|---|
| D.11 | VERIFIED; paper's inductive step FRAGMENT, verified by own induction | VERIFIED | VERIFIED on the paper's lines (354-368 all read) |
| D.15 | VERIFIED | VERIFIED | not re-audited; lines 443-482 now complete including 450 and 482 |
| D.16 | VERIFIED | VERIFIED | not re-audited; orientation point checked and closed |
| M <= Cs 8^{-d} | CONDITIONAL (100-111 unread; packet lemma unverified) | VERIFIED | VERIFIED; both conditions discharged |
| lem-tensor-packets proof | unverified, summarised in one line | checked (second moment, padding, partition, item 3) | checked, follows |
| Wrapper arithmetic 571-595 | correct | correct | correct (unchanged) |

No downgrades.

## 4. Grades (1-5)

| Dimension | Grade | Reason |
|---|---|---|
| Extraction completeness | 5 | Every non-blank line of the 619-line file returned, verbatim against the source; the target passage in two calls; context in three more. |
| Tag honesty | 5 | "No step is FRAGMENT or INFERRED" is true. The one caveat the learner did not state (the paper proves one packing inequality and says the rest follow in the same way) is marked "Checked" with the arithmetic shown, which is what the tag means. |
| Verification rigor | 5 | Round 3's two open conditions are discharged with explicit arithmetic (the 2M Delta count, the H_pad bound, the packing conditions from eps = 2^{-17}, the induction order). The taper lemma's valuation count (sum j^2/2^j = 6) and the generating-function bound are redone again. It also named the one point it wanted re-examined. |
| Verdict defensibility | 5 | "85-90 percent that D.4 is internally correct as a proof from its stated hypotheses" is scoped to what was read and verified, and it says where the remaining doubt lives (the reduction in D.2/D.3 and the hypotheses as instantiated). Round 3's verdict covered text it had not verified; this one does not. |
| Log accuracy | 5 | 23 of 23 files match to the byte; tool totals and the lines-seen column are exact. |

## 5. Round 3 versus round 4

Same brief (minus the hints), same model, same 60-call cap, API with and without read_source.

| | Round 3 (live API) | Round 4 (feat/read-source dev server) |
|---|---|---|
| Calls used | 60 of 60 | 23 of 60 |
| Calls per tool | 53 search_paper, 4 read_node, 1 get_overview, 1 get_friction, 1 llms.txt | 6 read_source, 4 read_node, 7 get_node, 2 search_paper, 1 list_nodes, 1 get_overview, 1 get_friction, 1 llms.txt |
| Keyhole searches (two-line windows) | 53 (20 added no new target line; 7 hit the 15-hit cap; 4 returned nothing from the target file) | 0 (2 searches, both lookups) |
| Lines of quantitative-contraction.tex 380-619 | 228 of 240 line numbers; 10 non-blank lines unseen | 223 of 223 non-blank lines; 0 unseen |
| Whole file | not attempted; 100-111 unread beyond 101; packet lemma proof read once | 576 of 576 non-blank lines, 0 text differences against the source |
| Holes | 426-427, 450, 482, 534-539 | none |
| Items verified / conditional | 3 verified (D.11 with a FRAGMENT caveat), 1 conditional | 4 verified, 0 conditional; packet lemma proof and wrapper arithmetic also checked |
| Found read_source unprompted | n/a (did not exist) | yes, from llms.txt at call 1; first used at call 5 after overview, friction and list_nodes |
| Redundant calls | ~20 searches, 1 friction | 3 read_node duplicates (10-12), 1 search (22), 1 friction (3): 5 of 23 |
| Response bytes | 134 KB | 133 KB |
| Posterior stated | "about four in five" that D.4 proves the theorem as stated | "85-90 percent" that D.4 is internally correct from its stated hypotheses; doubt moved to D.2/D.3 |

Measured effect of the change: 60 calls to 23 for a strictly larger and fully verbatim read; 53 window searches to 0;
the two round-3 holes that mattered (the parameter block and the packet lemma proof) closed; one CONDITIONAL became
VERIFIED. Response volume was unchanged, so the saving is in calls and in agent effort (no guessing of phrases), not in
bytes. Round 4 also used 37 fewer calls than the budget and did not spend them: with nothing unread in the file, it
stopped, which is the right behaviour.

## 6. Round-4 pains, triaged (A = API, D = docs, P = pipeline, G = agent)

The learner listed eight; the first three are the API-shaped ones, and two of those were fixed after the round.

1. get_overview sections carried `from: null, to: null`, so ranges had to be guessed (log 2; und. 7.1). A. FIXED.
   Live check: D.4.4 244-383, D.4.5 384-483, D.4.6 484-556, D.4.7 557 with `to` omitted (last section of its file);
   D.1 12-64, D.2 65-99, D.3 100 with `to` omitted. The saved 02_overview.json confirms the nulls at run time.
2. read_source labels a range by the section of its first line only ("D.4.4" for 380-529, which spans D.4.4-D.4.6;
   "D.4.6" for 530-619, mostly D.4.7) (log 5, 6; und. 7.2). A. REMAINS. Live: `section` for 380-529 is still
   "§D.4.4 Tapered Hermite recovery". Low cost now that sections carry `from`/`to`; a `sections: [...]` list of ids
   touched would close it.
3. No end-of-file indicator (log 6; und. 7.3). A. FIXED. Live: `file_lines: 619` on both section reads and on the
   380-529 range read.
4. list_nodes top-level key is `nodes`, read_source's is `nodes_in_range`, neither named in llms.txt (log 4; und. 7.4).
   D. One jq retry. Remains; one sentence in agentGuide.
5. Claim nodes have `statement_paper: null` and the text lives in `statement_plain`/`explanation` (log 15; und. 7.5).
   A (shape) + P (claims have no paper statement by construction). One jq retry. Remains; document it or fill
   `statement_paper` with the claim's span.
6. read_node duplicated text already in hand because get_node carries no line numbers (log 10-12; und. 7.6). A + G.
   Three calls. The API side is report item 5 (locations on briefs); the agent side is that `nodes_in_range` in the
   read_source responses already listed the nodes with their spans. Remains, small.
7. read_source drops blank lines, so the returned line count cannot confirm completeness (log 5; und. 7.7). A. Remains,
   cosmetic; `file_lines` plus contiguous numbering is enough for an audit, and blank lines carry no content. The
   evaluator's own coverage count has to treat blanks specially for the same reason.
8. The warn friction note cites D.4.4-D.4.6 for eq:tensor-precision-bound while the display is at line 349 in D.4.4
   proper (log 3; und. 7.8). P. Remains; a `file:line` on friction notes that name equation labels.

Net: of the three API-shaped pains, 1 and 3 are fixed and verified live; 2 remains and is small. Pains 4-7 are
one-retry shape and docs issues; 8 is pipeline. No pain cost more than three calls. There was no docs-side pain on
tool discovery: llms.txt's workflow step 4 ("when the text you need is outside any node ... call read_source") was
enough for the learner to plan the five range reads before its first search.

## 7. Where the doubt about the paper now sits

Inside quantitative-contraction.tex nothing is unread or unverified at the level of this audit: the three displays, the
child-edge shrinkage, the packet lemma, the taper lemma's valuation count, the precision bound and the wrapper
arithmetic all check. The residual doubt moves out of D.4:

- The reduction into the engine (D.2, D.3, lem-tensor-sparse-query, and thm-main's general case): do the networks it
  builds meet the hypotheses at quantitative-reduction.tex:27-40, in particular polynomially many vertices and the
  entry-time bound (s+L)^b 2^{A s^{9/10}}, at s = n loglog n? Round 2 checked the wire count and degree bound only.
- The hypotheses themselves as the proof uses them: the entry cost exp(O(L log s)) for packet tensors (531-542) is
  checked, but the claim that descriptions do not compose with depth (544-555) was read and accepted, not tested
  against a concrete depth-2 child.
- The prior. The theorem gives 2^{o(s)} deterministic exact contraction for every bounded-degree Boolean tensor network
  with linearly many edges. Four rounds have moved the evidence from "the crux is unreadable" to "D.4 is locally
  sound on a complete verbatim read". That still leaves the question of whether an error sits in the one file nobody
  has read end to end with the same care, quantitative-reduction.tex, or in the asymptotic regime (s >= 2^(2^85))
  where no instance can be checked.
