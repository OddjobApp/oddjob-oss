-- Migration: 0129_trycua_step_number_unique
--
-- A step number is allocated by the task counter's own UPDATE ... RETURNING, but
-- nothing in the database stopped two concurrent recordings from claiming the
-- same one: idx_trycua_task_steps_task_step was a plain index. Direct actions are
-- now recorded from ten call sites without awaiting each other, so make the pair
-- unique and let a race fail loudly instead of writing a second step 7.
--
-- Where duplicates already exist, the unique index is skipped rather than failing
-- the migration (and with it the boot); the NOTICE names how many pairs to clean
-- up before the constraint can be added.

DO $$
DECLARE
    duplicate_pairs integer;
BEGIN
    SELECT count(*) INTO duplicate_pairs FROM (
        SELECT task_id, step_number
        FROM trycua_computer_use_task_steps
        GROUP BY task_id, step_number
        HAVING count(*) > 1
    ) AS dupes;

    IF duplicate_pairs > 0 THEN
        RAISE NOTICE 'Skipping unique index on (task_id, step_number): % duplicate pair(s) present. Deduplicate, then re-run this migration body.', duplicate_pairs;
        RETURN;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS "idx_trycua_task_steps_task_step_unq"
        ON "trycua_computer_use_task_steps" ("task_id", "step_number");

    DROP INDEX IF EXISTS "idx_trycua_task_steps_task_step";
END $$;
