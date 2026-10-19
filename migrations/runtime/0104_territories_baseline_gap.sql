-- Territories: created by 0062, present in no database.
--
-- 0062_schema_relationship_gaps.sql contains the CREATE TABLE and sits in the
-- journal, so every migrator considers it applied — but the table is absent
-- from both the development and the test database, which is the signature of a
-- baseline recorded rather than executed. TerritoryService has therefore never
-- had a table to write to: its suite fails on `relation "territories" does not
-- exist`, and any runtime caller fails the same way.
--
-- IF NOT EXISTS so this is safe on a database that did get 0062.
CREATE TABLE IF NOT EXISTS "territories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb NOT NULL
);
