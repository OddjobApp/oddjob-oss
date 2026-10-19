-- Widen the calculation_dependencies uniqueness to include the variable name.
--
-- 0033 created this table with an inline UNIQUE(calculation_node_id,
-- depends_on_node_id), which says "a calculation may reference a given node at
-- most once". That is wrong for how the table is actually read:
-- resolveInputContext builds the formula context by keying on variable_name, so
-- binding two formula variables to the same node needs TWO rows. Under the old
-- constraint that was a raw duplicate-key error surfacing as a 500 — there was
-- no way to express `{base: nodeA, input1: nodeB, input2: nodeB}`.
--
-- Widening cannot introduce duplicates, since the new key is a superset of the
-- old one, so no data cleanup is required.
--
-- The replacement is created as `calc_dep_unique` because that is the name the
-- drizzle schema has always declared (uniqueIndex("calc_dep_unique")). It never
-- existed in the database: 0033 wrote a table constraint with a Postgres
-- generated name instead, so the schema and the database had silently drifted.
-- This reconciles them.

DO $$
DECLARE
    target text;
BEGIN
    -- Find by column set rather than by name: the generated name is truncated
    -- to 63 characters ("..._depends_on_nod_key") and is not worth relying on.
    SELECT c.conname INTO target
      FROM pg_constraint c
     WHERE c.conrelid = 'calculation_dependencies'::regclass
       AND c.contype = 'u'
       AND (
            -- attname is `name`, so cast both sides to text[] to compare.
            SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid
               AND a.attnum = ANY(c.conkey)
           ) = ARRAY['calculation_node_id', 'depends_on_node_id']::text[]
     LIMIT 1;

    IF target IS NOT NULL THEN
        EXECUTE format('ALTER TABLE calculation_dependencies DROP CONSTRAINT %I', target);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS calc_dep_unique
    ON calculation_dependencies (calculation_node_id, depends_on_node_id, variable_name);

COMMENT ON INDEX calc_dep_unique IS
    'One row per (calculation, source node, formula variable). Two variables may bind to the same node.';
