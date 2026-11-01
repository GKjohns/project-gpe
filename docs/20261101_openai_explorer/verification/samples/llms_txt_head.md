# Project GPE: proof maps of OpenAI's openai/math papers (373 families catalogued, 5 digested)

[openai/math](https://github.com/openai/math) is a collection of 721 machine-written math manuscripts in 373 result
families. Project GPE catalogues all of them (title, abstract, discipline, PDF, Lean status) and turns some into
browsable proof maps: every definition, lemma and theorem, plus the major claims inside long proofs, each with a
plain-English statement, an explanation of why it is in the paper, a standard/routine/novel classification, and the
dependency edges between them. This page tells an agent how to read the catalog and the maps. Everything is read-only,
needs no key, and returns JSON.

Two ways in, same tools and same answers:

- **HTTP GET** (works with any fetch or curl): `http://localhost:3120/api/v1`, described below.
- **MCP** (streamable HTTP): `http://localhost:3120/api/mcp`. Add it as a remote MCP server; the tools are the ones below, each
  with an extra `paper` argument (the slug). The catalog endpoints are HTTP only.

## How to use it

1. `GET http://localhost:3120/api/v1/papers` lists the papers with a map. Pick a slug. (To find a result that has no map yet, search the
   catalog: `GET http://localhost:3120/api/v1/families?q=…`.)
2. `GET http://localhost:3120/api/v1/papers/<slug>/get_overview` gives the summary, main results and the section layout.
3. Drill in with `get_node` (the explanation and direct edges) and `read_node` (the verbatim LaTeX statement and proof).
4. For "how does X lead to Y", call `trace`; a node's own edges are only its direct uses, so don't assemble chains by
   hand. `ancestors` gives everything a node rests on or supports.
5. Answer from what the tools return, and cite nodes with their `url` so the user can open them in the map.

Node ids look like `lem-greedy-hashes`; the paper's LaTeX labels (`lem:greedy-hashes`) work too. An unknown id comes back
as an error that lists close matches. Errors are `{ "error": "…" }` with status 400 (bad arguments) or 404 (unknown
paper, node, figure or family).

Example: `GET http://localhost:3120/api/v1/papers/alphaevolve-exploration/trace?from=<node>&to=<node>`

## Catalog

Every openai/math result family, built from the repository's own index (no model involved). A family has a 3-digit
code (`049`), a title and description, a discipline, its manuscripts, Lean status, and `digested`: the maps
made from its manuscripts (slug and counts), `[]` when none is mapped yet.

### list_families

`GET http://localhost:3120/api/v1/families?…`

Families, filtered and paged. Each has number, code, title, description, discipline, members, has Lean, reasoning-trace
PDF (when there is one), and `digested`.

  - `q` (string, optional): case-insensitive text match against family titles and descriptions and manuscript titles and abstracts
  - `discipline` (string, optional): a discipline slug from list_disciplines, e.g. `combinatorics`
  - `digested` (`1` \| `0`, optional): only families with (or without) a map
  - `lean` (`1` \| `0`, optional): only families with (or without) a Lean formalization
  - `sort` (`flagship` \| `number` \| `title` \| `members`, optional): default `flagship` (featured families first, then mapped, then by number)
  - `limit` (integer, optional): default 50, max 400
  - `offset` (integer, optional)

### get_family

`GET http://localhost:3120/api/v1/families/<code>`

One family (`049` or `49`) with every manuscript: title, abstract, publication date, PDF, source and README links,
Lean status, and the map's slug when one exists.

### list_disciplines

`GET http://localhost:3120/api/v1/disciplines`

Catalog totals (families, manuscripts, disciplines, digested, Lean, the indexed commit) and each discipline's slug, name,
family count and digested count.

## Papers

- `alphaevolve-exploration`: Mathematical exploration and discovery at scale, 65 nodes. http://localhost:3120/alphaevolve-exploration
- `klt-infinitely-generated`: A klt generalized pair with infinitely generated canonical ring, 24 nodes. http://localhost:3120/klt-infinitely-generated
