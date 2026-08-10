-- Runs once, on first container start, before any Prisma migration.
--
-- pg_trgm powers typo-tolerant name lookup ("pdf-extracter" → "pdf-extractor").
-- Creating it here rather than in a migration keeps the migration portable:
-- managed Postgres (Neon) often requires extensions to be enabled by the
-- platform, so the migration uses CREATE EXTENSION IF NOT EXISTS and this file
-- guarantees local parity.
--
-- See docs/02-data-model.md section 4.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Separate database for the integration test suite, so `npm run test:integration`
-- can TRUNCATE freely without destroying your development data.
SELECT 'CREATE DATABASE ai_portal_test OWNER portal'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_portal_test')\gexec
