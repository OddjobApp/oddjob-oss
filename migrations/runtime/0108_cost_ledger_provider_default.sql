-- cost_ledger.provider defaulted to 'openai'.
--
-- No caller passed provider, so every recorded row claimed an OpenAI call --
-- 132 of 132 in the live database, on a platform whose stated policy is
-- Gemini-first. The column default was one of the two sources; the other was
-- `ledgerMeta?.provider ?? "openai"` in systemConfigService.trackSpend.
--
-- 'unknown' is the honest default. providerForModel() now derives the real
-- vendor from the model name at the call site, so this default should rarely
-- fire again.
--
-- Existing rows are NOT rewritten: they genuinely do not know what they paid
-- for, and relabelling them 'unknown' would be as invented as 'openai'. They
-- are left as historical evidence of the gap, bounded by recorded_at.

ALTER TABLE "cost_ledger" ALTER COLUMN "provider" SET DEFAULT 'unknown';
