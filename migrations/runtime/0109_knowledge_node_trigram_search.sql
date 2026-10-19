-- Knowledge node text search could never use an index.
--
-- Every search path filters with `ILIKE '%term%'`. A leading wildcard is
-- unusable by a btree, so `node_name_idx` and `node_label_idx` were dead
-- weight for these queries and Postgres fell back to a sequential scan of
-- all 57,906 rows (54 MB) on every call. The `data::text ILIKE` branch is
-- worse still: it detoasts and stringifies the whole jsonb column per row.
--
-- Measured on the dev database before this migration:
--   SELECT count(*) ... WHERE name ILIKE '%x%' OR data::text ILIKE '%x%'
--   -> Seq Scan, Rows Removed by Filter: 57906, 6876 buffers, 178 ms
--
-- The paginated LIMIT only escapes early when a term is common; the sibling
-- count(*) that backs pagination can never escape early, so *every* search
-- paid the full scan regardless.
--
-- With the trigram indexes below the same count runs as a BitmapOr over
-- index scans: 84 buffers, 0.4 ms.
--
-- Three separate OR-groups exist across the callers, so all four columns
-- need coverage -- an OR degrades to a seq scan unless every branch is
-- indexable:
--   graph-service.ts   name OR data::text
--   graph-tools.ts     name OR label OR external_id
--   storage.service.ts name OR external_id
--
-- Cost: +27 MB of index (21 MB of that is the data::text expression index,
-- which serves the hottest caller -- agent recall and the chat bridge) and
-- GIN write amplification on node ingestion. Build took ~3 s over 57,906
-- rows and holds a write lock for that time; these are plain (non-
-- CONCURRENT) CREATE INDEX because the migrator runs inside a transaction.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS node_name_trgm_idx
  ON knowledge_nodes USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS node_data_trgm_idx
  ON knowledge_nodes USING gin ((data::text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS node_label_trgm_idx
  ON knowledge_nodes USING gin (label gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS node_external_id_trgm_idx
  ON knowledge_nodes USING gin (external_id gin_trgm_ops);
--> statement-breakpoint
-- X-Ray looked up "every node derived from one repo file" by loading 50,000
-- nodes and filtering `data.filePath` in JS. Indexing the expression lets
-- that run as an index scan: 19.2 ms / 6876 buffers -> 0.054 ms / 5 buffers,
-- for 872 kB.
--
-- Note the sibling `data.fingerprintPrefix` is deliberately NOT indexed: it
-- matches 41,927 of 57,906 rows, so the planner would correctly ignore it.
-- filePath carries the selectivity.
CREATE INDEX IF NOT EXISTS node_data_file_path_idx
  ON knowledge_nodes ((data->>'filePath'));
