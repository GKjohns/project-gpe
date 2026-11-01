# Mathematics manuscript collection

**721 manuscripts covering 373 result families.**

[**Read the overview PDF**](overview.pdf).

## Manuscript map

Each result description is followed by its constituent manuscripts and their abstracts. Paper titles link directly to PDFs.

<table>
<thead><tr><th>Result</th></tr></thead>
<tbody><tr>
<td>

**017. The irrationality exponent of <i>π</i> is 2.** Proves that the irrationality exponent of <i>π</i> is exactly 2: for every <i>ε</i> &gt; 0 and all sufficiently large denominators <i>q</i>, every rational $`p/q`$ satisfies $`|\pi-p/q|\ge q^{-2-\varepsilon}`$. This also proves convergence of the Flint–Hills series $`\sum_{n\ge1}1/(n^3\sin^2 n)`$, with angles in radians. ([Lean](lean/docs/017.md))

</td>
</tr></tbody>
<tbody><tr>
<td>

&emsp;[The irrationality exponent of pi is 2](preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/paper.pdf)

We prove the conjecture that the irrationality exponent of <i>π</i> is 2. As a consequence, the classical Flint–Hills series $`\sum_{n\ge1}1/(n^3\sin^2 n)`$ converges, with angles in radians.

</td>
</tr></tbody>
<tbody><tr>
<td>

**049. A stable-coordinate counterexample in four variables.** Constructs a polynomial in four complex variables that is not a coordinate but becomes one after adjoining a single variable, disproving the Stable Coordinate conjecture in four variables. Every fiber is affine three-space, yet none of its embeddings is rectifiable, also disproving the Abhyankar–Sathaye conjecture even when all fibers are affine spaces. ([Lean](lean/docs/049.md))

</td>
</tr></tbody>
<tbody><tr>
<td>

&emsp;[A stable coordinate that is not a coordinate in four variables](preprints/A-stable-coordinate-that-is-not-a-coordinate-in-four-variables-October-5-2026/stable-coordinate-four-variables.pdf)

We construct an explicit degree-five polynomial over $`\mathbf C`$ that is not a coordinate in four variables but becomes one after adjoining a single variable. This gives a counterexample to the stable coordinate conjecture in four variables. Every fiber is isomorphic to affine three-space, yet its embedding in affine four-space is not rectifiable. Thus the example also disproves the Abhyankar–Sathaye embedding conjecture in ambient dimension four.

</td>
</tr></tbody>
<tbody><tr>
<td>

&emsp;[An explicit noncoordinate polynomial with affine three-space zero fibre](preprints/An-explicit-noncoordinate-polynomial-with-affine-three-space-zero-fibre-September-24-2026/paper.pdf)

We construct an explicit counterexample to the Abhyankar–Sathaye conjecture: a noncoordinate polynomial in four complex variables whose zero fibre is affine three-space. Adjoining variables gives counterexamples in every ambient dimension at least four.

</td>
</tr></tbody>
<tbody><tr>
<td>

**113. Approximate counting and entropy of perfect matchings.** Gives a fully polynomial randomized approximation scheme for counting perfect matchings in arbitrary finite simple graphs, with exact detection of zero counts. Also proves the perfect-matching entropy conjecture of Anari, Oveis Gharan, and Vinzant, bounding the maximum entropy of a matching law at every feasible edge-marginal vector in a loopless labelled multigraph, including boundary points. ([Lean](lean/docs/113.md))

</td>
</tr></tbody>
<tbody><tr>
<td>

&emsp;[A Fully Polynomial Randomized Approximation Scheme for Perfect Matchings in General Graphs](preprints/A-Fully-Polynomial-Randomized-Approximation-Scheme-for-Perfect-Matchings-in-General-Graphs-September-23-2026/main.pdf)

We give a fully polynomial randomized approximation scheme (FPRAS) for counting perfect matchings in arbitrary finite simple undirected graphs, resolving the general-graph perfect-matching approximation problem. The algorithm returns zero with certainty when no perfect matching exists. Otherwise, it achieves relative error <i>ε</i> with failure probability at most <i>δ</i> in worst-case bit time polynomial in the input length, $`\varepsilon ^{-1}`$, and $`\log\delta^{-1}`$.

</td>
</tr></tbody>
<tbody><tr>
<td>

&emsp;[Entropy and Face Dimension of the Perfect-Matching Polytope](preprints/Entropy-and-Face-Dimension-of-the-Perfect-Matching-Polytope-September-23-2026/main.pdf)

We prove the perfect-matching entropy conjecture of Anari, Oveis Gharan, and Vinzant. For every feasible vector <i>x</i> of perfect-matching edge marginals in a loopless labelled multigraph on $`2m\ge2`$ vertices, the maximum entropy $`H(x)`$ of a matching law with marginals <i>x</i> satisfies

$`\displaystyle F(x)-(2-2/m)B(x)\le H(x)\le F(x),`$

where $`F(x)=-\sum_e x_e\log x_e`$ and $`B(x)=-\sum_e(1-x_e)\log(1-x_e)`$. This bound holds throughout the polytope, including its boundary. We also prove the sharp bound $`|\mathop{\mathrm{supp}}\nolimits x|-\dim F_x\le3m-2`$, where <i>F</i><sub><i>x</i></sub> is the minimal face of the perfect-matching polytope containing <i>x</i>.

</td>
</tr></tbody>
</table>
