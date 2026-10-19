-- Project Space scoping for agent deployments.
--
-- The Command Launchpad merges apps and agent deployments into one "fleet"
-- list. apps.project_id already exists, but agent_deployments had no project
-- column, so filtering the list by project would have scoped one half and not
-- the other -- a list that is half project-aware is more misleading than one
-- that is not scoped at all.
--
-- NULL MEANS ORG-GLOBAL, not "unassigned". Every existing row is NULL, so any
-- consumer must filter with `project_id IS NULL OR project_id = :id`. A bare
-- equality would hide the entire existing fleet the moment a project is
-- selected. Same convention as event_primitives and operational_cycles.

ALTER TABLE "agent_deployments"
  ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_agent_deployments_project"
  ON "agent_deployments" ("organization_id", "project_id");
