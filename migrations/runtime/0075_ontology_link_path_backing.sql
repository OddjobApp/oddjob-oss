-- Let `backing` actually be 'path'.
--
-- 0072 added the column but 0071's CHECK still pinned backing to the two kinds that
-- existed then, so every composed link was refused by the constraint. seedDefaultLinkTypes
-- catches and logs its own failures — deliberately, so one bad default cannot cost an
-- org the rest — which meant the refusal surfaced as links that silently never existed
-- rather than as an error. Separate migration rather than an edit to 0072 because that
-- one had already been applied, and the runtime migrator replays by journal `when` >
-- max(created_at), never by file hash.

ALTER TABLE "ontology_link_types"
	DROP CONSTRAINT IF EXISTS "ontology_link_types_backing_check";
ALTER TABLE "ontology_link_types"
	ADD CONSTRAINT "ontology_link_types_backing_check" CHECK (
		"backing" IN ('derived', 'materialized', 'path')
	);

-- The same shape as 0071's derived/source_property rule: a composed link with no hops
-- is not a relationship, it is an empty answer waiting to be believed.
ALTER TABLE "ontology_link_types"
	DROP CONSTRAINT IF EXISTS "ontology_link_types_path_needs_hops";
ALTER TABLE "ontology_link_types"
	ADD CONSTRAINT "ontology_link_types_path_needs_hops" CHECK (
		"backing" <> 'path' OR jsonb_array_length("path") > 0
	);
