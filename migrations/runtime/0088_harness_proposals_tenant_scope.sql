-- Tenant-scope harness_proposals.
--
-- F10 — the third untenanted table in the self-improvement chain, and the most
-- sensitive of them: `proposed_change` holds `{ filePath, oldContent, newContent }`,
-- i.e. a source diff staged for self-modification. Without an organization column
-- one tenant's proposed code changes were readable by any query over this table,
-- and `docs-synthesizer.ts` did exactly that — selecting the five most recent
-- proposals across every tenant and writing their file paths into the
-- repo-committed `docs/SYSTEM_ARCHITECTURE.md`.
--
-- Nullable for the same reason as 0087: a NOT NULL add would fail on any
-- environment holding unattributed rows, and inventing an owner for a staged
-- code diff is worse than leaving it unattributed and unreadable. Enforcement is
-- at the application layer, which fails closed.

ALTER TABLE "harness_proposals"
    ADD COLUMN IF NOT EXISTS "organization_id" integer;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "harness_proposals"
        ADD CONSTRAINT "harness_proposals_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "harness_proposals_org_harness_idx"
    ON "harness_proposals" ("organization_id", "harness_id");
