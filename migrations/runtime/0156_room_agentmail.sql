CREATE TABLE agentmail_room_inboxes (
 session_id integer PRIMARY KEY REFERENCES crew_sessions(id) ON DELETE CASCADE,
 organization_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
 inbox_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agentmail_room_inboxes_inbox_unique ON agentmail_room_inboxes(inbox_id);

-- Serialize mailbox ownership checks across both registries, including concurrent assignments.
CREATE FUNCTION agentmail_exclusive_inbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(641023, 0);
 IF TG_TABLE_NAME = 'agentmail_room_inboxes' THEN
  IF NOT EXISTS (SELECT 1 FROM crew_sessions WHERE id = NEW.session_id AND organization_id = NEW.organization_id) THEN
   RAISE EXCEPTION 'Invalid room organization' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM agentmail_connections WHERE inbox_id = NEW.inbox_id) THEN
   RAISE EXCEPTION 'Inbox already assigned' USING ERRCODE = '23505';
  END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM agentmail_room_inboxes WHERE inbox_id = NEW.inbox_id) THEN
   RAISE EXCEPTION 'Inbox already assigned' USING ERRCODE = '23505';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER agentmail_room_exclusive BEFORE INSERT OR UPDATE ON agentmail_room_inboxes FOR EACH ROW EXECUTE FUNCTION agentmail_exclusive_inbox();
CREATE TRIGGER agentmail_org_exclusive BEFORE INSERT OR UPDATE ON agentmail_connections FOR EACH ROW EXECUTE FUNCTION agentmail_exclusive_inbox();
