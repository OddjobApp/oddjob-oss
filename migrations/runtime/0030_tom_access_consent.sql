-- Consent to agents READING a user's theory-of-mind profile.
--
-- Narrower than it may look, and deliberately so: the sync assessor and async
-- extractor already run on every message, so this gates ACCESS, not collection.
-- It does not pretend to be consent to being modelled — that is a separate,
-- open policy question. null means never asked; agents get nothing until
-- 'granted'.

ALTER TABLE "theory_of_mind" ADD COLUMN IF NOT EXISTS "access_consent" text;
--> statement-breakpoint
ALTER TABLE "theory_of_mind" ADD COLUMN IF NOT EXISTS "consent_decided_at" timestamp;
--> statement-breakpoint
ALTER TABLE "theory_of_mind" ADD COLUMN IF NOT EXISTS "consent_request_id" integer;
