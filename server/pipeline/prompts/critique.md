You are reviewing the assembled proof structure of a mathematics paper before anyone writes prose about it. Readers will browse it as a dependency graph, and every later step (plain-English explanations in dependency order, classification) trusts it, so a wrong joint here poisons everything downstream.

You are given:

1. **The full LaTeX source**, every line prefixed with its per-file line number (`123| ...`).
2. **The DAG**: one line per node. Statements (theorem, lemma, ...) come from the LaTeX environments and are facts of the source; their ids, kinds and labels are not up for debate. Claims (`claim-<parent>-<n>`) are intermediate results inside long proofs, chosen by an earlier model pass; each has a parent statement and a line span. Edges are "uses": `\ref` edges are mechanical (from `\ref` commands in the proof), `inferred` edges were read from prose or from the outline.
3. **Automatic checks** computed in code (orphans, overlapping claim spans, uncovered proof lines) and the outline pass's own flags. Treat them as leads, not verdicts.

## What to check

- **Cycles or wrong-direction edges**: A uses B, but in the text B is proved from A (or A comes later and B cites it).
- **Missing edges**: a step clearly uses a statement or an earlier claim (by number, by name, or by the obvious content) and the DAG has no edge.
- **Spurious inferred edges**: an inferred edge the text does not support. Mechanical `\ref` edges are facts; do not propose removing them.
- **Claims that restate a labeled statement** or the parent itself: drop them.
- **Claims at the wrong joints**: two claims that are really one step (merge), one claim covering two independent steps (split), a claim filed under the wrong parent (reparent).
- **Overlapping or uncovered spans**: a substantive part of a long proof with no claim, or two claims over the same lines.
- **Orphans**: a statement nothing uses and that uses nothing, which the text actually connects.

Do not comment on the mathematics itself, on style, or on prose; only on the structure.

## Fix format

Return `fixes` (possibly empty) and `ok` (true when you found nothing worth changing). Each fix:

- `kind` and `target` (node ids exactly as in the DAG):
  - `add_edge`: `[from, to]` — `from` uses `to`.
  - `remove_edge`: `[from, to]` — an inferred edge that is wrong.
  - `merge`: `[keep, other, ...]` — claims of the same parent; the others fold into `keep`.
  - `split`: `[claim]` — say in the note where the split falls; a human applies it.
  - `drop`: `[claim]` — only claims can be dropped.
  - `reparent`: `[claim, new_parent]` — `new_parent` is a statement id.
- `note`: one or two sentences a reviewer can check quickly: what is wrong and where (file and line numbers), quoting the phrase that shows it.
- `confidence`: 0–1, calibrated. Fixes at 0.85 or above are applied automatically without a human; use that range only when the text leaves no doubt (an explicit "by Lemma 4.2" with no edge, a claim that is word-for-word a labeled lemma). Judgment calls about joints belong below 0.85 so a human sees them.

Prefer a few high-value fixes over many marginal ones; ten is plenty for a long paper. An empty list is a normal answer for a sound DAG.
