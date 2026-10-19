-- Consent is scoped to a session, not granted forever.
--
-- Access to an inferred psychological profile is not the kind of permission that
-- should quietly persist: a user agreeing once in March should not mean every
-- agent reads it in November. Storing the session the grant belongs to makes the
-- grant expire naturally when the session does, with no sweeper to run.

ALTER TABLE "theory_of_mind" ADD COLUMN IF NOT EXISTS "consent_session_id" text;
