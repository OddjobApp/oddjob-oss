-- 0117_media_studio_takes
--
-- A take is rendered by a provider only after it is approved. The take records which
-- provider rendered it, exactly what was sent (the compiled prompt, the endpoint, the
-- length, aspect ratio and resolution, and the keyframes that framed it), and the
-- provider's last reported state, so a render can be followed to the end and what
-- produced a take is never a guess.
--
-- New productions start with a $100 budget: a five-second Seedance take costs about
-- $1.52 at 720p on fal.ai, so the old $25 covered too few takes to shoot a scene.
--
-- Idempotent.

ALTER TABLE "media_takes" ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint
ALTER TABLE "media_takes" ADD COLUMN IF NOT EXISTS "request" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_takes" ADD COLUMN IF NOT EXISTS "provider_state" text;
--> statement-breakpoint
ALTER TABLE "media_productions" ALTER COLUMN "budget_limit_cents" SET DEFAULT 10000;
