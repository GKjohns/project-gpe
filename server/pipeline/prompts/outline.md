You are outlining the proof structure of a mathematics paper so that a reader can browse it as a dependency graph.

You are given two things:

1. **The skeleton**, computed deterministically from the LaTeX: every theorem-like statement with its label, display number, section and source span; the span of its proof environment (if any) and that proof's length in lines; and the `\ref` edges found inside each proof. The skeleton is a fact of the source. Do not add, rename or remove statements.
2. **The full LaTeX source**, every file, every line prefixed with its line number (`123| ...`). Line numbers are per file.

## Your job

For every proof marked `outline: yes` in the skeleton (proofs of 60 or more lines), list the **major claims** the proof establishes, in the order the proof establishes them. A major claim is an intermediate result a careful reader would name when summarizing the proof to a colleague: "first we show X, then using X and Lemma 4.2 we get Y, and Y with Z gives the statement." Typically 2–6 per proof; long proofs may warrant up to about 10. Do not split a proof into a claim per paragraph, and do not create a claim that just restates the parent statement or a labeled statement.

For each claim give:

- `id`: any unique short id you like (for example `c1`, `c2`, ...); it is renamed afterwards. Use the same ids inside `restsOn`.
- `parentLabel`: the label of the statement whose proof contains the claim, exactly as in the skeleton.
- `nameHint`: a short semantic name, 3–8 words, saying what the claim establishes (not "Step 1").
- `span`: `file`, `startLine`, `endLine` — the exact lines (from the line-number prefixes) where the claim is stated and argued. Spans must lie inside the parent's proof, must not overlap each other, and together should cover the substantive part of the proof.
- `restsOn`: what this claim uses: labels of skeleton statements (cited by `\ref` or by name or number in prose) and ids of earlier claims. Only list labels that appear in the skeleton and ids of claims you created. Include dependencies stated in prose without a `\ref` ("by the previous lemma", "as in Section 4") when you can tell which statement is meant.
- `confidence`: 0–1, how sure you are that this is a real joint of the argument with the right span.

### Statements proved elsewhere

- A statement may have **no proof environment** because the text proves it elsewhere, for example "Appendix A proves the lemma". If that argument is 60 lines or longer, outline it with `parentLabel` set to that statement and spans in the appendix (or wherever the argument lives). Labeled lemmas inside that appendix are already statements; your claims there should be the steps that assemble them into the statement, resting on those lemmas.
- A statement may have **more than one proof environment** (for example "Proof of the fixed-density bound in Theorem 1.1" and a later "Proof of the arbitrary-density bound"). The skeleton records only the first. When the proofs together are 60 lines or longer, outline them as one argument under the same `parentLabel`; spans may lie in either proof.
- Proofs shorter than 60 lines that are not covered by the two cases above get **no claims**.

### Flags

Report oddities of the skeleton or the text in `flags` (each with a short `note` and the `label` it concerns, if any):

- `unused_statement`: a labeled statement that no proof uses, directly or in prose (ignore the main theorems and their corollaries).
- `ref_to_nonstatement`: a proof leans on something that is not a skeleton statement (an equation, a section, an external citation) for a step that matters.
- `suspect_span`: a statement or proof span in the skeleton that looks wrong (proof attached to the wrong statement, a proof that is really two).
- `possible_restatement`: a statement that restates another (for example an overview theorem restated in a later section).
- `other`: anything else a reader building the dependency graph should know.

Keep flags to the ones that matter; an empty list is fine.

## Rules

- Never invent a statement, claim or dependency that is not in the text.
- Line numbers must come from the prefixes; double-check every span against them.
- Output JSON matching the schema, nothing else.
