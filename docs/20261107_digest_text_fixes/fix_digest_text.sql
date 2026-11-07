-- Digest text fixes found by auditing every text field of the five public digests through KaTeX (2026-11-07).
-- Each row is a model-written field with math missing its $…$ or a backslash eaten as a string escape
-- (`\bar` → backspace + "ar", `\alpha` → bell + "lpha", `α` mangled). The site repairs the control characters at
-- render time (app/utils/katex.ts repairTexEscapes); the rest only render once the data is fixed. Run once, in the
-- Supabase SQL editor; every call reports 1 row updated and raises if a node id is missing.

create or replace function pg_temp.fix_node(p_slug text, p_id text, p_field text, p_new text) returns int language plpgsql as $$
declare idx int; n int;
begin
  select ord - 1 into idx from papers p, jsonb_array_elements(p.digest->'nodes') with ordinality as t(node, ord)
    where p.slug = p_slug and t.node->>'id' = p_id;
  if idx is null then raise exception 'no node % in %', p_id, p_slug; end if;
  update papers set digest = jsonb_set(digest, array['nodes', idx::text, p_field], to_jsonb(p_new)), updated_at = now() where slug = p_slug;
  get diagnostics n = row_count;
  return n;
end $$;

with src as (
  select p.slug, t.node->>'id' as id, t.node as node from papers p, jsonb_array_elements(p.digest->'nodes') with ordinality as t(node, ord)
)
select
  pg_temp.fix_node('eth', 'claim-thm-overview-sparse-polynomials-1', 'classification_cite',
    'A Markov-type averaging bound (at most $M/b_0 \le n/\sqrt\lambda$ variables can have incidence above $b_0$) combined with standard branching on those variables, as in sparsification and other exponential-time algorithms; substituting constants cannot raise degree or monomial count, and the zero counts of the branches add up to the total.') as eth_cite,
  pg_temp.fix_node('logspace', 'claim-lem-est-mean-comparison-2', 'classification_cite',
    'A direct double-counting bound: since each $z$ has at most $K_c$ incoming $x$, the $x$-sum is bounded using $X_u\le 1$, and the remaining step is unfolding the definition of the weighted norm with weight $f$. This is bookkeeping inside the parent mean-comparison lemma.') as logspace_cite,
  pg_temp.fix_node('logspace', 'prop-hier-reward-target', 'statement_plain',
    replace((select node->>'statement_plain' from src where slug = 'logspace' and id = 'prop-hier-reward-target'), chr(8) || 'ar', '\bar')) as logspace_bar,
  pg_temp.fix_node('logspace', 'lem-est-mean-comparison', 'statement_plain',
    replace((select node->>'statement_plain' from src where slug = 'logspace' and id = 'lem-est-mean-comparison'), '$b' || chr(10) || 'e<a$', '$b\gtrless a$')) as logspace_ne,
  pg_temp.fix_node('noncoordinate', 'claim-lem-lift-2', 'classification_cite',
    replace((select node->>'classification_cite' from src where slug = 'noncoordinate' and id = 'claim-lem-lift-2'), chr(7) || 'lpha', '\alpha')) as nc_alpha,
  pg_temp.fix_node('noncoordinate', 'claim-lem-lift-4', 'classification_cite',
    'This is an explicit parametrization of the linear relation using the Bézout identity $\alpha h+\beta y=1$, followed by the earlier elimination of $W$ that gives $C\cong A$.') as nc_cite,
  pg_temp.fix_node('unit-distance', 'claim-com-rare-positive-5', 'statement_paper',
    replace((select node->>'statement_paper' from src where slug = 'unit-distance' and id = 'claim-com-rare-positive-5'), 'that \liminf_{t\to\infty}\E_\mu H_p^*/S=0 (along', 'that $\liminf_{t\to\infty}\E_\mu H_p^*/S=0$ (along')) as ud_liminf;

-- Applied 2026-11-07 (all seven returned 1), plus this one, found afterwards in the same field:
with target as (
  select p.id as paper_id, (t.ord - 1)::text as idx, t.node->>'classification_cite' as cite
  from papers p, jsonb_array_elements(p.digest->'nodes') with ordinality as t(node, ord)
  where p.slug = 'noncoordinate' and t.node->>'id' = 'claim-lem-lift-2'
)
update papers p set digest = jsonb_set(p.digest, array['nodes', target.idx, 'classification_cite'], to_jsonb(replace(target.cite, chr(8) || 'eta', '\beta'))), updated_at = now()
from target where p.id = target.paper_id;
