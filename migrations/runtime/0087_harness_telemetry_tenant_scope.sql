-- Tenant-scope the self-harness telemetry tables, and stop two score columns
-- from being auto-increment sequences.
--
-- F4 — `evaluation_results` and `failure_patterns` had NO organization column at
-- all. `weakness-mining.service.ts` clustered across every tenant at once
-- (its lookup filters only on harness_id + harness_version + pattern_signature),
-- so one organization's failure could be cited as another's evidence. Any
-- improvement-loop workflow reading these tables inherits that.
--
-- F5 — `cluster_size` and `actionability_score` were declared `serial`, i.e.
-- integer + NOT NULL + DEFAULT nextval(...). The current writer does supply real
-- values, so nothing is corrupt today, but ANY insert that omits them silently
-- receives the next sequence number — a monotonically increasing counter that
-- reads as a plausible score. This removes the trap rather than waiting for it.
--
-- Both tables are empty in the development database, so there is nothing to
-- backfill and no rows to attribute.
--
-- `organization_id` is added NULLABLE on purpose. A NOT NULL add would fail on
-- any environment that does hold unattributed rows, and inventing a default
-- organization for them is exactly the fabrication §23 forbids. Enforcement is
-- therefore at the application layer, which fails closed: the writers refuse to
-- insert without a resolved organization, and org-scoped reads must never treat
-- a NULL as a wildcard. A follow-up migration can SET NOT NULL once production
-- is confirmed to hold no unattributed rows.

-- ── evaluation_results ──────────────────────────────────────────────
ALTER TABLE "evaluation_results"
    ADD COLUMN IF NOT EXISTS "organization_id" integer;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "evaluation_results"
        ADD CONSTRAINT "evaluation_results_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "evaluation_results_org_harness_idx"
    ON "evaluation_results" ("organization_id", "harness_id", "harness_version");--> statement-breakpoint

-- ── failure_patterns ────────────────────────────────────────────────
ALTER TABLE "failure_patterns"
    ADD COLUMN IF NOT EXISTS "organization_id" integer;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "failure_patterns"
        ADD CONSTRAINT "failure_patterns_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- The cluster lookup key, now tenant-first.
CREATE INDEX IF NOT EXISTS "failure_patterns_org_harness_idx"
    ON "failure_patterns" ("organization_id", "harness_id", "harness_version");--> statement-breakpoint

-- ── F5: serial → plain integer ──────────────────────────────────────
-- Detach the sequence defaults, then drop the now-unreferenced sequences.
-- cluster_size stays NOT NULL: a cluster always has a size, and with no default
-- an omitting writer now fails loudly instead of receiving a counter.
ALTER TABLE "failure_patterns"
    ALTER COLUMN "cluster_size" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "failure_patterns_cluster_size_seq";--> statement-breakpoint

-- actionability_score becomes NULLABLE: "not yet scored" is a real state, and
-- NULL says so honestly. The only writer hardcodes 0 as an admitted placeholder,
-- which is a fabricated score wearing a real column's name.
ALTER TABLE "failure_patterns"
    ALTER COLUMN "actionability_score" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "failure_patterns"
    ALTER COLUMN "actionability_score" DROP NOT NULL;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "failure_patterns_actionability_score_seq";
