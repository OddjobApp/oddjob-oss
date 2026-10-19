-- intervention_policy_suggestions.reviewed_by: integer -> text
--
-- users.id is a text UUID (shared/schema/auth.ts), but this column was declared
-- integer in the Drizzle schema AND the baseline migration. The approve/reject
-- endpoint writes req.user.id into it, so PATCH /api/scoring/agent/suggestions/:id
-- failed in EVERY environment with:
--
--   invalid input syntax for type integer: "80de4dc2-e595-4ced-9d89-5f9989adf3e4"
--
-- The write site cast through `as any`, which is why the type checker never caught
-- it and why it survived to here.
--
-- Safe and lossless: integer -> text always converts, and the column is nullable
-- with no foreign key or index depending on its type. Any pre-existing numeric
-- values become their string form rather than being discarded.
--
-- Idempotent: the DO block is a no-op once the column is already text.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'intervention_policy_suggestions'
      AND column_name = 'reviewed_by'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE intervention_policy_suggestions
      ALTER COLUMN reviewed_by TYPE text USING reviewed_by::text;
  END IF;
END $$;
--> statement-breakpoint

-- Rollback (only safe if every stored value is numeric — UUIDs written since this
-- migration would fail the cast, which is the point):
--   ALTER TABLE intervention_policy_suggestions
--     ALTER COLUMN reviewed_by TYPE integer USING reviewed_by::integer;
