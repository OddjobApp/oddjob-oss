CREATE TABLE IF NOT EXISTS "synthetic_finance_communications" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "customer_classification" varchar(40) NOT NULL,
  "archive_target" text NOT NULL,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "approval_request_id" integer REFERENCES "approval_requests"("id") ON DELETE set null,
  "approved_content_hash" text,
  "drafted_by" text NOT NULL,
  "approved_by" text,
  "published_by" text,
  "submitted_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "synthetic_finance_communications_org_status_idx" ON "synthetic_finance_communications" ("organization_id", "status");
