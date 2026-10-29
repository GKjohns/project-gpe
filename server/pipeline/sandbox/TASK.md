# Task: outline the proof structure of a mathematics paper

You are outlining the proofs of a mathematics paper so that a reader can browse it as a dependency graph. Work in this directory:

- `src/` — the paper's LaTeX source, every file, as `src/<path>`: {{FILES}}. Main file: `{{MAIN_FILE}}`.
- `skeleton.md` — read this first. Computed deterministically from the LaTeX: every theorem-like statement with its label, number, section and source span; the span of its proof environment (if any) and that proof's length in lines; the `\ref` edges found inside each proof. It marks the proofs you must outline with `outline: yes`. The skeleton is a fact of the source: do not add, rename or remove statements.
- `skeleton.json` — the same skeleton as JSON (what the validator reads).
- `validate_outline.mjs` — the validator.

Line numbers are per file and match what the Read tool and `grep -n` show. In spans, `file` is the path **without** the `src/` prefix (for example `{{MAIN_FILE}}`).

## Your job

For every proof marked `outline: yes` ({{LONG_PROOFS}} proofs of {{CLAIM_PROOF_LINES}} or more lines), list the **major claims** the proof establishes, in the order the proof establishes them. A major claim is an intermediate result a careful reader would name when summarizing the proof to a colleague: "first we show X, then using X and Lemma 4.2 we get Y, and Y with Z gives the statement." Typically 2–6 per proof; long proofs may warrant up to about 10. Do not split a proof into a claim per paragraph, and do not create a claim that just restates the parent statement or a labeled statement.

For each claim give:

- `id`: a unique short id (`c1`, `c2`, …); it is renamed afterwards. Use the same ids inside `restsOn`.
- `parentLabel`: the label of the statement whose proof contains the claim, exactly as in the skeleton.
- `nameHint`: a short semantic name, 3–8 words, saying what the claim establishes (not "Step 1").
- `span`: `{ "file", "startLine", "endLine" }` — the exact lines where the claim is stated and argued. Spans must lie inside the parent's proof, must not overlap each other, and together should cover the substantive part of the proof.
- `restsOn`: what this claim uses: labels of skeleton statements (cited by `\ref` or by name or number in prose) and ids of earlier claims. Include dependencies stated in prose without a `\ref` ("by the previous lemma", "as in Section 4") when you can tell which statement is meant. Never the claim's own parent.
- `confidence`: 0–1, how sure you are that this is a real joint of the argument with the right span.

### Statements proved elsewhere

- A statement may have **no proof environment** because the text proves it elsewhere ("Appendix A proves the lemma"). If that argument is {{CLAIM_PROOF_LINES}} lines or longer, outline it with `parentLabel` set to that statement and spans where the argument lives. Labeled lemmas there are already statements; your claims should be the steps that assemble them, resting on those lemmas.
- A statement may have **more than one proof environment** (for example a fixed-density and an arbitrary-density proof of the same theorem). The skeleton records only the first. When the proofs together are {{CLAIM_PROOF_LINES}} lines or longer, outline them as one argument under the same `parentLabel`; spans may lie in either proof. `grep -n 'begin{proof}' src/*.tex` finds them all.
- Proofs shorter than {{CLAIM_PROOF_LINES}} lines not covered by these two cases get **no claims** (the validator rejects them).

### Flags

Report oddities of the skeleton or the text in `flags` (each `{ "kind", "label"?, "note" }`):

- `unused_statement`: a labeled statement no proof uses, directly or in prose (ignore main theorems and corollaries).
- `ref_to_nonstatement`: a proof leans on something that is not a skeleton statement (an equation, a section, an external citation) for a step that matters.
- `suspect_span`: a statement or proof span in the skeleton that looks wrong (proof attached to the wrong statement, a proof that is really two).
- `possible_restatement`: a statement that restates another (an overview theorem restated later).
- `other`: anything else a reader building the dependency graph should know.

Keep flags to the ones that matter; an empty list is fine.

## Output: `outline.json`

```json
{
  "claims": [
    { "id": "c1", "parentLabel": "lem:example", "nameHint": "Bounded degree after pruning",
      "span": { "file": "{{MAIN_FILE}}", "startLine": 120, "endLine": 148 },
      "restsOn": ["lem:other"], "confidence": 0.85 }
  ],
  "flags": [
    { "kind": "ref_to_nonstatement", "label": "lem:example", "note": "the key step cites equation (3.2)" }
  ]
}
```

## How to work

1. Read `skeleton.md`. Then read each long proof (the Read tool with `offset`/`limit`; read in large chunks, 200–400 lines at a time, rather than many small reads). Use `grep -n` to find prose references ("Lemma 4.2", "the previous lemma", "Appendix") and second proofs.
2. **Write `outline.json` early and keep it current**: after each proof you outline, rewrite the file with everything so far. If you run out of turns or time, what is in the file is what counts.
3. When every long proof is outlined, run `node validate_outline.mjs outline.json` and fix **every error**. Warnings about spans outside the recorded proof are fine when the argument really lives there (second proof, appendix).
4. Finish with one short paragraph: how many claims, which proofs, anything uncertain. Do not print the JSON.

## Rules

- Never invent a statement, claim or dependency that is not in the text.
- Double-check every span against the line numbers the Read tool shows.
- Budget: at most {{MAX_TURNS}} turns and about ${{BUDGET}} of model spend. Be economical: do not re-read files you have already read, and do not explore beyond what the outline needs.
- You may only write `outline.json` (and scratch files under `/tmp`). Do not modify `src/`, the skeleton, or the validator.
