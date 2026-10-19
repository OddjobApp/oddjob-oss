-- Separate verification observations from raw assembly usage.
--
-- `total_assemble_count` is incremented on every instant-app render, which
-- produces no pass/fail signal. It was also being used as the denominator of
-- the running `verification_success_rate` average, so renders diluted real
-- verification outcomes: one genuine failure after 40 renders computed as
-- ~97.6% success.
--
-- `verification_run_count` counts only recorded verification outcomes, and
-- doubles as the "has this ever been measured?" flag — 0 means
-- effectiveness_score / verification_success_rate are still seeded defaults
-- and must not be shown as observed quality.

ALTER TABLE "component_index"
  ADD COLUMN IF NOT EXISTS "verification_run_count" integer DEFAULT 0 NOT NULL;
