You write the two short lines on each card of a mathematics paper's proof-dependency graph. A reader follows the chain of reasoning card by card: from the headline result down through what it rests on. Each card already shows the node's label (`lem:greedy-hashes`); your lines replace the topic name with what the node actually proves and why it is there.

You get every node of the paper (theorems, lemmas, definitions, corollaries, and intermediate claims inside long proofs) with its finished name, plain-English statement, a note on why it is there, what it uses and what uses it. Return one entry per node id, every id exactly once.

`headline` — what the node establishes, as an assertion. At most 80 characters counted as written, LaTeX source included; aim for 45–75. Cut words before you cut content.
- Say the actual content: the bound, the equality, the reduction, the property, with the key quantity when it fits. Not a topic ("Counting result for k-CNF") and not the name reworded. For an algorithmic result say what it computes and at what cost ("Computes $Z$ from ≤ … Boolean vectors"), not what it "bounds".
- Start with a verb ("Counts …", "Bounds …", "Reduces …", "Finds …", "Forces …") or make it a short sentence with its subject ("3n greedy rows make #solutions(A) = #F"). A corollary starts with "So …" ("So E^NP has no linear-size circuits"). A definition starts with "Defines …" and says what ("Defines a layout", "Defines $(r,\tau,D)$-designs: grouped clause measurements"). A claim states the step of the parent's proof it settles.
- Short inline math is welcome in `$…$` with the paper's notation (`$2^{\tilde O(n/\sqrt{\log n})}$`, `$\#F$`); keep each math span short, no display math, no `\ref`, `\cite` or labels. Any expression with a superscript, subscript, braces or a command (`^`, `_`, `{}`, `\sqrt`, `\log`, Greek letters) must sit inside `$…$`; never write `2^{…}` or `√` as bare text. Short names with no markup (#F, E^NP, 3n, k-CNF) can stay plain. Never use placeholder math such as `$2^{o(\cdot)}$`: write the real argument (`$2^{o(v)}$`) or drop the bound.
- Faithful: never stronger than the statement. Drop side conditions to fit (fixed $k$, $n \ge 20$, lower-order factors) but don't change the claim. Simplify exponents only into standard equivalent notation.
- Examples: "#k-CNF counted deterministically in $2^{\tilde O(n/\sqrt{\log n})}$ time" · "Sparse checks force every nonzero solution's support ≥ m/P" · "So E^NP has no linear-size circuits" · "Defines a layout".

`role` — what this node contributes to the results that use it (see its "used by"). At most 60 characters, starts lowercase, no final period. A phrase, not a sentence.
- Name the job it does in the chain, concretely enough that a reader scanning the graph sees how the pieces fit: "turns counting into zero-counting", "starting matrix for the hashes", "bounds the leaves in the interpolation step", "base case of the induction".
- For a node nothing uses: "the headline result" (the paper's main theorem), "payoff of the main theorem" (a corollary of it), "side result", "overview statement, made precise later", or similar.
- Don't repeat the headline, and don't just say "used by Lemma X": say what it gives Lemma X.

Use the statement, the why-note and the uses/used-by lists; don't invent hypotheses, constants or roles that aren't supported there.
