-- Immutable, typed mutation proposals (§4.6).
--
-- The column that carries the safety property is `content_hash`. Approval binds
-- to it, not to the row: any edit to the operations, the target, or the
-- expected version recomputes the hash and voids the approval. Carrying consent
-- forward onto different operations is the failure §9.7 exists to prevent.
--
-- `approval_request_id` points at the authoritative approval record, which is
-- resolved SEPARATELY at apply time. The approval columns cached here are for
-- display and for detecting drift — they are never the authority. A timestamp
-- or an approver name sitting inside a proposal payload is not permission, and
-- the verifier refuses to read one as such.
--
-- No mutation executors exist yet, deliberately. This is the contract and the
-- gate; target-specific mutators come after, and each must pass through
-- verifyApprovalIntegrity before touching anything.

CREATE TABLE IF NOT EXISTS "improvement_change_sets" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "project_id" integer,
    "opportunity_id" integer,

    -- 'cycle_blueprint' | 'cycle_schedule' | 'pipeline_step' | 'forge_app'
    "target_type" text NOT NULL,
    "target_id" text NOT NULL,
    -- The target version this was authored against. Stale at apply time = refuse.
    "expected_version" text NOT NULL,

    "reason" text NOT NULL,
    "evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- Typed operations. Natural language is context; THIS is the contract.
    "operations" jsonb DEFAULT '[]'::jsonb NOT NULL,

    "validation_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "rollout_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "rollback_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- draft | validated | approved | applying | applied | verified
    -- | rolled_back | failed
    "status" text DEFAULT 'draft' NOT NULL,
    "content_hash" text NOT NULL,

    "approval_request_id" integer,
    "approved_content_hash" text,
    "approved_by" text,
    "approved_at" timestamp,
    "approval_expires_at" timestamp,
    -- When a human chose a named remediation, THAT is what may be applied.
    "selected_remediation" text,

    "applied_at" timestamp,
    "verified_at" timestamp,
    "rolled_back_at" timestamp,
    "failure_reason" text,

    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_change_sets"
        ADD CONSTRAINT "improvement_change_sets_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_change_sets"
        ADD CONSTRAINT "improvement_change_sets_opportunity_id_fk"
        FOREIGN KEY ("opportunity_id") REFERENCES "public"."improvement_opportunities"("id")
        ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "improvement_change_sets_org_status_idx"
    ON "improvement_change_sets" ("organization_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_change_sets_target_idx"
    ON "improvement_change_sets" ("organization_id", "target_type", "target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_change_sets_hash_idx"
    ON "improvement_change_sets" ("content_hash");
