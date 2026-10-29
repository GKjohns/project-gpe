# Project GPE (Graphical Proof Explorer) — project brief

Renamed from the working name "Digest" on Oct 29. If it is renamed again, NOT "Proof Atlas" / "ProofAtlas": proofatlas.ai already exists (Lech Mazur) and is a different product — see "Not to be confused with" below.

> **Implementation:** Phase 1 (paper only) is planned and tracked in [20261029_digest_v1/implementation_plan.md](20261029_digest_v1/implementation_plan.md).

## One-line

Point it at a math paper (PDF/LaTeX) and, optionally, the Lean 4 repo that formalizes it. Get back a browsable, hierarchical map of the proof: semantically named nodes, plain-English explanations, dependency edges, links to the exact paper section and Lean declaration, and a chat that answers questions with links into the map. When both sources are present, surface friction between what the paper says and what the Lean actually proves.

## Why this exists

AI systems are now producing long, hard-to-read proofs of major results (first target: OpenAI's Oct 2026 disproof of the Exponential Time Hypothesis — 67-page paper + Lean formalization in `openai/math`, Apache-2.0). Lean certifies the formal statement; it does not help a human understand the argument or confirm that the prose proof and the formal proof are the same proof. Mathematicians currently do this digestion by hand. The pieces of an automated version exist in separate research tools (Lean Atlas for dependency graphs, LeanExplore for LLM informalization of declarations, ProofFlow for parsing prose proofs into DAGs) but nobody has shipped the glue, and nobody has done it for ETH.

The software analogy: when an agent builds something, you make it produce a verification artifact you can click into. This is that artifact, for proofs.

## Not to be confused with ProofAtlas.ai

proofatlas.ai is a platform where AI agents pursue open problems in parallel and the site keeps an evidence graph of routes, useful failures, Lean checks, and next tasks. It points forward: "here's an unsolved problem, here's what's been tried." Its ETH page (as of late Oct 2026) still lists ETH as open and has nothing on OpenAI's disproof.

GPE points the other way: take a finished proof (paper + Lean) and make it readable. Humans digesting proofs that already exist, not agents searching for proofs. Do not build a research workspace, task queue, agent-contribution flow, or open-problem directory. One paper in, one browsable map out.

## Inputs

* Paper: PDF or LaTeX source. LaTeX strongly preferred when available (the `openai/math` repo ships `.tex`).
* Lean repo (optional): a Lean 4 project. For ETH: the Lean directory under `openai/math` for the ETH paper.
* Config: which LLM to use, target theorem name(s) in Lean, paper title.

## Output

A single static site (or local web app) per paper:

1. **Map view** — the proof as a DAG/tree. Main theorem at the root. Nodes are definitions, lemmas, propositions, theorems, and (for long proofs) the major claims inside a proof. Collapsible by section. Color/badge by status.
2. **Node view** — click a node and see:
   * semantic name (e.g. "Sparsification step" not "Lemma 4.7" or `lem_sparsify_aux₂`)
   * the formal statement as written in the paper
   * a 1–3 sentence plain-English explanation of what it says and why it's needed
   * what it depends on / what depends on it (links)
   * paper location (section, page, label) and Lean location (file, declaration name), each linked
   * classification: `standard` (known result, cited or folklore), `routine` (new but mechanical), `novel` (where the actual idea lives)
   * friction flags (see below)
3. **Chat panel** — an LLM with the full node JSON in context. Answers like "where does the √log n come from?" or "which three nodes contain the new idea?" and every answer links to nodes.
4. **Friction report** — a page listing every place the paper and the Lean disagree.

## Data model

One JSON file per paper. Rough shape:

```ts
type Node = {
  id: string;                 // stable slug
  name: string;               // semantic, human-written-sounding
  kind: "definition" | "lemma" | "proposition" | "theorem" | "claim" | "remark";
  statement_paper: string;    // verbatim-ish from paper (LaTeX ok)
  statement_plain: string;    // plain English
  explanation: string;        // why it's here, what it does for the proof
  classification: "standard" | "routine" | "novel" | "unknown";
  paper_ref: { label?: string; section: string; page?: number; anchor?: string };
  lean_ref?: { file: string; decl: string; line?: number };
  deps_paper: string[];       // node ids, as the LLM reads them from the prose
  deps_lean?: string[];       // node ids, from the Lean compiler
  friction: Friction[];
};

type Friction = {
  kind: "missing_in_lean" | "missing_in_paper" | "statement_mismatch"
      | "dep_in_lean_not_paper" | "dep_in_paper_not_lean" | "weaker_in_lean"
      | "unmatched_lean_decl";
  severity: "info" | "warn" | "high";
  note: string;
};
```

Edges are derived from `deps_*`. Keep paper-derived and Lean-derived edges separate so they can be diffed.

## Pipeline

### Phase 1 — paper only (ship this first)

1. **Chunk the paper** by section/statement. LaTeX makes this near-trivial (`\begin{lemma}`, `\label`, `\ref`). For PDF, use a layout-aware extractor and then an LLM pass to recover structure.
2. **Extract nodes.** LLM pass over each section: list every formal statement, plus major claims inside long proofs. Output JSON matching the schema. Must preserve paper labels so later passes can resolve `\ref`s.
3. **Resolve dependencies.** For each node, the LLM reads its proof and lists which other nodes it uses. Explicit `\ref`s are resolved mechanically; implicit uses ("by the standard argument", "as in Section 3") are LLM-inferred and marked as such.
4. **Annotate.** Topological order, dependencies first (so each explanation can assume its deps are already explained — this is the LeanExplore trick and it matters for coherence). Produce `name`, `statement_plain`, `explanation`, `classification`.
5. **Render.** Static site: map + node pages + chat. Chat is a thin wrapper that stuffs the JSON (or a retrieval over it) into context.

Deliverable: the ETH paper, browsable, end to end. No Lean yet.

### Phase 2 — Lean

1. **Extract the real DAG.** Build the Lean project (`lake build`; budget time and RAM, it pulls Mathlib). Pull declaration names, statements (pretty-printed types), file/line, and the constants each proof term uses. Lean Atlas (NyxFoundation/lean-atlas) has an extractor — reuse it or crib from it rather than writing your own. LeanArchitect's dependency inference is the other reference.
2. **Informalize declarations.** Same topological LLM pass as Phase 1 step 4, but over Lean declarations. Mathlib declarations should be collapsed into a single "standard library" boundary unless they're load-bearing.
3. **Align Lean ↔ paper.** This is the hard, valuable part. For each Lean declaration, the LLM (with both the Lean statement and the candidate paper nodes in context) proposes a match with a confidence. Unmatched declarations on either side become nodes with friction flags. Expect Lean to have many more nodes than the paper (helper lemmas); group them under their paper parent.

### Phase 3 — friction

With both graphs aligned, diff them mechanically and have the LLM write the note:

* Lean proves a weaker or differently-scoped statement than the paper claims (e.g. ETH: the Lean covers exact counting for canonically encoded fixed-width formulas; the paper also states a sharper bound in terms of clause count — check whether that bound is formalized).
* A paper node has no Lean counterpart (gap, or absorbed into something else?).
* A Lean dependency edge that the paper never mentions (hidden assumption in the prose).
* A paper dependency the Lean doesn't use (the prose argument isn't the one that was formalized — this is the "lost in translation" failure mode and the single most important thing to surface).
* Definitions that differ between sources.

Friction report = ranked list of these with links. This is the feature that gets a mathematician to care.

## UI notes

* Progressive disclosure. Default view is the paper's top-level structure (maybe 20–40 nodes). Expand to see claims inside proofs; expand again to see Lean helpers.
* Every node page should be linkable (URL per node) so people can share "look at this step."
* Show both source locations side by side when both exist.
* Keep it static-hostable. GitHub Pages is fine. Chat can hit an API key client-side for the demo or run as a tiny server.
* Don't over-design. A clean tree + a good node page beats a fancy graph layout.

## Prompting notes

* Annotate in dependency order with upstream explanations in context; without this, explanations contradict each other.
* Force the schema. Reject and retry on invalid JSON.
* For `classification`, ask the model to cite why (which textbook result, which prior paper) and record the citation; "novel" should be rare and justified.
* For alignment, give the model the Lean pretty-printed type, not the proof body, and the paper statement, and ask for a match + confidence + what differs.
* For the chat, instruct it to answer with node ids and never to assert something not in the JSON.

## Non-goals (for now)

* Autoformalization (prose → Lean). Out of scope; the hard problem is elsewhere.
* Checking proofs. Lean already does this. The tool reads; it doesn't verify.
* Pretty graph layout research. Tree with expand/collapse is enough.
* Supporting Coq/Isabelle.

## First target

`openai/math` → "The Exponential Time Hypothesis is False" (paper dated Oct 17, revised Oct 25, 2026) + its Lean directory. Phase 1 on the paper alone is a complete, publishable demo.

Second target if the first works: one of the Erdős problem papers from the same repo, since those have human-written digests to compare against (Alon–Bloom–Gowers–Litt–Sawin for the unit distance conjecture).

## References

* Lean Atlas — dependency graph viewer for Lean 4 projects: https://github.com/NyxFoundation/lean-atlas
* LeanExplore — LLM informalization over Mathlib's dependency graph, topological order: https://arxiv.org/abs/2506.11085
* LeanArchitect — blueprint extraction from annotated Lean: https://arxiv.org/abs/2601.22554
* ProofFlow — parsing NL proofs into a dependency DAG: https://arxiv.org/abs/2510.15981
* Navier–Stokes "lost in translation" — why Lean-verified ≠ the prose proof is right: https://arxiv.org/abs/2610.08144
* Lean blueprint tooling (Massot): https://github.com/PatrickMassot/leanblueprint
* OpenAI math repo: https://github.com/openai/math
