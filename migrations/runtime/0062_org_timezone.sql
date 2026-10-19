-- Organization timezone preference (IANA, e.g. "America/Los_Angeles").
--
-- Drives locale-sensitive defaults; the first consumer is the opening centre of
-- the H3 spatial map, which previously initialised to (0, 0) -- null island in
-- the Gulf of Guinea -- so operators opened the palette looking at empty ocean.
--
-- NULLABLE ON PURPOSE. "Not configured" and "configured as UTC" are different
-- facts: only the former should fall through to the viewer's browser timezone,
-- and then to the UTC-8 product default. A NOT NULL DEFAULT 'UTC' would erase
-- that distinction and pin every unconfigured org to the prime meridian.

ALTER TABLE "orgs"
  ADD COLUMN IF NOT EXISTS "timezone" text;
