# ETH paper, round 3: the D.4.4-D.4.6 step behind thm-tensor-contraction

Everything below comes from the proofmap.ink API (60 calls, logged in `eth_learner_log_r3.md`). All file:line
references are to `quantitative-contraction.tex` unless stated. "VERBATIM" means I read the LaTeX in an API
response; "FRAGMENT" means only part of the passage; "INFERRED" means I filled it in.

## 1. The step under test

**The three equations (all VERBATIM, from search_paper contexts and the `equations` list of read_node):**

- `eq:tensor-recursion-identity` (D.16), lines 516-521, section D.4.6, no node:
  ```
  F(t+\alpha\zeta)
    =\sum_{\beta:\,\sum w_Z\beta_Z<p_t}
                        \prod_{g=1}^r Z_{g,\beta}
                   \pmod {2^{p_t}},
  ```
  "where $Z_{g,\beta}$ is the contraction of the child just defined. The omitted monomials vanish by their
  coefficient divisibility." (522-523)
- `eq:tensor-partition-count` (D.15), lines 457-459, section D.4.5: "The number of these tuples is"
  ```
  \exp\bigl(O(\sqrt{Mp_t/D})\bigr)
        =\exp\bigl(O_C(M/\sqrt u)\bigr).
  ```
- `eq:tensor-precision-bound` (D.11), lines 349-353, section D.4.4: "The input and child precisions satisfy"
  ```
  p\le s\lambda^{O(1)}2^{a_{d-1}},
  \qquad
  p_t=O_C(MD_t/u).
  ```

**Objects** (lines where I read them):

- Parameters at an active call at depth d (86-90, VERBATIM, `eq:tensor-parameters`):
  `u=u_d=\lfloor\varepsilon\lambda/2^d\rfloor`, `a=a_d=2\sum_{j=0}^d u_j`, `a_{-1}=0`, `L=2^a`,
  `D_{\rm arr}=r^{2a}`. Invariants (`eq:tensor-parameter-bounds`, 99-101, FRAGMENT): `u=\Theta_C(\lambda/2^d)`,
  `\lambda^{4/5}\le u\le M`, rest unseen. The promise at 92-96 (VERBATIM): "We will arrange that every child has
  at most $M/8$ edges and maximum degree at most $\Delta$. These assertions imply, on every active path,
  $H<M\le Cs\,8^{-d}$, $d\le\frac{\log_2\lambda}{6}+O_C(1)$." INFERRED: `\lambda=\log s`
  (quantitative-reduction.tex:62 says `u=\Theta((\log s)/2^d)`), `H=\Theta(s/\sqrt\lambda)` (from the leaf cost
  `\exp(O_C(H))=\exp(O_{C,A}(s/\sqrt\lambda))`, 593-594), `r=64` (from `6M/r=3M/32`, 526).
- M = edges of the current network, each with a row port and a column port; `\Delta` = degree bound.
- Packets (lem-tensor-packets, 114-130, VERBATIM): vertices on each side labeled by `[r]^a`; edges embedded in
  at most `3M/L` packets of `L` slots, same slot at both ends; per packet and coordinate the unordered pair of
  row/column symbols is fixed, and when they differ bit i of the slot number gives the orientation in
  coordinate i; for every coordinate and symbol at most `3M/r` real ports on each side belong to vertices with
  that symbol. Conditions (`eq:tensor-packing-conditions`, D.6): `M\ge2D_{\rm arr}^2\Delta, M\ge LD_{\rm arr},
  2L\le\Delta`.
- Grid S: a complete residue system modulo `2^{a+1}` (214) whose nonzero differences have valuation at most a;
  `\alpha=2^{a+1}` and `\mathcal C(T)=\prod_{t\in S}(T-t)` (180). INFERRED: S contains every `y-x` for slots
  `x,y\in[0,L)` ("since $y-x\in S$", 188), so `S\supseteq(-L,L)`.
- W (D.7, 183-185): within a packet, `W_{xy}(T)=\mathcal C(T)/(\mathcal C'(0)(T-(y-x)))`, a polynomial of degree
  `2L-1`; zero between packets; `W(0)=I` (189-191).
- The deformation F(T) (D.8, 197-199): `F(T)=\sum_{X,Y\in\{0,1\}^M}A(Y)B(X)\prod_{\text{row ports }x}
  l_{Y_x}((W(T)X)_x)` with `l_0(z)=1-z, l_1(z)=z`; degree at most `M(2L-1)`; F(0) is the contraction.
  lem-tensor-integrality (206-212): `W(t+\alpha z)\in\mathcal O[z]`, `F(t+\alpha z)\in\mathcal A[z]` for all
  `t\in S`, and `W_{xy}(t+\alpha\zeta)\bmod2^p` is computable in poly(s,p) bit operations.
- Taper (lem-tapered-hermite, 250-269): `h=\lceil3M/u\rceil`; for `t\in S\setminus\{0\}`, `i=v_2(t)`,
  `q_t=h\max(0,u-i)`, `D_t=L/2^i`; F(0) mod `2^p` is recoverable from `F(t+\alpha z)\bmod2^{p_t}`,
  `p_t=p+8hD_t+8M(a+1)`, over the t with `q_t>0`, using only the first `q_t` coefficients.
- Interpolation values (340-346): F(t+αz) mod `2^{p_t}` is obtained by evaluating at `M(2L-1)+1` lifts of
  residue-field elements (pairwise unit differences, 48-52) and Lagrange interpolation; fewer than `s^4` points;
  "The evaluation algorithm below passes precision $p_t$ to its children."
- Groups (387-392): fix active t and `\zeta\in\mathcal O`; `T=t+\alpha\zeta`, everything mod `2^{p_t}`;
  `i=v_2(t)<u`, `D=L/2^i`; vertices on both sides grouped by their symbol in coordinate i (so r groups).
  Entries of W(T) with both ports in one group are "local" and kept unchanged.
- Tiles (404-408): columns of a packet partitioned by `y=y_0+2^{i+1}j`, `0\le y_0<2^{i+1}`; the column group is
  constant on a tile.
- Modes (432-442): for each packet, tile and `b\ge0` with `b+1<p_t`, a formal variable Z of weight `w_Z=b+1`,
  standing for `L_Z(X)=\sum_{\text{real columns }y\text{ in the tile}}j^bX_y`; source = the tile's column group,
  target = the other group of that packet's coordinate-i pair. Each row form `(W(T)X)_x` equals its local part
  plus a linear combination of the modes targeted at x's group, with the coefficient of Z divisible by `2^{w_Z}`.
  At most `(3M/L)2^{i+1}=6M/D` modes of any one weight (D.13, 444-447).
- Child networks (487-504): for one β and each group g, all current vertices of group g (both sides) go on one
  side of the child, keeping their ports and lifted entries reduced mod `2^{p_t}`; on the other side one new
  vertex per packet, joined to every retained port of that packet, with indices the row bits Y and column bits X
  of group g in the packet. Its tensor is: the coefficient of `\prod Z^{\beta_Z}` (over modes targeted at g in
  the packet) in `\prod_{x\in g\cap\text{packet}}l_{Y_x}(\text{row form})`, times
  `\prod_{Z\text{ in this packet},\ \text{source}(Z)=g}L_Z(X)^{\beta_Z}`.
- **Closing claims (525-529, VERBATIM):** "By Lemma lem:tensor-packets, a child has at most $6M/r=3M/32<M/8$
  edges. Old vertex degrees are unchanged, and a new packet vertex has at most $2L\le\Delta$ ports. Thus the
  invariants used in eq:tensor-parameter-bounds hold inductively." Entry computability (531-533, 540-555):
  new tensors are implicit; an entry is computed by expanding at most L affine row factors with polynomially
  many terms each, then repeated squaring; since `L\le s^{1/1000}` the cost is `\exp(O(s^{9/10}))`; a description
  = packet data, β, interpolation value, creation precision; old descriptions are immutable and shared by
  reference so no composition of entry routines builds up with depth.

## 2. Reconstruction of the argument

1. **Setup of the deformation** (176-199, FRAGMENT: 179, 185-186, 192-194 unseen; D.7, D.8 VERBATIM via
   `equations`). Pack the M edges into packets, define W(T) blockwise, define F(T); F(0) is the contraction and
   `\deg F\le M(2L-1)`.
2. **Integrality** (lem-tensor-integrality 206-242, VERBATIM). `v_2(\mathcal C'(t))=v_2(\mathcal C'(0))` for all
   t in S; each factor `t-q+\alpha z` is coefficientwise divisible by `2^{v_2(t-q)}`; omitting the factor for
   `y-x` leaves an integral polynomial, divisible by 2 unless `y-x=t`. Hence `F(t+\alpha z)\in\mathcal A[z]`.
3. **Tapered Hermite recovery** (lem-tapered-hermite 250-336, VERBATIM). `\sum_{t\ne0}q_t\ge Lhu\ge3ML>M(2L-1)`;
   Hermite formula D.9; division by `E_t(t+\alpha z)` loses no precision; `v_2(E_t(0))\ge-6Dh` (D.10);
   evaluation at `-t/\alpha` loses at most `4M(a+1)`; so residues mod `2^{p_t}` give F(0) mod `2^p`.
4. **Interpolation and the precision bound** (340-382, FRAGMENT: 337-339, 355-356, 368, 376 unseen).
   F(t+αz) mod `2^{p_t}` from `<s^4` evaluations; D.11 proved by: root `P_0\le Cs`; `D_t\le2^{a_d}` and summing
   increments over `O(\log\lambda)` depths gives the first assertion; for the second, `q_t>0\Rightarrow i<u`
   so `D_t\ge2^{a_d-u}=2^{a_{d-1}+u}`, and since `M>H`, `u\ge\lambda^{4/5}`, the factor `2^u` dominates every
   fixed power of λ, so `p` and `8M(a+1)` are `O_C(MD_t/u)`, while `8hD_t` has that bound directly. 369-382
   explain why the taper (multiplicities changing by `h=\Theta(M/u)` per level) is what makes the loss
   `O(MD_t/u)` rather than `O(MD_t)`.
5. **W(t) is local** (387-400, VERBATIM). `W_{xy}(t)=0` unless `y-x=t`; adding an integer of valuation i flips
   bit i, so surviving pairs have different i-th bits; when the packet's two symbols in coordinate i differ this
   means row and column symbols agree; equal pairs are already one group.
6. **Crossing entries and the mode expansion** (402-430, FRAGMENT: 426-427 unseen). For x, y in different
   groups (`i`-th bits equal), tile y as `y_0+2^{i+1}j`; `v_2(t-y_0+x)\le i` (else `y_0\equiv x+2^i
   \pmod{2^{i+1}}`, contradicting equal i-th bits), unchanged by adding αζ; geometric expansion D.12
   (419-424, VERBATIM):
   `W_{xy}(T)=\sum_{b\ge0,\,b+1<p_t}\frac{\mathcal C(T)}{\mathcal C'(0)(T-y_0+x)}
   \left(\frac{2^{i+1}}{T-y_0+x}\right)^bj^b \pmod{2^{p_t}}`; "the geometric remainder is divisible by
   $2^{p_t}$"; computable with known powers of two and unit inverses.
7. **Modes and their weights** (432-447, VERBATIM). Z per (packet, tile, b), `w_Z=b+1`, `L_Z(X)`; each row
   form is local part plus a combination of targeted modes with coefficients divisible by `2^{w_Z}`; at most
   `6M/D` modes of each weight.
8. **Mode budget** (449-455, FRAGMENT: 450 unseen). In the product of the affine factors, the coefficient of
   `Z^\beta` is divisible by `2^{\sum_Zw_Z\beta_Z}`, so only tuples with `\sum_Zw_Z\beta_Z<p_t` (D.14) matter.
9. **Partition count** (456-479, VERBATIM). For any θ>0 the generating product and D.13 bound the number of
   tuples by `\exp(\theta p_t+\frac{6M}{D}\sum_{j\ge1}-\ln(1-e^{-\theta j}))`;
   `\sum_{j\ge1}-\ln(1-e^{-\theta j})=\sum_{h\ge1}\frac1{h(e^{\theta h}-1)}\le\frac1\theta\sum_h\frac1{h^2}`;
   take `\theta=\sqrt{M/(Dp_t)}` and use D.11; enumeration with polynomial delay (476-481, FRAGMENT: 482 unseen).
10. **Child construction** (487-508, VERBATIM) as in section 1.
11. **The identity** (510-523, VERBATIM). Every mode has one target and one source, so coefficient extraction
    factors over the (packet, group) row products and each substitution `L_Z(X)^{\beta_Z}` depends only on
    source-group bits; distributing the product in D.8 and summing independent bits within groups gives D.16.
12. **Child invariants** (525-529, VERBATIM) and **entry computability / descriptions** (531-555, FRAGMENT:
    534-539 unseen).
13. **Wrapper** (560-619, VERBATIM via read_node): correctness by induction; branching per call
    `s^{O(1)}\exp(O_C(\frac{s}{\sqrt\lambda}(\frac{\sqrt2}{8})^d))` from D.15 with `M\le Cs8^{-d}`,
    `u_d=\Theta_C(\lambda/2^d)`; product over `O_C(\log\lambda)` depths gives `\exp(O_C(s/\sqrt\lambda)
    +O_C(\lambda\log\lambda))` calls; leaf cost `\exp(O_C(H)+O_{C,A}(s^{9/10}))`; depth-first space.

## 3. Verification

**eq:tensor-precision-bound (D.11): VERIFIED** (on lines 348-367 plus lem-tapered-hermite; INFERRED
`\lambda=\log s`, `H=\Theta(s/\sqrt\lambda)`).
- `p_t=p+8hD_t+8M(a+1)` with `h=\lceil3M/u\rceil\le4M/u` (needs `M\ge u`, line 101), so `8hD_t\le32MD_t/u`.
- For `q_t>0`, `i<u`, so `D_t=2^{a_d-i}\ge2^{a_d-u}=2^{a_{d-1}+u}` (correct since `a_d-a_{d-1}=2u_d`).
- `a+1\le1+2\sum_{j\le d}u_j\le1+4\varepsilon\lambda=O(\lambda)`, and `D_t/u\ge2^u/u` with
  `u\ge\lambda^{4/5}`, so `8M(a+1)=O(MD_t/u)`.
- `p\le s\lambda^{O(1)}2^{a_{d-1}}` versus `MD_t/u\ge M2^{a_{d-1}}2^u/u`: needs `s\lambda^{O(1)}\le M2^u/u`;
  with `M>H=\Theta(s/\sqrt\lambda)` this is `\lambda^{O(1)}\le2^u/u`, true for `u\ge\lambda^{4/5}`.
- First assertion inductively: the increment at depth j is `O_C(M_jD/u_j)\le O_C(s2^{a_j})` since `D\le2^{a_j}`
  and `M_j\le Cs`; summing over `O(\log\lambda)` depths with `a_j\le a_{d-1}` gives `p\le s\lambda^{O(1)}2^{a_{d-1}}`
  for the input of a depth-d call. All precisions are `s^{O(1)}` because `2^{a_d}\le s^{4\varepsilon}`.
- Taper arithmetic in lem-tapered-hermite checked: the number of `t\ne0` with `v_2(t)=i` is `L/2^i=D_t`
  (complete residue system mod `2L`), so `\sum q_t=\sum_{i<u}h(u-i)L/2^i\ge hLu\ge3ML>M(2L-1)`. In D.10,
  points with `v_2(q)<i` contribute 0; the `D/2^j` points with `v_2(q)=i+j` contribute `j\,q(i+j)` each; the
  `D-1=\sum_{j=1}^{a-i}D/2^j` points with `v_2(q)=i`, `q\ne t`, split as `D/2^j` with `v_2(t-q)=i+j` and
  contribute `-j\,q(i)` each; `q(i+j)-q(i)\ge-hj` and `\sum j^2/2^j=6` give `\ge-6Dh`. Evaluating a degree
  `<q_t\le4M` polynomial at `-t/\alpha` (valuation `\ge-(a+1)`) loses `\le4M(a+1)`. Total loss
  `6hD_t+4M(a+1)<8hD_t+8M(a+1)`. Consistent.

**eq:tensor-partition-count (D.15): VERIFIED** (lines 443-475 VERBATIM).
- `\#\{\beta:\sum w_Z\beta_Z<p_t\}\le e^{\theta p_t}\prod_Z\sum_{\beta_Z\ge0}e^{-\theta w_Z\beta_Z}
  =e^{\theta p_t}\prod_Z(1-e^{-\theta w_Z})^{-1}`; with at most `6M/D` variables of each weight `j\ge1` this
  is `\le\exp(\theta p_t+\frac{6M}{D}\sum_{j\ge1}-\ln(1-e^{-\theta j}))`, exactly line 465-466.
- `-\ln(1-e^{-\theta j})=\sum_h e^{-\theta jh}/h`; summing over j: `\sum_h\frac1h\frac{e^{-\theta h}}
  {1-e^{-\theta h}}=\sum_h\frac1{h(e^{\theta h}-1)}\le\frac1\theta\sum_h\frac1{h^2}=\frac{\pi^2}{6\theta}`
  (using `e^{\theta h}-1\ge\theta h`). Lines 470-472 are exactly this.
- Bound `\exp(\theta p_t+\pi^2M/(D\theta))`; at `\theta=\sqrt{M/(Dp_t)}` it is `\exp((1+\pi^2)\sqrt{Mp_t/D})`.
- With `p_t=O_C(MD/u)` (D.11, same `D=D_t`): `\sqrt{M\cdot MD/(uD)}=M/\sqrt u`. The D cancels at every level,
  which is the whole design point of the taper.
- Mode count D.13: packets `\le3M/L`, tiles per packet `2^{i+1}`, so `\le(3M/L)2^{i+1}=6M/D`. Correct.
- Divisibility of mode coefficients: the b-th term of D.12 is `W_{x,y_0}(T)`-shaped (the factor for `y_0-x\in S`
  omitted, `y_0-x\ne t` since `v_2(t-y_0+x)\le i<\infty`), hence divisible by 2 by the lem-tensor-integrality
  argument, times `(2^{i+1}/(T-y_0+x))^b` with `v_2(T-y_0+x)\le i`, hence divisible by `2^b`. Total `2^{b+1}
  =2^{w_Z}`. A monomial `Z^\beta` in a product of affine forms collects `\beta_Z` such factors per Z, so its
  coefficient is divisible by `2^{\sum w_Z\beta_Z}` (line 451). Correct. The truncation `b+1<p_t` discards terms
  of valuation `\ge p_t` (428-429). INFERRED: `y_0-x\in S`, i.e. `S\supseteq(-L,L)`; lines 426-427 unseen.

**eq:tensor-recursion-identity (D.16): VERIFIED** (lines 387-425, 432-455, 487-523 VERBATIM; 426-427 unseen).
- W(t) local: `W_{xy}(t)\ne0` iff `y-x=t`; `v_2(t)=i` flips bit i; bit i of a slot encodes which symbol the
  row end carries, so row x has symbol `\sigma_{x_i}` and column y has symbol `\sigma_{1-y_i}`; same group iff
  `x_i\ne y_i`. So D.8 at T=t factors over groups, and all cross-group terms at `T=t+\alpha\zeta` are the
  expanded crossing terms.
- Each row form `(W(T)X)_x=\ell_x(X_{\text{same group, same packet}})+\sum_{Z\text{ targeted at }x\text{'s
  group in }x\text{'s packet}}c_{x,Z}(T)\,L_Z(X)` where `c_{x,Z}` are the D.12 coefficients (they depend on x,
  `L_Z` does not). `l_{Y_x}` is affine, so `\prod_x l_{Y_x}(\cdot)` is a polynomial in the formal Z's.
- The Z's occurring in rows of group g in packet P are exactly those with target g in P; these variable sets are
  disjoint across (g,P), so the coefficient of `Z^\beta` in the full product is the product over (g,P) of the
  coefficients of the restricted exponent vectors (510-511). Each such coefficient depends only on the row bits
  Y of g in P and the local column bits X of g in P; each `L_Z(X)^{\beta_Z}` depends only on columns of the
  tile, i.e. of Z's source group. Since `A(Y)=\prod_{\text{row vertices}}`, `B(X)=\prod_{\text{column
  vertices}}` and every vertex lies in one group, `F(T)\equiv\sum_\beta\prod_g\bigl[\sum_{X_g,Y_g}A_g(Y_g)
  B_g(X_g)\prod_P T_{g,P,\beta}(Y_g\cap P,X_g\cap P)\bigr]=\sum_\beta\prod_gZ_{g,\beta}\pmod{2^{p_t}}` with
  `T_{g,P,\beta}` the packet tensor of 496-504. The child network of 487-494 is exactly this bipartite network
  (group-g vertices on one side, one vertex per packet on the other, edges = retained ports). Edge cases 505-508
  (no target rows, empty tiles) are consistent. The restriction to `\sum w_Z\beta_Z<p_t` is justified by step 8.
- All child entries are integral (coefficients of products of integral affine forms, times integral `L_Z`), so
  the identity holds in `\mathcal A_{p_t}`.

**"M <= Cs 8^{-d}" (580, from 92-96 and 525-526): VERIFIED**, conditional on the packing conditions D.6 holding
at every depth (FRAGMENT: `eq:tensor-parameter-bounds` 99-101 only partly seen; ε not seen).
- A child's edges are the retained ports of group-g vertices (492-493). lem-tensor-packets item 3 gives at most
  `3M/r` real ports per side for the symbol g in coordinate i, so `\le6M/r` edges. With `r=64` (INFERRED from
  `6M/r=3M/32`), `3M/32<M/8`. Root: `M\le Cs` by hypothesis. Induction: `M_d\le Cs8^{-d}`. The wrapper's use at
  580 is therefore not an unproved assertion; it is discharged at 525-526.
- Degrees: old vertices unchanged; a packet vertex has `\le2L` ports and `2L\le\Delta` is a packing condition.
- Vertex count: `\le3M/L` new vertices per depth over `O(\log\lambda)` depths, polynomial.
- The product over depths (581-588): nodes at level d are at most `\prod_{j<d}b_j` with
  `b_j=s^{O(1)}\exp(O_C(\frac{s}{\sqrt\lambda}(\frac{\sqrt2}{8})^j))` (from `M_j/\sqrt{u_j}\le Cs8^{-j}
  \sqrt{2^j/(\varepsilon'\lambda)}`); `\sum_j(\sqrt2/8)^j<2`, and `s^{O(\log\lambda)}=\exp(O(\lambda\log\lambda))`
  with `\lambda=\log s`; `\lambda\log\lambda\ll s/\sqrt\lambda`. Depth bound `d\le\log_2\lambda/6+O_C(1)`
  follows from `H<M\le Cs8^{-d}` with `H=\Theta(s/\sqrt\lambda)`. Leaf cost `2^H\cdot\text{poly}\cdot
  \exp(O(s^{9/10}))=\exp(O_{C,A}(s/\sqrt\lambda))`. Arithmetic consistent.
- What I could not check: that `M\ge2D_{\rm arr}^2\Delta=2\cdot2^{24a_d}\lceil s^{9/10}\rceil` and `M\ge LD_{\rm
  arr}` hold whenever `M>H`. They require `2^{24a_d}\le s^{1/10}/\text{polylog}`, i.e. `\varepsilon<1/960`; the
  stated `L\le s^{1/1000}` (541) means `4\varepsilon\le1/1000`, which is compatible, but the actual choice of ε
  and the rest of `eq:tensor-parameter-bounds` (lines 100-111) were never returned by the API.

## 4. Verdict on the step

On what I could read, the proof of thm-tensor-contraction goes through. The three equations the wrapper cites are
each argued in full in D.4.4-D.4.6, and I was able to re-derive all three: D.11 is a four-line valuation count
plus the `2^u` slack built into `a_d=2\sum u_j`; D.15 is a textbook generating-function (Hardy-Ramanujan-style)
bound with the clean cancellation `Mp_t/D=O(M^2/u)`; D.16 is a correct factorization of a product of affine
forms whose formal variables have disjoint (packet, target-group) supports. The doubted shrinkage `M\le Cs8^{-d}`
is not an assertion of the wrapper at all: it is a stated invariant (92-96) proved at 525-526 from item 3 of
lem-tensor-packets with r=64. The map's `warn` flag is a fair description of the paper's organisation (none of
this is in a node), not evidence of a mathematical gap.

Posterior in words: I now believe with fairly high confidence (roughly four chances in five) that Appendix D.4
proves exactly what thm-tensor-contraction states. The residual doubt is concentrated in the unread parameter
bookkeeping, not in the three equations: lines 100-111 (`eq:tensor-parameter-bounds` and the choice of ε, r, H),
which must make D.6 hold at every active depth while keeping `L\le s^{1/1000}`. That single passage would move my
estimate most. Second would be 534-539 (how a packet-tensor entry is actually expanded in `\exp(O(s^{9/10}))`
time; the claim is plausible since `L\le s^{1/1000}` factors with polynomially many terms each). Nothing I read
suggests the headline result follows: whether the k-CNF counting problem really reduces to a network with
`Cs` edges and degree `s^{9/10}` is outside this step.

## 5. Coverage and cost

- Of the 240 lines 380-619 of quantitative-contraction.tex I saw 230 verbatim. Lines 560-619 (60 lines, blank
  570 and 602 included in the range) came through one `read_node` call (#2). Lines 380-559 came only through
  `search_paper` windows: 170 of 180 lines, over 53 search calls (about 37 of which landed at least one new
  line in the region). Unseen: 426-427 (middle of the mode-expansion remark), 450 (one line of the divisibility
  sentence), 482 (end of the enumeration remark), 534-539 (entry-expansion details).
- Lines 337-379 (D.4.4 tail): 36 of 43 seen (unseen 337-339, 355-356, 368, 376), all via search_paper.
- Supporting material via read_node: lem-tapered-hermite 250-336, lem-tensor-integrality 206-242,
  lem-tensor-packets 114-171; via search: 48-52, 68-73, 86-101, 174-199.
- 60 calls in total: 1 llms.txt, 1 get_overview, 1 get_friction, 4 read_node, 53 search_paper.

## 6. What I could not determine from the API alone

1. The full `eq:tensor-parameter-bounds` (99-111) and the choices of ε, r, H: whether D.6 holds at every depth.
   A `read_node`-style range fetch (file, from, to) would settle it; failing that, a search on a phrase from
   line 102 (which I never saw).
2. Lines 426-427: the exact statement about the b-th term before "one before taking that power" (428). Same fix.
3. Lines 534-539: the algorithm for expanding the row-factor product. Same fix.
4. Whether `r=64` is stated anywhere (I inferred it from `6M/r=3M/32`). A search for `r=64` would cost one
   call; I ran out.
5. Whether `S=(-L,L]` or some other complete residue system containing all `y-x`. A search on the definition of
   S (around 178-180, unseen line 179) would settle it.
6. Which `\lambda` is (I assumed `\log s`, from quantitative-reduction.tex:62). `read_node` on the node that
   defines λ (probably in D.2/D.3) would settle it.

## 7. Most painful moments (log line numbers in parentheses)

1. `search_paper` returns the first 15 hits in file order with no `offset`, `file` or `section` filter, so any
   word that occurs 15+ times in `main_full_version.tex` returns nothing from the appendix: "child" (17), "theta"
   (21), "a_d" (24), "Taylor" (39) were four wasted calls, and "u_d" (20), "j^b" (32), "target" (23) were mostly
   wasted.
2. Punctuation-insensitive matching turns `u_d` into "u d" with 79 hits and `a_d` into 113 hits (20, 24); there
   is no exact-match or regex mode.
3. No way to fetch a line range. Covering 180 lines of node-less prose (380-559) needed 53 overlapping ±2-line
   windows and still left 10 holes (26-60 generally; 45, 55, 56 for the specific holes). A `read_lines(file,
   from, to)` endpoint, or `read_node` accepting a section id, would have made this a 3-call job.
4. The `equations` list in `read_node` gives the LaTeX of D.11, D.15, D.16 but no file:line, so locating them
   still cost three searches (2, then 3-5).
5. Equation bodies are routinely cut by the ±2 window: D.12 needed two extra calls (15, 31), D.11 two (5, 27,
   43), `eq:tensor-parameter-bounds` is still only a fragment (49).
6. D.4.5 and D.4.6 have zero nodes (7), so `get_node`/`read_node`/`trace`/`ancestors` are useless for the crux;
   the only tool that reaches it is search.
7. `search_paper` has a `total` field that tells you how many hits you did not get but gives no way to get them
   (11, 17).
8. The whole-paper scope means short exact labels are the only reliable keys; prose phrases work only when they
   are unusual ("feasible partial", "any one weight", 46-47), and guessing them from two context lines is slow.
