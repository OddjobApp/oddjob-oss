-- Author-side of a project's timeline.
--
-- Signals, predictions and surprises arrive on their own; a regulatory
-- deadline or a customer commitment exists only because somebody recorded it.
-- Both belong on one timeline, so severity uses the same ladder the signal
-- tables use (Low/Medium/High/Critical) and events sort beside observed ones
-- rather than in a parallel view.

CREATE TABLE IF NOT EXISTS "project_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "kind" text DEFAULT 'milestone' NOT NULL,
  "severity" text DEFAULT 'Medium' NOT NULL,
  "starts_at" timestamp NOT NULL,
  "ends_at" timestamp,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The timeline read: one project, ordered by when things happen.
CREATE INDEX IF NOT EXISTS "project_events_project_starts_at_idx"
  ON "project_events" ("project_id", "starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_events_org_idx"
  ON "project_events" ("organization_id");
