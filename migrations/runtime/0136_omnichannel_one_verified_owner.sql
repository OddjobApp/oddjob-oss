-- 0136_omnichannel_one_verified_owner
--
-- An inbound SMS/WhatsApp/Telegram message carries no organization: the sender's
-- identifier is the only key, so it must name exactly one verified identity.
-- 0130 made (organization, channel, identifier) unique, which let the same number
-- be verified in two orgs, and inbound routing then picked whichever row came first.
--
-- Pending (unverified) rows may repeat: several people can be mid-pairing, and the
-- verification step refuses the second one. A database with duplicate verified rows
-- fails here; resolve them (unverify all but the rightful owner) and re-run.
--
-- Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS "unq_verified_channel_identifier"
	ON "omnichannel_identities" USING btree ("channel_type", "channel_identifier")
	WHERE "is_verified";
