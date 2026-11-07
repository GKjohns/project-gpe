# ETH paper, round 4: the D.4.4-D.4.6 argument behind thm-tensor-contraction

All quotations are from API responses (read_source / read_node on `eth`). File `qc` = quantitative-contraction.tex,
`qr` = quantitative-reduction.tex. Log: eth_learner_log_r4.md (call numbers cited as L5, L6, ...).

## 1. The step under test

thm-tensor-contraction (qr:26-49, L13/L23): a bipartite tensor network with at most Cs edges, degree at most
ceil(s^{9/10}), polynomially many vertices, entries in B_{P0,l} = (Z/2^{P0})[V]/(V^l) with 1 <= P0, l <= Cs, each entry
computable in time (s+L)^b 2^{A s^{9/10}} and space (s+L)^b, can be contracted in (s+L)^{O(1)} 2^{O(s/sqrt(log s))}
time and polynomial space. The contraction is Z = sum_{x in {0,1}^{E}} prod_v T_v(x|delta(v)) (qr:20-22).

The proof (qc:560-619) is a recursion; its three load-bearing displays are:

(E1) `eq:tensor-recursion-identity`, qc:516-521 (VERBATIM, L5):
```
 F(t+\alpha\zeta)
   =\sum_{\beta:\,\sum w_Z\beta_Z<p_t}
                       \prod_{g=1}^r Z_{g,\beta}
                  \pmod {2^{p_t}},
```
"where $Z_{g,\beta}$ is the contraction of the child just defined" (qc:522).

(E2) `eq:tensor-partition-count`, qc:457-460 (VERBATIM, L5):
```
 \exp\bigl(O(\sqrt{Mp_t/D})\bigr)
       =\exp\bigl(O_C(M/\sqrt u)\bigr).
```
This is the number of exponent tuples beta satisfying `eq:tensor-mode-budget` qc:453-455: `\sum_Zw_Z\beta_Z<p_t`.

(E3) `eq:tensor-precision-bound`, qc:349-353 (VERBATIM, L9). Note: it is in D.4.4 at line 349, not in the 380-558 range
the earlier readers guessed:
```
 p\le s\lambda^{O(1)}2^{a_{d-1}},
 \qquad
 p_t=O_C(MD_t/u).
```

Objects (all VERBATIM):
- Ring (qc:11-24): lambda = ceil(log2 s), e = 4 lambda, f monic of degree e irreducible mod 2; O = Z_(2)[U]/(f),
  K = Q[U]/(f), A = O[V]/(V^l), A_p = A/(2^p). v_2 on K is the minimum coordinate valuation and is multiplicative (qc:33-35).
  Entries are "canonically lifted" from their creation precision p_c and the same representatives are used at every later
  precision (qc:57-71).
- Parameters (qc:81-91): H = ceil(s/floor(sqrt lambda)), r = 64, eps = 1/(128*1024), Delta = ceil(s^{9/10}); at depth d:
  u = u_d = floor(eps lambda / 2^d), a = a_d = 2 sum_{j<=d} u_j, a_{-1} = 0, L = 2^a, D_arr = r^{2a}.
  A call with M <= H edges is a leaf (qc:85).
- Invariants (qc:92-108): "We will arrange that every child has at most M/8 edges and maximum degree at most Delta. These
  assertions imply, on every active path, H < M <= Cs 8^{-d}, d <= (log2 lambda)/6 + O_C(1)" (qc:92-97); hence
  `eq:tensor-parameter-bounds` (qc:99-104): u = Theta_C(lambda/2^d), lambda^{4/5} <= u <= M, a <= 4 eps lambda,
  L, D_arr <= s^{1/1000}; and `eq:tensor-packing-conditions` (qc:106-108): M >= 2 D_arr^2 Delta, M >= L D_arr, 2L <= Delta.
- Packets (lem-tensor-packets, qc:114-130): vertices on each side labelled by [r]^a; edges embedded in packets of L slots;
  (1) at most 3M/L packets, each edge in the same slot at both ends, unused slots have no ports; (2) per packet and
  coordinate the unordered pair of row/column symbols is fixed and, when they differ, "bit i of the slot number specifies
  their orientation in coordinate i"; (3) "For every coordinate and every symbol, at most 3M/r real ports on each side
  belong to vertices with that symbol."
- Deformation (qc:176-202): S = {-L,...,L-1}, C(T) = prod_{t in S}(T-t), alpha = 2^{a+1}; within a packet
  `W_{xy}(T)=\frac{\mathcal C(T)}{\mathcal C'(0)(T-(y-x))}` (qc:184-185), zero between packets, restricted to real ports;
  W(0) = I. With l_0(z) = 1-z, l_1(z) = z, A(Y), B(X) the products of lifted row/column tensors on independent port
  assignments: `F(T)=\sum_{X,Y\in\{0,1\}^M} A(Y)B(X)\prod_{\text{row ports }x}l_{Y_x}((W(T)X)_x)` (qc:198-199);
  deg F <= M(2L-1), F(0) = the contraction (qc:201-202).
- lem-tensor-integrality (qc:206-212): W(t+alpha z) in O[z], F(t+alpha z) in A[z] for t in S; entries computable mod 2^p
  in poly(s,p) bit operations.
- Taper (lem-tapered-hermite, qc:250-269): 1 <= u <= a, M >= u, h = ceil(3M/u); for t in S\{0}: i = v_2(t),
  q_t = h max(0, u-i), D_t = L/2^i; F(0) mod 2^p is recoverable from F(t+alpha z) mod 2^{p_t},
  p_t = p + 8hD_t + 8M(a+1), over the t with q_t > 0 ("active" t), using only the first q_t coefficients.
- Modes (qc:387-447): fix active t, zeta in O, T = t + alpha zeta, i = v_2(t) < u, D = L/2^i. Groups = vertices (both
  sides) with a given symbol in coordinate i; same-group entries of W(T) are "local" and kept. Columns are partitioned
  into tiles y = y_0 + 2^{i+1} j, 0 <= y_0 < 2^{i+1}; for a crossing row x, v_2(t - y_0 + x) <= i, and
  `eq:tensor-mode-expansion` (qc:419-424) expands W_{xy}(T) as sum over b with b+1 < p_t of
  [C(T)/(C'(0)(T-y_0+x))] (2^{i+1}/(T-y_0+x))^b j^b mod 2^{p_t}. A mode Z = (packet, tile, b) has weight w_Z = b+1,
  stands for L_Z(X) = sum over real columns y in the tile of j^b X_y (qc:435), source = the tile's column group, target =
  the other group of the packet's coordinate pair. "The coefficient of Z is divisible by 2^{w_Z}" (qc:442). At most
  (3M/L)2^{i+1} = 6M/D variables per weight (`eq:tensor-mode-multiplicity`, qc:445).
- Child networks (qc:487-529): for each beta and group g, one side = all current group-g vertices (both sides) with their
  ports and lifted entries reduced mod 2^{p_t}; other side = one vertex per packet joined to every retained port of that
  packet, with tensor = [coefficient of prod_{Z targeted at g in the packet} Z^{beta_Z} in prod_{x in g, in packet}
  l_{Y_x}(.)] * prod_{Z in packet, source g} L_Z(X)^{beta_Z}. Closure claim (qc:525-529): "By Lemma lem:tensor-packets, a
  child has at most 6M/r = 3M/32 < M/8 edges. Old vertex degrees are unchanged, and a new packet vertex has at most
  2L <= Delta ports. Thus the invariants used in eq:tensor-parameter-bounds hold inductively." Entry cost of a packet
  tensor: exp(O(L log s)) = exp(O(s^{9/10})) (qc:531-542); descriptions immutable, no composition with depth (qc:544-555).

## 2. Reconstruction of the argument (paper order)

1. Ring and lifts: A_p arithmetic is poly(s,p,l); canonical lift per creation precision; precisions strictly increase along
   a path so representatives are stable. qc:8-71. VERBATIM.
2. Parameters, the claim "every child has <= M/8 edges and degree <= Delta", the consequences H < M <= Cs 8^{-d},
   d <= log2(lambda)/6 + O_C(1), and the parameter/packing bounds. qc:76-112. VERBATIM.
3. lem-tensor-packets: conditional-expectation labelling with sum_gamma (X_gamma - M/D_arr)^2 <= 2M Delta, loads
   <= M/D_arr + sqrt(2M Delta), padding to H_pad <= 3M/D_arr, packets of L slots per fixed symbol-pair class, slot bit i
   = orientation/copy, 3M/L packets, 3M/r real ports per symbol per side. qc:114-171. VERBATIM.
4. Cauchy deformation W(T), F(T), W(0) = I, deg F <= M(2L-1), F(0) = contraction. qc:176-204. VERBATIM.
5. lem-tensor-integrality: S is a complete residue system mod 2^{a+1}; v_2(C'(t)) = v_2(C'(0)); C(t+alpha z)/C'(0) is
   divisible by 2^{a+1}; omitting the factor for y-x leaves it integral (divisible by 2 unless y-x = t). qc:206-242. VERBATIM.
6. lem-tapered-hermite: sum_{t != 0} q_t >= Lhu >= 3ML > M(2L-1); Hermite identity `eq:tensor-hermite-origin` (qc:281-284);
   quotients integral; v_2(E_t(0)) >= -6Dh (`eq:tensor-hermite-loss`, qc:302-308); evaluation at -t/alpha loses
   <= 4M(a+1); so lifts mod 2^{p_t} give F(0) mod 2^p; polynomial-bit common denominators. qc:250-336. VERBATIM.
7. Application: at a call of input precision p, for every active t obtain F(t+alpha z) mod 2^{p_t} by Lagrange interpolation
   at M(2L-1)+1 < s^4 unit-spaced points; pass p_t to children. qc:338-346. VERBATIM.
8. (E3) precision bound: root P0 <= Cs; increments 8hD_t + 8M(a+1) with h <= 4M/u, M <= Cs, D_t <= 2^{a_d}, summed over
   O(log lambda) depths; and D_t >= 2^{a_d - u} = 2^{a_{d-1}+u} with u >= lambda^{4/5} makes p and 8M(a+1) both
   O_C(M D_t/u). qc:348-368. VERBATIM.
9. Modes: groups by symbol in coordinate i; W(t) is local because y - x = t flips bit i; tiles; crossing condition
   v_2(t-y_0+x) <= i; geometric expansion `eq:tensor-mode-expansion`; valuations a+1-i >= 1 and >= 1 per power; remainder
   divisible by 2^{p_t}; modes Z, weights, L_Z, source/target; coefficient divisible by 2^{w_Z}; 6M/D variables per
   weight. qc:387-447. VERBATIM.
10. Mode-monomial divisibility by 2^{sum w_Z beta_Z}; budget `eq:tensor-mode-budget`; (E2) with the complete
    generating-function estimate (theta p_t + (6M/D) sum_j -ln(1-e^{-theta j}) <= theta p_t + (6M/D)(1/theta) sum 1/h^2,
    theta = sqrt(M/(D p_t)), then (E3)); poly-delay enumeration. qc:449-482. VERBATIM.
11. Child construction for (beta, g); packet tensor as coefficient extraction times prod L_Z^{beta_Z}; edge cases; "every
    mode has one target and one source" so extraction factors over packet-group row products; distribute
    `eq:tensor-deformed-contraction` and sum independent bits within groups: (E1). qc:487-523. VERBATIM.
12. Closure: child edges <= 6M/r = 3M/32 < M/8 via lem-tensor-packets(3); degrees; invariants hold inductively.
    qc:525-529. VERBATIM.
13. Entry cost exp(O(L log s)) = exp(O(s^{9/10})); descriptions. qc:531-555. VERBATIM.
14. Wrapper proof: correctness by induction from leaves (560-569); children per depth-d call
    <= s^{O(1)} exp(O_C((s/sqrt lambda)(sqrt2/8)^d)) from (E2), M <= Cs 8^{-d}, u_d = Theta_C(lambda/2^d) (571-581);
    product over O_C(log lambda) depths = exp(O_C(s/sqrt lambda) + O_C(lambda log lambda)) (582-588); leaf
    2^H poly exp(O(s^{9/10})) (589-595); time (596-601); space (603-619). qc:560-619. VERBATIM.

No step is FRAGMENT or INFERRED: the whole file (qc:1-619) was returned verbatim. The only non-LaTeX inputs I used are
the map's plain-English claim nodes (L15-L18), and I used them only as a cross-check, not as evidence.

## 3. Verification

### (E1) eq:tensor-recursion-identity: VERIFIED (given lem-tensor-integrality and lem-tensor-packets(2), both read)

(a) Crossing condition. In a packet whose coordinate-i symbols differ, slot bit i gives orientation (lemma item 2, qc:122-125,
with "one orientation convention throughout each packet", qc:164-165). Row slot x with bit_i(x) = 0 means the row end has
symbol sigma_1; column slot y with bit_i(y) = 0 means that edge's row end has sigma_1, so its column end has sigma_2. Hence
row x and column y are in different groups iff bit_i(x) = bit_i(y) (qc:402-404). If v_2(t - y_0 + x) >= i+1 then, since
t = 2^i (odd), y_0 = x + 2^i mod 2^{i+1}, so bit_i(y_0) != bit_i(x): same group, i.e. local. So crossing implies
v_2(t - y_0 + x) <= i (qc:411-415), and v_2(alpha zeta) >= a+1 > i leaves this unchanged (qc:415-416). Checked.

(b) Valuations in the expansion. With v = v_2(t - y_0 + x) <= i: by the integrality proof, v_2(C'(0)) = sum_{q != 0} v_2(q)
= sum_{q != t} v_2(t - q) (qc:214-217), and C(T)/C'(0) = alpha zeta prod_{q != t}(t - q + alpha zeta)/C'(0) has valuation
>= a+1 (qc:218-226). Omitting the factor q = y_0 - x (which lies in S since -L < y_0 - x < 2^{i+1} <= L) removes content
2^v, so the "first fraction" has valuation >= a+1-v >= a+1-i >= 1 (qc:426), as 1 <= i+1 <= u <= a. The ratio
2^{i+1}/(T - y_0 + x) = 2^{i+1-v} * unit has valuation >= 1 (qc:427-428). So the coefficient of j^b has valuation
>= a+1-i+b >= b+1 = w_Z (qc:442). The geometric remainder (first omitted b = p_t - 1) has valuation >= 1 + p_t - 1 = p_t
(qc:428-429). Checked. (Also checked: W(t) is local, qc:394-396, since W_xy(t) = prod_{q != y-x}(t-q)/C'(0) vanishes unless
y - x = t, and adding t of valuation i flips bit i.)

(c) Divisibility of monomials. Each row form is local + sum_Z c_Z Z with 2^{w_Z} | c_Z; l_{Y_x} is affine; so the coefficient
of Z^beta in prod_x l_{Y_x}(.) is a sum of terms each carrying prod_Z c_Z^{beta_Z}, divisible by 2^{sum w_Z beta_Z}
(qc:449-451). A(Y), B(X), L_Z(X) are integral. Monomials with sum w beta >= p_t vanish mod 2^{p_t}. Checked.

(d) Factorisation. Variables Z are partitioned by (packet, target group); rows x of group g in packet P only involve modes
targeted at g in P and local bits of g in P; so [Z^beta] prod_x l_{Y_x}(.) = prod_P prod_g coef_{P,g,beta}(Y_{g,P}, X_{g,P}).
Each Z has one source, so prod_Z L_Z(X)^{beta_Z} = prod_g prod_{Z: source g} L_Z(X_g)^{beta_Z}. A(Y)B(X) = prod_g A_g B_g
since every vertex is in exactly one group. Hence sum_{X,Y} A B [Z^beta](...) prod L^beta = prod_g sum_{X_g,Y_g} A_g B_g
prod_P (coef * L-powers) = prod_g Z_{g,beta}, and Z_{g,beta} is exactly the contraction of the child described at qc:489-504
(each retained port becomes a child edge whose bit is the old port bit). Summing over beta gives F(T) exactly over K and
(E1) mod 2^{p_t}. Checked. Edge cases qc:505-508 are consistent.

### (E2) eq:tensor-partition-count: VERIFIED (given (E3))

Variables per weight w: packets with differing coordinate-i symbols <= 3M/L, tiles per packet 2^{i+1}, one b per weight:
(3M/L)2^{i+1} = 6M/D since D = L/2^i (qc:445). Checked. For x = e^{-theta}: #{beta : sum w beta < p_t}
<= x^{-p_t} prod_Z (1 - x^{w_Z})^{-1} <= exp(theta p_t) prod_{j>=1}(1 - e^{-theta j})^{-6M/D} (qc:464-467). Checked.
sum_j -ln(1 - e^{-theta j}) = sum_j sum_h e^{-theta j h}/h = sum_h (1/h) e^{-theta h}/(1 - e^{-theta h})
= sum_h 1/(h(e^{theta h} - 1)) <= (1/theta) sum_h 1/h^2 using e^x - 1 >= x (qc:469-473). Checked. With
theta = sqrt(M/(D p_t)): exponent = sqrt(M p_t/D)(1 + pi^2/6 * 6) = (1 + pi^2) sqrt(M p_t/D). Then (E3) p_t = O_C(M D_t/u)
with D = D_t (qc:301, qc:389) gives sqrt(M * M D/u / D) = M/sqrt u (qc:474-475). Checked. Enumeration with polynomial delay
(qc:476-482) is standard. The modes used here are those of one fixed (t, zeta); the count is per call per interpolation
point, which is how qc:571-579 uses it.

### (E3) eq:tensor-precision-bound: VERIFIED (given lem-tapered-hermite, read and checked)

Taper arithmetic (qc:270-336). L odd points each with q_t = hu, so sum q_t >= Lhu >= 3ML > M(2L-1). h = ceil(3M/u) <= 4M/u
needs M/u >= 1: hypothesis M >= u. q_t <= hu <= 4M. Hermite identity: each summand has degree < sum q_t, correct jet at
its node, vanishes to order q_q elsewhere, so it equals F. E_t(t+alpha z) factors 1 + alpha z/(t - q) with
v_2(alpha/(t-q)) >= a+1-a = 1: integral, constant term 1, reciprocal truncation integral. Loss: v_2(E_t(0)) =
sum_{q != 0,t} q_q (v_2(q) - v_2(t-q)); points with v_2(q) < i contribute 0; points with v_2(q) = i+j (j >= 1) have
v_2(t-q) = i and contribute j q(i+j), there are D/2^j of them (nonzero residues of valuation exactly i+j in a complete
residue system mod 2^{a+1}, D = 2^{a-i}); points with v_2(q) = i, q != t have t - q ranging over the nonzero multiples
of 2^{i+1}, D/2^j of valuation i+j, contributing -j q(i); so v_2(E_t(0)) = D sum_j (j/2^j)(q(i+j) - q(i)) >= -Dh sum j^2/2^j
= -6Dh (sum j^2/2^j = (1/2)(3/2)/(1/8) = 6). Checked. (-t/alpha)^j for j < q_t <= 4M has valuation >= -4M(a+1).
Checked. 6Dh + 4M(a+1) < 8hD_t + 8M(a+1): margin fine. So lifting the truncated quotient's coefficients mod 2^{p_t}
perturbs F(0) by 2^p A. Checked.

(E3) itself (qc:354-368). Root: P0 <= Cs. Increment at depth j: 8hD_t + 8M(a+1) <= 32 Cs 2^{a_j}/u_j + 8Cs(4 eps lambda + 1)
<= Cs lambda^{O(1)} 2^{a_{d-1}} for j <= d-1; O(log lambda) increments: p <= s lambda^{O(1)} 2^{a_{d-1}} at depth d.
Checked. Second: q_t > 0 means i <= u-1, so D_t = 2^{a_d - i} >= 2^{a_d - u} = 2^{a_{d-1} + u} (a_d = a_{d-1} + 2u). Then
M D_t/u >= H 2^{a_{d-1}} 2^u/u = (s/sqrt lambda) 2^{a_{d-1}} 2^u/u, and 2^u/u >= 2^{lambda^{4/5}}/lambda beats
lambda^{O(1)} sqrt lambda, so p = O(M D_t/u); 8M(a+1) <= 8M(4 eps lambda + 1) = O(M D_t/u) since D_t >= 2^u; 8hD_t <= 32 M D_t/u.
So p_t <= 34 M D_t/u for large s. Checked. Polynomial precisions: a_d <= 4 eps lambda so 2^{a_d} <= 2 s^{1/32768}. Checked.
Also checked the lemma's hypothesis 1 <= u <= a: a_d = 2 sum_{j<=d} u_j >= 2u_d.

### Child-edge claim M <= Cs 8^{-d}: VERIFIED (given lem-tensor-packets(3), read and checked)

Child for group g: edges = retained ports = ports of group-g row vertices + ports of group-g column vertices
<= 3M/r + 3M/r = 6M/r = 6M/64 = 3M/32 < 4M/32 = M/8 (qc:525-526). Item (3) (qc:167-170): in a fixed coordinate a symbol
occurs in exactly 1/r of the padded pair labels on either side, so real ports <= H_pad D_arr/r <= 3M/r, where
H_pad <= M/D_arr + sqrt(2M Delta) + L <= 3M/D_arr uses sqrt(2M Delta) <= M/D_arr iff M >= 2 D_arr^2 Delta and L <= M/D_arr,
i.e. `eq:tensor-packing-conditions` (qc:106-108). The second-moment bound (qc:132-141): E sum_gamma (X_gamma - M/D_arr)^2
= sum over ordered edge pairs of (P[same pair label] - 1/D_arr); disjoint pairs give exactly 1/D_arr - 1/D_arr = 0;
<= 2M Delta pairs share an endpoint and contribute <= 1 each. Checked. Packet vertex degree <= 2L <= Delta (qc:527, qc:108).
Induction (qc:92-97): root M <= Cs; at depth d with H < M <= Cs 8^{-d} the parameter bounds hold, so the packing conditions
hold, the lemma applies, children have <= M/8 <= Cs 8^{-(d+1)} edges. Depth: 8^d < Cs/H <= C sqrt lambda gives
d <= log2(lambda)/6 + O_C(1). Parameter bounds from it: 2^d = O_C(lambda^{1/6}) so u = floor(eps lambda/2^d) =
Theta_C(lambda/2^d) >= lambda^{4/5}; a <= 4 eps lambda; L = 2^a <= 2 s^{4 eps} = 2 s^{1/32768}; D_arr = 2^{12a} <= 2 s^{48 eps}
= 2 s^{1/2730.7}; both <= s^{1/1000}. Packing: 2 D_arr^2 Delta = O(s^{9/10 + 2/1000}) = o(H). Checked.

### Wrapper arithmetic (qc:571-595): VERIFIED
Children per depth-d call: (active t) * (zeta values < s^4) * r * #beta = s^{O(1)} exp(O_C(M/sqrt u)); with M <= Cs 8^{-d},
u = Theta_C(lambda/2^d): M/sqrt u = O_C((s/sqrt lambda) 8^{-d} 2^{d/2}) = O_C((s/sqrt lambda)(sqrt2/8)^d). Product over
O_C(log lambda) depths: s^{O(log lambda)} exp(O_C(s/sqrt lambda) sum_d (sqrt2/8)^d) = exp(O_C(lambda log lambda) +
O_C(s/sqrt lambda)) since sum (sqrt2/8)^d < 1.22 and s^{O(1)} = 2^{O(lambda)}. Leaf: 2^H assignments, poly entry
evaluations each (s+L)^b 2^{A s^{9/10}}: exp(O_C(H) + O_{C,A}(s^{9/10})) = exp(O_{C,A}(s/sqrt lambda)). Packet-tensor
entries: product of <= L affine factors, each with poly many terms (constant, local scalar, <= 2^{i+1} p_t mode terms);
one term per factor gives (poly)^L = exp(O(L log s)) <= exp(O(s^{1/1000} log s)). Checked.

Correctness chain (qc:560-569): leaves exact; at an active call each F(t+alpha zeta) mod 2^{p_t} is a sum of products of
child contractions mod 2^{p_t} (children return the contraction of their A_{p_t} tensors, which is lift-independent);
Lagrange interpolation over A_{p_t} at unit-spaced points (qc:49-52) gives F(t+alpha z) mod 2^{p_t}; the taper lemma
gives F(0) mod 2^p; F(0) is the contraction of the lifted tensors (qc:202-204). Checked.

## 4. Verdict on the step

On everything the API returned, the proof of thm-tensor-contraction goes through: the three displays are correct
consequences of the text around them, the child-edge bound is a correct corollary of lem-tensor-packets(3) with r = 64,
and the taper/precision/partition arithmetic is right with comfortable constants. I could not find a gap in
qc:1-619. Posterior in words: I am confident (say 85-90%) that Appendix D.4 is internally correct as a proof of the
theorem from its stated hypotheses. Since the theorem would refute ETH, my residual doubt is almost entirely that the
error lives outside this file: either the reduction (D.2/D.3, lem-tensor-sparse-query, thm-main) does not actually produce
networks meeting the hypotheses (Cs edges, degree <= s^{9/10}, polynomially many vertices, entries in B_{P0,l} with the
stated entry-time bound), or a hypothesis I treated as given hides the cost (e.g. the vertex-count or entry-time
hypothesis as instantiated by the reduction). Within D.4 nothing is unread; the single unread passage that would move me
most is therefore the construction of the network in D.2 / lem-tensor-sparse-query (quantitative-reduction.tex, nodes in
D.2-D.3), checked against the theorem's hypothesis list at qr:27-40. One in-file point I would re-examine with fresh eyes
is the orientation convention in (E1)(a): the whole mode expansion depends on "different groups iff equal bit i", which I
derived from lem-tensor-packets(2) and qc:162-165; under the opposite convention the crossing valuation bound would fail.
The paper's own sentence at qc:397-398 agrees with my reading.

## 5. Coverage and cost

Target passage qc:380-619 (240 lines): 240/240 seen verbatim (all non-blank lines; read_source drops blank lines but keeps
numbering), through read_source in two calls (L5: 380-529, L6: 530-619). Context qc:1-379 (379 lines) via three more
read_source calls (L7, L8, L9). Duplicated coverage via read_node: 114-171 (L10), 250-336 (L11), 206-242 (L12), 560-619
(L13). Theorem statement and definitions qr:12-63 via read_source section=D.1 (L23) and read_node (L13). Total 23 calls
(see log Totals); the 5 read_source calls on qc are the ones that did the work.

## 6. What I could not determine from the API alone

1. Whether the networks produced by the reduction (D.2, D.3, lem-tensor-sparse-query) satisfy the theorem's hypotheses,
   in particular "number of vertices bounded by a fixed polynomial in s" and the entry-time bound. Settled by: read_node
   on lem-tensor-sparse-query and the D.2 nodes, plus read_source section=D.2 / D.3 (out of scope for this round).
2. Whether there is any erratum or later version; the API has no version/date field on sections. Not settleable here.
3. Nothing inside qc:1-619 remained unreadable; blank lines are dropped by read_source, so I cannot distinguish a blank
   line from a comment-only line, which is harmless for verification.

## 7. Most painful moments (and what was easy)

1. (L2) get_overview returns from:null/to:null for every section, so there is no way to learn that the crux is qc:384-529
   or that the file ends at 619 without guessing ranges. A `lines` field per section would have saved a planning step and
   would have corrected the earlier readers' "lines 380-558 / 560-619" estimates (E3 is actually at 349).
2. (L5, L6) read_source labels a range by the section of its first line only ("D.4.4" for 380-529 which spans three
   subsections; "D.4.6" for 530-619 which is mostly D.4.7). A list of sections touched, or heading markers in `text`,
   would help.
3. (L6) No explicit end-of-file indicator; I inferred it from to=619 on a 530-679 request and the absence of next_from.
4. (L4) list_nodes' top-level array is `nodes` (and read_source's is `nodes_in_range`), not `items`; one jq retry.
5. (L15) Claim nodes have statement_paper: null and use `statement_plain`/`explanation`; another jq retry to find the
   field names. Field naming is inconsistent across node kinds.
6. (L10-L12) read_node duplicated text I already had from read_source; with no cheap "which lines does this node span"
   call (get_node lacks line numbers), I spent three calls confirming coverage I already had.
7. (L5) read_source drops blank lines, so "150 lines" returns ~120 numbered lines and the line count in the response
   cannot be used to confirm completeness; numbering has to be scanned by eye.
8. (L3) The friction note is accurate but cites D.4.4-D.4.6 for the precision bound while the display is at qc:349 in
   D.4.4 proper and its proof at 354-368; a line number in the friction note would have been better.

Notably easy: llms.txt documented exactly the calls I needed, including the `%2B` rule and the section-id form of
read_source; `equations` in each read_source response lists referenced displays with their defining line even when
defined outside the range (that is how I found E3 at 349 immediately); read_node on the theorem correctly pointed to a
proof in a different file; read_source?section=D.1 worked first time; the whole 619-line file fit in 5 calls, so a
complete verbatim extraction cost well under half the budget.
