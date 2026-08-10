-- Full-text search for the catalog.
--
-- Hand-written because Prisma cannot express a GENERATED column. A generated
-- column beats a trigger here: Postgres maintains it inside the same
-- transaction as the write, so it cannot drift from the row it describes, and
-- there is no trigger function to keep in sync. Every alternative (a separate
-- search index, a sync job) reintroduces exactly the drift problem this avoids.
--
-- Spec: docs/02-data-model.md section 4 - ADR-008

-- Typo tolerance for name lookup ("pdf-extracter" -> "pdf-extractor").
-- Created by docker/postgres-init locally; repeated here so a fresh managed
-- database (Neon) gets it too.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Weighted so a title match outranks a passing mention in a README:
--   A = displayName / name    B = summary    C = readme
-- The readme contribution is capped at 20k characters to bound index size; a
-- component whose relevance hinges on character 20,001 is not a result anyone
-- is looking for.
ALTER TABLE "Component"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("displayName", '')), 'A')
   || setweight(to_tsvector('english', coalesce("name",        '')), 'A')
   || setweight(to_tsvector('english', coalesce("summary",     '')), 'B')
   || setweight(to_tsvector('english', left(coalesce("readme", ''), 20000)), 'C')
  ) STORED;

-- GIN is the correct index type for tsvector: built for many-keys-per-row
-- containment queries, which is exactly what the @@ operator performs.
CREATE INDEX IF NOT EXISTS "Component_searchVector_idx"
  ON "Component" USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS "Component_displayName_trgm_idx"
  ON "Component" USING GIN ("displayName" gin_trgm_ops);
