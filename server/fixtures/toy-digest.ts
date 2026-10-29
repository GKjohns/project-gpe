// Hand-written digest for UI sprints: 3 sections, 8 nodes (2 theorems, 4 lemmas, 1 definition, 1 claim), one inferred dep.
import type { PaperDigest, ProofNode, RunMetrics } from '#shared/types'

const metrics: RunMetrics = {
  statements_in_source: 7,
  statements_extracted: 7,
  claims: 1,
  refs_mechanical: 9,
  refs_inferred: 1,
  schema_retries: 0,
  critique_findings: 1,
  review_items: 0,
  calls: 18,
  tokens_in: 41_200,
  tokens_out: 6_300,
  tokens_cached: 30_100,
  cost_usd: 0.21,
  wallclock_ms: 94_000,
  per_stage: {
    fetch: { ms: 800, cost_usd: 0, calls: 0 },
    chunk: { ms: 40, cost_usd: 0, calls: 0 },
    outline: { ms: 21_000, cost_usd: 0.06, calls: 1 },
    extract: { ms: 6_000, cost_usd: 0.01, calls: 1 },
    resolve: { ms: 5_000, cost_usd: 0.01, calls: 1 },
    critique: { ms: 19_000, cost_usd: 0.05, calls: 1 },
    annotate: { ms: 22_000, cost_usd: 0.04, calls: 7 },
    classify: { ms: 20_000, cost_usd: 0.04, calls: 7 },
    finalize: { ms: 60, cost_usd: 0, calls: 0 }
  }
}

const ref = (label: string, section: string, sectionTitle: string, line: number, page: number) =>
  ({ label, section, sectionTitle, file: 'toy.tex', line, page })

const nodes: ProofNode[] = [
  {
    id: 'def-sparse',
    name: 'Sparse polynomial',
    kind: 'definition',
    statement_paper: 'A polynomial $p \\in \\F[x_1,\\dots,x_n]$ is \\emph{$s$-sparse} if it has at most $s$ monomials with nonzero coefficient.',
    statement_plain: 'A polynomial is s-sparse when it has at most s nonzero terms.',
    explanation: 'Fixes the size measure that every later bound is stated in.',
    headline: 'Defines $s$-sparse: at most $s$ nonzero terms',
    role: 'the size measure every bound is stated in',
    classification: 'standard',
    classification_cite: 'Standard notion; see e.g. Zippel (1979).',
    paper_ref: ref('def:sparse', '1', 'Preliminaries', 12, 1),
    deps_paper: [],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'lem-schwartz-zippel',
    name: 'Few roots for low-degree polynomials',
    kind: 'lemma',
    statement_paper: 'Let $p \\in \\F[x_1,\\dots,x_n]$ be nonzero of total degree $d$ and $S \\subseteq \\F$ finite. Then $\\Pr_{a \\in S^n}[p(a) = 0] \\le d/|S|$.',
    statement_plain: 'A nonzero polynomial of degree d vanishes on at most a d/|S| fraction of a grid S^n.',
    explanation: 'The probabilistic engine of the identity test: random points almost never hit a root.',
    headline: 'A nonzero degree-$d$ polynomial vanishes on ≤ $d/|S|$ of $S^n$',
    role: 'why a few evaluations catch a nonzero polynomial',
    classification: 'standard',
    classification_cite: 'Schwartz–Zippel lemma (Schwartz 1980; Zippel 1979).',
    paper_ref: ref('lem:schwartz-zippel', '1', 'Preliminaries', 20, 1),
    deps_paper: [],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'lem-restrict',
    name: 'Restriction keeps sparsity',
    kind: 'lemma',
    statement_paper: 'If $p$ is $s$-sparse then for every $i$ and $c \\in \\F$, $p|_{x_i = c}$ is $s$-sparse.',
    statement_plain: 'Fixing a variable to a constant never increases the number of terms.',
    explanation: 'Lets the induction on variables stay inside the class of s-sparse polynomials.',
    headline: 'Fixing a variable never adds terms',
    role: 'keeps sparsity through the reduction',
    classification: 'routine',
    classification_cite: 'Immediate from the definition; new only as stated here.',
    paper_ref: ref('lem:restrict', '2', 'Reduction', 41, 2),
    deps_paper: ['def-sparse'],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'lem-hash',
    name: 'Hashing monomials apart',
    kind: 'lemma',
    statement_paper: 'For an $s$-sparse $p$ there is a substitution $x_i \\mapsto y^{k^{i}}$ with $k \\le O(s^2 \\log n)$ under which distinct monomials of $p$ map to distinct powers of $y$.',
    statement_plain: 'A Kronecker-style substitution with small base keeps all monomials of a sparse polynomial distinct.',
    explanation: 'Turns a many-variable sparse polynomial into a one-variable one without cancellation, which is where the speedup comes from.',
    headline: 'Kronecker substitution keeps all monomials of a sparse polynomial distinct',
    role: 'turns many variables into one',
    classification: 'novel',
    classification_cite: 'The base bound O(s^2 log n) improves on the classical Kronecker substitution, whose base grows with the degree; no prior result gives this dependence for this class.',
    paper_ref: ref('lem:hash', '2', 'Reduction', 58, 2),
    deps_paper: ['def-sparse'],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'claim-lem-hash-1',
    name: 'Collisions are rare for a random base',
    kind: 'claim',
    parent_id: 'lem-hash',
    statement_paper: 'For $k$ chosen uniformly from the first $O(s^2 \\log n)$ primes, a fixed pair of monomials collides with probability at most $1/s^2$.',
    statement_plain: 'Any two given monomials collide under a random small prime base with probability at most 1/s².',
    explanation: 'A union bound over the s² pairs then shows some base works, which proves the lemma.',
    headline: 'Two monomials collide with probability ≤ $1/s^2$',
    role: 'union-bound step behind the hash',
    classification: 'routine',
    classification_cite: 'Prime-counting union bound in the style of Klivans–Spielman (2001).',
    paper_ref: ref('lem:hash', '2', 'Reduction', 66, 2),
    deps_paper: [],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'lem-univariate',
    name: 'Univariate test in sparse time',
    kind: 'lemma',
    statement_paper: 'An $s$-sparse univariate $q \\in \\F[y]$ of degree $D$ can be tested for zero with $O(s \\log D)$ evaluations.',
    statement_plain: 'Checking whether a sparse one-variable polynomial is zero takes about s log D evaluations.',
    explanation: 'The base case the reduction lands in; its cost sets the final running time.',
    headline: 'Tests a sparse univariate polynomial with ~$s\\log D$ evaluations',
    role: 'the zero test run after hashing',
    classification: 'standard',
    classification_cite: 'Ben-Or–Tiwari (1988) sparse interpolation.',
    paper_ref: ref('lem:univariate', '2', 'Reduction', 90, 3),
    deps_paper: [],
    deps_inferred: ['lem-schwartz-zippel'],
    friction: [{ kind: 'inferred_dep', severity: 'info', note: 'Proof says "by the usual random-evaluation argument" without a \\ref; inferred to use the Schwartz–Zippel lemma.' }]
  },
  {
    id: 'thm-main',
    name: 'Fast identity test for sparse polynomials',
    kind: 'theorem',
    statement_paper: 'There is a deterministic algorithm that decides whether an $s$-sparse $p \\in \\F[x_1,\\dots,x_n]$ given as a black box is identically zero using $\\mathrm{poly}(s, \\log n)$ queries.',
    statement_plain: 'Sparse polynomials can be tested for zero deterministically with polynomially many queries in s and log n.',
    explanation: 'The paper\'s main result: hash to one variable, then run the univariate test.',
    headline: 'Tests sparse polynomials for zero with poly$(s,\\log n)$ queries',
    role: 'the headline result',
    classification: 'novel',
    classification_cite: 'Combines Lemma 2.2 with the univariate test; the query bound in log n rather than n is new.',
    paper_ref: ref('thm:main', '3', 'Main result', 120, 4),
    deps_paper: ['lem-hash', 'lem-univariate', 'lem-restrict'],
    deps_inferred: [],
    friction: []
  },
  {
    id: 'thm-lower',
    name: 'Matching query lower bound',
    kind: 'theorem',
    statement_paper: 'Every deterministic black-box identity test for $s$-sparse polynomials over $\\F$ needs $\\Omega(s)$ queries.',
    statement_plain: 'No deterministic test can use fewer than about s queries.',
    explanation: 'Shows the main theorem is tight in s up to polynomial factors.',
    headline: 'Every deterministic test needs about $s$ queries',
    role: 'shows the main theorem is near-optimal',
    classification: 'routine',
    classification_cite: 'Adversary argument; standard technique applied to this setting.',
    paper_ref: ref('thm:lower', '3', 'Main result', 150, 5),
    deps_paper: ['def-sparse', 'lem-schwartz-zippel'],
    deps_inferred: [],
    friction: []
  }
]

export const toyDigest: PaperDigest = {
  slug: 'toy',
  title: 'A Toy Sparse Identity Test',
  authors: ['A. Example', 'B. Sample'],
  source: { kind: 'upload', ref: 'toy.tex' },
  sections: [
    { id: '1', title: 'Preliminaries', level: 1, order: 0, file: 'toy.tex', line: 8 },
    { id: '2', title: 'Reduction', level: 1, order: 1, file: 'toy.tex', line: 36 },
    { id: '3', title: 'Main result', level: 1, order: 2, file: 'toy.tex', line: 115 }
  ],
  nodes,
  root_ids: ['thm-main', 'thm-lower'],
  macros: { '\\F': '\\mathbb{F}' },
  generated_at: '2026-10-29T12:00:00.000Z',
  run_id: '00000000-0000-0000-0000-000000000000',
  metrics
}
