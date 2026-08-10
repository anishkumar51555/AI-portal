# ADR-008 — Postgres full-text search over a dedicated search engine

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`02-data-model.md §4`](../02-data-model.md#4-full-text-search)

## Context

Deliverable #3 requires "a clean, searchable, and categorized user interface". Users must
search names, descriptions, and READMEs, filter by type and tag, and sort by relevance or
popularity. Realistic scale: hundreds of components, optimistically thousands.

## Options considered

### A — `LIKE '%query%'`

- ➕ Zero setup
- ➖ Cannot use an index — a sequential scan on every keystroke
- ➖ No stemming ("parsing" will not match "parse"), no ranking, no multi-word handling
- ➖ Looks amateurish the first time someone searches

### B — Elasticsearch / OpenSearch

- ➕ The right answer at scale; excellent relevance, facets, and fuzziness
- ➖ Another container, ~1 GB RAM, and no meaningful free hosted tier
- ➖ Requires an index-sync pipeline and reconciliation for drift
- ➖ Days of work for a dataset that fits in Postgres's cache

### C — Postgres `tsvector` + GIN, plus `pg_trgm` for typo tolerance

- ➕ No new infrastructure — the database is already there
- ➕ Stemming, stop words, multi-word queries, and weighted ranking built in
- ➕ Single-digit milliseconds at this scale with a GIN index
- ➕ Generated column: cannot drift, no sync job, no reconciliation
- ➕ Facets and filters are ordinary SQL over the same rows
- ➖ Weaker relevance tuning than a dedicated engine
- ➖ Requires a hand-written migration and one raw query

### D — Algolia / Typesense Cloud

- ➕ Excellent UX, instant-search out of the box
- ➖ Paid past a small free tier; sync pipeline; vendor lock

## Decision

**Option C — a `GENERATED ALWAYS ... STORED` `tsvector` column with a GIN index, queried
with `websearch_to_tsquery`.**

Decisive factor: **a generated column cannot go stale.** Every alternative that involves a
separate index introduces a sync problem — and a search index that silently drifts from
the database is a genuinely nasty class of bug. Postgres maintains this column itself, in
the same transaction as the write. There is no pipeline, no lag, and nothing to
reconcile.

Sub-decisions worth noting:

- **Weighting** — `displayName`/`name` at weight A, `summary` at B, `readme` at C, so a
  title match outranks a passing mention in a README.
- **`websearch_to_tsquery`, not `to_tsquery`** — it accepts natural user input
  (`pdf OR docx -legacy`) and never throws on malformed input. `to_tsquery` raises a
  syntax error on a bare apostrophe, which becomes a 500 from your search box.
- **`pg_trgm`** on `displayName` for typo tolerance, at negligible cost.

## Consequences

**Positive**

- No extra container, locally or in production.
- Search results are transactionally consistent with the catalog — a component is
  findable the instant it is published.
- Filters, facets, and search share one query and one `WHERE` clause.
- Ranking is genuinely good: stemming and weighting cover most real queries.

**Negative**

- One hand-written SQL migration (Prisma cannot express generated columns).
- Search lives in a `$queryRaw`, so it is not type-checked by Prisma. Mitigated by a
  hand-written return type and integration tests.
- The `readme` contribution is truncated to 20 000 characters to bound index size.
- Relevance tuning is coarser than Elasticsearch. Not a constraint at this scale.

**Neutral**

- The English text-search configuration is hard-coded. Multilingual search would need
  per-language configurations — out of scope.

## Revisit when

The catalog exceeds ~100 000 components, or users need typo tolerance and synonyms beyond
what `pg_trgm` provides. Typesense is the cheapest next step; Elasticsearch if faceting
gets genuinely complex.
