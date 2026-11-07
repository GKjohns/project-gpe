# Round 3 evaluation: targeted depth test on the D.4.4-D.4.6 crux (strong model, 60 calls)

Evaluator inputs: eth_learner_log_r3.md, eth_understanding_r3.md, the 60 files in r3_responses/, round3_brief.md,
meta_tracker.md, server/utils/chatTools.ts + mcpTools.ts, and four live search calls saved under audit/live_*.json.
The audit script audit/coverage.py rebuilt quantitative-contraction.tex line by line from the saved responses
(audit/qc_reconstructed.txt) so every check below is against what the API actually returned, not against the
learner's quotes.

## 1. Coverage audit

Method: every search hit with `file == quantitative-contraction.tex` carries a context of up to five numbered lines
(`NNN| ` or `NNN> `); every read_node proof text carries numbered lines. Union of the line numbers:

| Range | Learner claimed | Recomputed | Note |
|---|---|---|---|
| 380-619 | 230 of 240 | 228 of 240 non-blank | 570 and 602 are blank lines that read_node omits; the learner counted them as seen because they fall inside the 560-619 span. Equivalent. |
| 380-559 (search only) | 170 of 180 | 170 of 180 | Exact. |
| 337-559 | 206 of 223 | 206 of 223 | Exact. |
| Unseen in 380-619 | 426-427, 450, 482, 534-539 | 426-427, 450, 482, 534-539 (+ blank 570, 602) | Exact. |

The learner's `## Coverage` list is accurate. Two cosmetic over-statements: it lists 112-171 and 250-336 as contiguous
verbatim, but the statement halves of lem-tensor-packets (125-130) and lem-tapered-hermite (253-269) came back as an
unnumbered `statement` string, so the line attribution there is inferred from `location`, not read off the response.
The text itself was returned verbatim, so this does not change what the learner could check.

Cost per line: 53 search calls recovered 170 of the 180 node-less lines 380-559, 3.2 lines per call. 33 of the 53
searches added at least one new line in that range; 20 added none. 4 searches (log 17 "child", 21 "theta", 24 "a_d",
39 "Taylor") returned no hit in quantitative-contraction.tex at all because the 15-hit cap is filled in file order by
main_full_version.tex; 7 searches hit the cap (log 11, 17, 20, 21, 24, 32, 39). Of 225 hits returned over the round,
122 were in the target file. The same 180 lines are two calls with a 150-line `read_source`.

## 2. Verification audit

For each item: are the cited lines really in the responses, does the argument follow from them, does the arithmetic hold.

### eq:tensor-precision-bound (D.11), learner: VERIFIED. Audit: VERIFIED, with two notes.

Lines 348-354, 357-367 are in the responses (log 5, 27, 43, 55); 355-356 are not. The learner's arithmetic holds:
`h = ceil(3M/u) <= 4M/u` (needs `M >= u`, which is line 101, seen); `D_t = 2^{a_d - i} >= 2^{a_d - u} = 2^{a_{d-1} + u}`
is correct because `a_d - a_{d-1} = 2u_d`; `a_d + 1 <= 1 + 4 epsilon lambda`; `2^u / u` dominates `lambda^{O(1)}` for
`u >= lambda^{4/5}`. The second assertion `p_t = O_C(M D_t / u)` therefore follows from the first.

Note 1. The first assertion (`p <= s lambda^{O(1)} 2^{a_{d-1}}`) is proved in the paper at 354-358, and the inductive
step is at 355-356, which the learner never saw. The learner supplied its own induction (increment at depth j is
`O_C(s 2^{a_j})`, sum over `O(log lambda)` depths). That induction is correct, but the VERIFIED tag should have said
"paper's lines FRAGMENT, verified by own argument". Tag honesty slip, not a mathematical one.

Note 2. The step `s lambda^{O(1)} <= M 2^u / u` uses `M > H` with `H = Theta(s / sqrt(lambda))`, which the learner
tagged INFERRED from the leaf cost at 593-594. A live search (`r=64`, 1 hit, quantitative-contraction.tex:81-83)
confirms `H = ceil(s / floor(sqrt(lambda)))`, `r = 64`, `epsilon = 1/(128*1024)`, `Delta = ceil(s^{9/10})`. The
inference was right. One call would have settled it; the learner had none left.

### eq:tensor-partition-count (D.15), learner: VERIFIED. Audit: VERIFIED.

Lines 443-449, 451-481 are in the responses (log 25, 33, 34, 10, 46, 47); 450 is not, but it is the middle of the
sentence "In the product of the affine factors [the coefficient of] Z^beta is divisible by 2^{sum w_Z beta_Z}", whose
two halves are both present. Rechecked:

- Generating function: `#{beta : sum w_Z beta_Z < p_t} <= e^{theta p_t} prod_Z (1 - e^{-theta w_Z})^{-1}`; with at
  most `6M/D` variables per weight `j >= 1` this is `exp(theta p_t + (6M/D) sum_{j>=1} -ln(1 - e^{-theta j}))`.
  Matches 465-466 exactly.
- `sum_j -ln(1 - e^{-theta j}) = sum_j sum_h e^{-theta j h}/h = sum_h 1/(h (e^{theta h} - 1)) <= (1/theta) sum_h 1/h^2`
  using `e^x - 1 >= x`. Matches 470-472.
- At `theta = sqrt(M/(D p_t))`: `theta p_t = sqrt(M p_t / D)` and `pi^2 M/(D theta) = pi^2 sqrt(M p_t / D)`, total
  `(1 + pi^2) sqrt(M p_t / D)`. Matches 458.
- With `p_t = O_C(M D_t / u)` and `D = D_t` (both are `L / 2^{v_2(t)}` for the same t): `sqrt(M p_t / D) = O(M / sqrt(u))`.
  Matches 459.
- Mode multiplicity: `<= 3M/L` packets, `2^{i+1}` tiles each (one per residue `y_0`), one mode per (packet, tile, b),
  so `<= (3M/L) 2^{i+1} = 6M/D` per weight. Matches 445.
- Divisibility `2^{w_Z}` of each mode coefficient: the b-th term of D.12 is `W_{x,y_0}(T)` (a factor of C cancelled,
  integral and even by lem-tensor-integrality since `y_0 - x != t`) times `(2^{i+1}/(T - y_0 + x))^b` with
  `v_2(T - y_0 + x) <= i`, so divisible by `2 * 2^b = 2^{b+1}`. Correct.

The learner tagged `y_0 - x in S` as INFERRED. It is not an inference: line 188 ("since `y - x in S`" for slots
`x, y in [0, L)`) plus `0 <= y_0 < 2^{i+1} <= L` gives it. Over-cautious tag, fine.

### eq:tensor-recursion-identity (D.16), learner: VERIFIED. Audit: VERIFIED.

Lines 387-425, 428-449, 451-481, 487-523 are in the responses; 426-427 are not (a remark about the b-th term, not
load-bearing). The paper's own justification is five lines (510-515). The learner's four-paragraph proof is its own,
and it is right:

- `W(t)` is local (395-399): `W_{xy}(t) != 0` only if `y - x = t`; adding a valuation-i integer flips bit i; bit i of
  the slot encodes orientation, so differing i-th bits mean equal symbols, hence same group.
- Each row form equals its local part plus `sum_Z c_{x,Z}(T) L_Z(X)` over the modes targeted at x's group in x's
  packet, where `c_{x,Z}` is the D.12 coefficient (depends on x, y_0, b) and `L_Z` collects `j^b X_y` over the tile.
  This is what 439-441 says.
- The formal variables of block (packet P, group g) are exactly the modes targeted at g in P; these sets are disjoint
  across blocks ("every mode has one target", 510), so the coefficient of `Z^beta` in the full product of affine
  factors is the product over blocks of restricted coefficients, each a function of the Y bits of rows in `g cap P`
  and the X bits of columns in `g cap P` (the local part). Each `L_Z(X)^{beta_Z}` depends only on columns of Z's
  source tile, which lie in source(Z) cap P ("one source", 510). Assign it to block (P, source(Z)).
- `A(Y) B(X)` is a product over vertices, each vertex in one group, so the sum over X, Y splits as a product over g
  of a sum over the bits of group g. That sum is the contraction of the bipartite network with the group-g vertices
  on one side and one vertex per packet on the other, joined to every retained port, whose tensor is 496-504. This
  is 487-494 verbatim.
- Mod `2^{p_t}` the truncation in D.12 and the omission of tuples with `sum w_Z beta_Z >= p_t` are both exact (428-429,
  451, 523).

I also checked that the coefficients live in `A_{p_t}`: `v_2(T - y_0 + x) = v_2(t - y_0 + x) <= i < a + 1 = v_2(alpha)`
for `zeta in O`, so `2^{i+1}/(T - y_0 + x)` is `2^{i+1-v}` times a unit inverse, as 429-430 says. No gap found.

### "M <= Cs 8^{-d}" (580; 92-96; 525-529), learner: VERIFIED conditional. Audit: downgraded to CONDITIONAL.

What is established on the text: a child's edges are the retained ports of the group-g vertices (490-493); item 3 of
lem-tensor-packets (statement read via read_node, log 41) bounds the real ports per side with a given symbol in a
given coordinate by `3M/r`, so a child has `<= 6M/r` edges; `6M/r = 3M/32` forces `r = 64` (confirmed live, line 82)
and `3M/32 < M/8`. The wrapper's `M <= Cs 8^{-d}` at 580 is therefore the d-fold iterate of a proved one-step bound,
not a bare assertion, which answers round 2's suspicion.

Why CONDITIONAL rather than VERIFIED:
1. The one-step bound holds only when lem-tensor-packets applies to the child, i.e. when `eq:tensor-packing-conditions`
   (D.6: `M >= 2 D_arr^2 Delta`, `M >= L D_arr`, `2L <= Delta`) hold at the child's depth. Lines 100-111
   (`eq:tensor-parameter-bounds`, the invariants that are supposed to guarantee this) were never returned beyond
   101. The learner's own arithmetic (`epsilon < 1/960` needed, `L <= s^{1/1000}` implies `epsilon <= 1/4000`) is
   right, and the live value `epsilon = 1/131072` satisfies it comfortably, but the paper's argument for the
   invariants was not read.
2. No round verified the proof of lem-tensor-packets (131-171). Round 3 read it verbatim and summarised it in one
   line (conditional-expectation labelling, `H_pad <= 3M/D_arr`, ports per symbol `<= H_pad D_arr / r`). Item 3 of
   that lemma is the single fact that produces the factor 8 shrinkage, and the lemma is classified `routine` by the
   map. The learner's VERIFIED on the shrinkage tacitly trusts it.
3. The learner's statement "the invariants used in eq:tensor-parameter-bounds hold inductively" is the paper's
   sentence (527-529), not a check.

The wrapper arithmetic the learner redid (branching `s^{O(1)} exp(O_C((s/sqrt(lambda)) (sqrt(2)/8)^d))` from
`M_d / sqrt(u_d) <= Cs 8^{-d} sqrt(2^d / (epsilon' lambda))`; `sum_d (sqrt(2)/8)^d < 2`; `s^{O(log lambda)} =
exp(O(lambda log lambda))`; depth `d <= log_2(lambda)/6 + O_C(1)` from `H < Cs 8^{-d}`) is correct.

One evaluator-side observation from the live parameters, outside the learner's brief: the invariant
`lambda^{4/5} <= u_0 = floor(epsilon lambda)` at line 101 needs `lambda^{1/5} >= 1/epsilon = 2^17`, i.e.
`lambda >= 2^85`, `s >= 2^(2^85)`. The theorem is asymptotic in a regime with no physical instances. That is normal
for results of this type and does not bear on correctness, but a reader should know the constants are of this size.

### Summary of downgrades

| Item | Learner | Audit |
|---|---|---|
| D.11 | VERIFIED | VERIFIED; paper's inductive step (355-356) is FRAGMENT, verified by the learner's own induction; H inferred (now confirmed live) |
| D.15 | VERIFIED | VERIFIED (all arithmetic rechecked) |
| D.16 | VERIFIED | VERIFIED (the learner's proof, not the paper's five lines, is what was verified; it is correct) |
| M <= Cs 8^{-d} | VERIFIED conditional | CONDITIONAL: one-step shrinkage proved from lem-tensor-packets item 3; induction rests on unread 100-111 and on an unverified routine lemma |

## 3. Grades (1-5)

| Dimension | Grade | Reason |
|---|---|---|
| Extraction completeness | 5 | 228 of 240 lines, recomputed from the raw responses; every claimed range checks; the 12 unseen lines are named. |
| Tag honesty | 4 | Reconstruction tags (FRAGMENT at steps 1, 4, 6, 8, 12) are exact. Two slips in the Verification section: D.11's VERIFIED should say "by own induction, paper's step unread"; the shrinkage VERIFIED is really CONDITIONAL, which the learner's own text concedes two lines later. One over-cautious INFERRED (S contains (-L, L)). |
| Verification rigor | 5 | Every arithmetic step rechecked and correct: the theta optimisation, the double-sum identity, the D cancellation, the 2^{w_Z} divisibility, the a_d - u = a_{d-1} + u identity, the 6M/r step, the (sqrt2/8)^d series, the depth bound. It also re-derived the D.10 valuation count (sum j^2/2^j = 6) from lem-tapered-hermite. Concrete, not gestures. |
| Verdict defensibility | 4 | "Four in five that D.4 proves exactly what thm-tensor-contraction states" is defensible for the three equations and the one-step shrinkage, which is what the brief asked. It is too wide as phrased: it covers lem-tensor-packets and the parameter invariants, which the learner read but did not verify, and it names the right passage to read next (100-111) while under-weighting the packing lemma. |
| Log accuracy | 5 | 60 numbered entries, 60 files in r3_responses/, every logged byte count equals the file size, per-tool totals match (53 search, 4 read_node, 1 overview, 1 friction, 1 llms.txt). |

## 4. The round-3 hypotheses

- H5 (at most half of 380-558 recovered in 60 calls): REFUTED. 170 of 180 (94 percent).
- H6 (can state the three equations but cannot verify the identity or the child-edge claim): REFUTED. The identity was
  verified; the child-edge step was proved one level and left conditional only on unread parameter lines.
- H7 (more than 70 percent of calls on search_paper, honest coverage): CONFIRMED. 53 of 60 (88 percent); coverage exact.

**Cost wall, not capability wall.** A strong agent reaches and verifies the crux through the GET API as it stands. The
price is 53 keyhole searches for 170 lines, 7 of them capped by file order, 4 returning nothing from the target file,
and about a third of the budget spent guessing two-line phrases from previous two-line windows ("feasible partial",
"any one weight", "kept unchanged", "unit inverses", log 44-47). Round 2's sonnet stopped after 7 such searches, which
is why the wall looked like a capability wall after two rounds: the cost is high enough that a weaker or less
persistent agent does not pay it.

**Implication for the ranking.** The tracker's pre-registered rule said a cost-wall result should promote the pipeline
fix (claim nodes for load-bearing unlabeled equations, change 7a) above `read_source`. Partly adopted: 7a moves from 7
to 2, because round 3 shows the digest already knew where the crux was (the warn note named the three labels and the
sections) and the only thing missing was a node to hang the span on. `read_source` stays at 1 for three reasons.
(1) It is the universal floor: it also fixes the second-proof problem of thm-main (round 2 pain 4), the unread
parameter block 100-111, and any passage a future digest fails to flag. (2) Its saving is now measured: 53 calls
become 2, and the four wasted and seven capped searches disappear with them. (3) Effort is about 40 lines in
chatTools.ts against a pipeline change plus a re-digest. The two are complements: read_source makes every map navigable
at the source level; 7a makes the crux discoverable through get_node, ancestors, trace and friction, and gives search
hits a `node`.

## 5. Round-3 pains, triaged (A = API, D = docs, P = pipeline, G = agent)

1. search_paper returns the first 15 hits in file order, no `offset`, no `file` or `section` filter (log 11, 17, 20,
   21, 24, 32, 39; und. 7.1, 7.7). A. Verified in searchPaper: `all.slice(0, limit)` over `src.order`. 7 of 60 calls.
   New in round 3 because round 3 was the first to search common words at scale.
2. No range read; 53 windows for 180 lines (log 3-60; und. 7.3). A. RECURS (R1 pain 1, R2 pain 3). The headline pain.
3. Equation bodies cut by the +-2 window (log 5, 15, 27, 31, 43, 49; und. 7.5). A. RECURS (R1). `context` parameter.
4. `read_node.equations[]` carries label, number and latex but no file:line (log 2; und. 7.4). A. New. 3 calls spent
   locating equations the agent already had the text of. equationsIn could resolve `\label{...}` to a line.
5. Punctuation-insensitive normalisation turns `u_d` into "u d" (79 hits) and `a_d` into 113 hits (log 20, 24; und.
   7.2). A. New. The exact-substring branch exists (`exact`) but normalised matching is OR-ed in, not opt-out.
6. D.4.5 and D.4.6 have zero nodes, so get_node, read_node, trace, ancestors are useless for the crux (log 7; und. 7.6).
   P. RECURS (R1, R2).
7. `total` reports hits the agent cannot page to (log 11, 17; und. 7.7). A. Same root as 1.

Agent-side: 20 of 53 searches added no new target line (redundant phrases, log 14, 16, 28, 29, 38, 40, 42, 53-55,
57), several avoidable by reading the already-returned context more carefully; `get_friction?severity=warn` (log 6)
re-confirmed what the brief had stated. Both small. No docs-side pain this round: the brief supplied the hints that
llms.txt lacks (hits carry file, labels are searchable, +-2 window), which is itself evidence for change 8.
