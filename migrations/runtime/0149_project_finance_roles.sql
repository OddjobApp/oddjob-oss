-- 0149_project_finance_roles
--
-- Finance roles (ar, ap, audit, executive) a project owner gives a member for
-- the project's QuickBooks books. Access is the union of a member's roles; a
-- member with none has no QuickBooks access. See shared/finance-roles.ts.

CREATE TABLE IF NOT EXISTS "project_finance_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
	"user_id" text NOT NULL,
	"role" text NOT NULL CHECK ("role" IN ('ar', 'ap', 'audit', 'executive')),
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_finance_roles_unique"
	ON "project_finance_roles" USING btree ("project_id", "user_id", "role");
CREATE INDEX IF NOT EXISTS "project_finance_roles_user_idx"
	ON "project_finance_roles" USING btree ("organization_id", "user_id");
