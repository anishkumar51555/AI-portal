-- Make "searchVector" an actual GENERATED column.
--
-- WHY THIS MIGRATION EXISTS (worth reading before touching search):
--
-- schema.prisma declares `searchVector Unsupported("tsvector")?`. That tells
-- Prisma the column exists so it will not drop it — but Prisma cannot express
-- GENERATED ALWAYS, so `add_catalog_models` created it as a PLAIN nullable
-- tsvector. The follow-up migration then used `ADD COLUMN IF NOT EXISTS`, which
-- silently no-opped against that existing column.
--
-- Net effect: the column existed, the GIN index existed, every query compiled,
-- and search would have returned nothing forever. Nothing failed loudly. That
-- is the worst shape a bug can take, and `IF NOT EXISTS` is what hid it.
--
-- Fix: drop and recreate as generated. Safe unconditionally — the column holds
-- only derived data, so nothing is lost, and on a fresh database this simply
-- replaces the plain column created moments earlier in the same migration run.
--
-- Dropping the column also drops its dependent index, so the GIN index is
-- recreated below.
--
-- Spec: docs/02-data-model.md section 4 - ADR-008

ALTER TABLE "Component" DROP COLUMN IF EXISTS "searchVector";

-- Weighted so a title match outranks a passing mention in a README:
--   A = displayName / name    B = summary    C = readme
-- The readme contribution is capped at 20k characters to bound index size.
ALTER TABLE "Component"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("displayName", '')), 'A')
   || setweight(to_tsvector('english', coalesce("name",        '')), 'A')
   || setweight(to_tsvector('english', coalesce("summary",     '')), 'B')
   || setweight(to_tsvector('english', left(coalesce("readme", ''), 20000)), 'C')
  ) STORED;

-- GIN is the correct index for tsvector: built for many-keys-per-row
-- containment queries, which is exactly what the @@ operator performs.
CREATE INDEX "Component_searchVector_idx" ON "Component" USING GIN ("searchVector");
