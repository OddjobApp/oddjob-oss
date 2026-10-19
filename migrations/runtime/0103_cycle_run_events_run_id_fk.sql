-- cycle_run_events.run_id points at the wrong table.
--
-- Both writers are in server/core/pipeline-step-runner.ts and both insert
-- `runId: pipelineExecutionId`, so the column has only ever held a
-- pipeline_executions.id. The constraint said operational_cycles.
--
-- That is not cosmetic. The two id spaces overlap, so most inserts satisfied
-- the constraint by coincidence and were attributed to whichever unrelated
-- cycle happened to share the number — in dev, execution 49's events are filed
-- under the "Vendor Management" cycle. Executions numbered above the highest
-- cycle id satisfy nothing: their inserts raise a foreign key violation that
-- the caller logs to console.error and swallows, so those runs record no
-- history at all. Four of ninety executions were in that state when this was
-- written, and the gap widens every time an execution is created without a
-- cycle.
--
-- ON DELETE CASCADE made it worse in the other direction: deleting an
-- operational cycle silently deleted the step history of a pipeline execution
-- that merely shared its id.
--
-- Cascade is retained, because against the right parent it is what you want —
-- an execution's step events have no meaning once the execution is gone.

--> statement-breakpoint
-- Events whose run_id names no execution cannot be attributed to anything and
-- would block the constraint. In dev this matches no rows; it exists so the
-- migration is safe on an environment that accumulated orphans under the old
-- constraint.
DELETE FROM "cycle_run_events" e
WHERE NOT EXISTS (
    SELECT 1 FROM "pipeline_executions" pe WHERE pe."id" = e."run_id"
);

--> statement-breakpoint
ALTER TABLE "cycle_run_events"
    DROP CONSTRAINT IF EXISTS "cycle_run_events_run_id_operational_cycles_id_fk";

--> statement-breakpoint
ALTER TABLE "cycle_run_events"
    ADD CONSTRAINT "cycle_run_events_run_id_pipeline_executions_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_executions"("id")
    ON DELETE cascade ON UPDATE no action;
