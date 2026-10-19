-- Composed Link Types — a relationship reached by following other relationships.
--
-- The third backing, after `derived` (resolve a foreign key the source already
-- carries) and `materialized` (read a stored edge):
--
--   path  the link IS a sequence of existing links. "Which missions are in this
--         project?" is `has_resource` then `resource_of` — a walk through the
--         project_resources junction, which neither other backing can express: a
--         derived link resolves a property on the SOURCE ROW, and `projects`
--         carries no resource ids, only the junction does.
--
-- Stored as an ordered array of link NAMES, resolved against the org's own link
-- types at traversal time. Names rather than ids so a path survives a link being
-- redeclared, and so the declaration reads the way a person would say it.
--
-- Why not a SQL join through the junction table: the adapter contract filters on a
-- single value (`listBy(property, value)`) with no IN support, so a join-based
-- implementation would issue the same number of queries as walking the hops, while
-- duplicating the polymorphic discriminator logic that traversal already handles.
--
-- Guarded, following 0069 and 0071: an environment that already has the column
-- gets a no-op rather than an error.

-- The `backing` CHECK that has to widen alongside this lives in 0075_ontology_link_path_backing,
-- not here: this migration was already applied when that was found, and the runtime
-- migrator replays by journal `when` > max(created_at), so an edit here would never
-- have run anywhere it mattered.
ALTER TABLE "ontology_link_types"
	ADD COLUMN IF NOT EXISTS "path" jsonb DEFAULT '[]'::jsonb NOT NULL;
