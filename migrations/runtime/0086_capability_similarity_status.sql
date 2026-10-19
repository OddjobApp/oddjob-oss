-- Records whether a capability proposal's duplicate check actually ran.
--
-- `similar_capabilities` is populated from a vector similarity search. That
-- search fails OPEN at three layers: the embedding service returns `null` on
-- every failure path instead of throwing, `capabilityRegistry.discover()` maps a
-- null vector to an empty array, and the caller's try/catch therefore never
-- fires. The result was persisted as `[]` — indistinguishable from a genuine
-- "nothing similar" — so a duplicate proposal received its FULL priority score
-- precisely when deduplication was unavailable, and stayed that way forever.
--
-- Existing rows are backfilled to 'unavailable' rather than 'available': we
-- cannot retroactively establish whether the embedding provider was reachable
-- when each was written, and claiming 'available' would assert exactly the fact
-- this column exists to stop assuming. Those rows are re-checkable, not trusted.

ALTER TABLE "capability_proposals"
    ADD COLUMN IF NOT EXISTS "similarity_status" text NOT NULL DEFAULT 'unavailable';--> statement-breakpoint

-- Surfacing the held/re-checkable backlog is the common query.
CREATE INDEX IF NOT EXISTS "capability_proposals_similarity_status_idx"
    ON "capability_proposals" ("organization_id", "similarity_status");
