-- Indexes declared in the Drizzle schema but never migrated.
--
-- Less dangerous than the missing `teams` columns (0083): Drizzle does not name
-- indexes in a SELECT, so queries kept working. But an index that exists only in
-- TypeScript delivers none of the performance it was added for, and it leaves
-- `drizzle-kit generate` reporting drift forever.
--
-- CONCURRENTLY is deliberately NOT used: the runtime migrator applies statements
-- inside a transaction, and CREATE INDEX CONCURRENTLY cannot run in one. These
-- tables are small enough that a brief lock is acceptable; revisit if they grow.

-- Room transcript paging: turns for a session, in round order.
CREATE INDEX IF NOT EXISTS "idx_crew_turns_session_round"
    ON "crew_turns" ("session_id", "round", "id");--> statement-breakpoint

-- Open-vs-resolved decision filtering within a room.
CREATE INDEX IF NOT EXISTS "idx_crew_decisions_session_status"
    ON "crew_decisions" ("session_id", "status");--> statement-breakpoint

-- Project activity feed: newest events for an organization.
CREATE INDEX IF NOT EXISTS "project_events_org_created_idx"
    ON "project_events" ("organization_id", "created_at");
