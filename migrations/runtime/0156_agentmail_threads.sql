-- Which project an AgentMail thread belongs to.
--
-- An organization has one AgentMail inbox, but the mail in it is not all the same
-- audience's: a thread started from a private project's room, or about a mission in
-- that project, is that project's. A thread with no row here, or a row with no
-- project, is visible to the whole organization, as before. project_id deliberately
-- has no foreign key: a thread whose project is deleted stays hidden rather than
-- falling open to everyone.
CREATE TABLE IF NOT EXISTS "agentmail_threads" (
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "thread_id" text NOT NULL,
    "project_id" integer,
    "crew_session_id" integer,
    "mission_run_id" integer,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("organization_id", "thread_id")
);
CREATE INDEX IF NOT EXISTS "agentmail_threads_project_idx"
    ON "agentmail_threads" ("organization_id", "project_id");

-- Threads already linked to CREW rooms take the room's project. A room linked to a
-- project wins over an unscoped one that shares the thread.
INSERT INTO "agentmail_threads" ("organization_id", "thread_id", "project_id", "crew_session_id")
SELECT DISTINCT ON (cs."organization_id", cs."cycle_context"->>'emailThreadId')
    cs."organization_id", cs."cycle_context"->>'emailThreadId', cs."project_id", cs."id"
FROM "crew_sessions" cs
WHERE cs."cycle_context"->>'emailThreadId' IS NOT NULL
ORDER BY cs."organization_id", cs."cycle_context"->>'emailThreadId', (cs."project_id" IS NULL), cs."id"
ON CONFLICT DO NOTHING;

-- Threads linked to mission runs take the mission's primary project.
INSERT INTO "agentmail_threads" ("organization_id", "thread_id", "project_id", "mission_run_id")
SELECT DISTINCT ON (m."organization_id", mr."mission_context"->>'emailThreadId')
    m."organization_id", mr."mission_context"->>'emailThreadId', pr."project_id", mr."id"
FROM "mission_runs" mr
JOIN "missions" m ON m."id" = mr."mission_id"
LEFT JOIN "project_resources" pr
    ON pr."resource_type" = 'mission' AND pr."resource_id" = m."id" AND pr."relation" = 'primary'
WHERE mr."mission_context"->>'emailThreadId' IS NOT NULL
  AND m."organization_id" IS NOT NULL
ORDER BY m."organization_id", mr."mission_context"->>'emailThreadId', (pr."project_id" IS NULL), mr."id"
ON CONFLICT ("organization_id", "thread_id") DO UPDATE SET
    "project_id" = COALESCE("agentmail_threads"."project_id", EXCLUDED."project_id"),
    "mission_run_id" = COALESCE("agentmail_threads"."mission_run_id", EXCLUDED."mission_run_id");
