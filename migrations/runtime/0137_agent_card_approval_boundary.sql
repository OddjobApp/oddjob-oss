-- 0137_agent_card_approval_boundary
--
-- A durable, per-agent approval boundary: free-text rules the outbound send
-- gate enforces for sends attributed to this card ("always review external
-- email", "never contact customers", "approve every Slack post"). Global gate
-- policy applies to every agent the same way; this column is what lets one
-- card be stricter than the baseline without weakening another.
--
-- Idempotent.

ALTER TABLE "agent_cards"
	ADD COLUMN IF NOT EXISTS "approval_boundary" text;
