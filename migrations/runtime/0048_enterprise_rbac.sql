ALTER TABLE "org_settings"
  ADD COLUMN IF NOT EXISTS "enterprise_rbac_enforced" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_role_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_role_assignments_role_check"
    CHECK ("role" IN ('operator', 'approver', 'auditor', 'administrator')),
  CONSTRAINT "organization_role_assignments_unique"
    UNIQUE("organization_id", "user_id", "role")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_role_assignments" ADD CONSTRAINT "organization_role_assignments_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_role_assignments" ADD CONSTRAINT "organization_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_role_assignments" ADD CONSTRAINT "organization_role_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_role_assignments_org_user_idx"
  ON "organization_role_assignments" USING btree ("organization_id", "user_id");
