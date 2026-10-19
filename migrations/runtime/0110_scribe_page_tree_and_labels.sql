-- Confluence-style organisation for Scribe manuscripts: a page tree and labels.
--
-- parent_document_id is a self-reference rather than a separate hierarchy table.
-- A Scribe document already IS the page; giving it a parent is the whole of what
-- "child page" means, and a join table would only add a way for the two to
-- disagree.
--
-- ON DELETE SET NULL, not CASCADE: deleting a parent must not silently destroy
-- every manuscript filed beneath it. Orphaned children surface at the root,
-- which is visible and recoverable, where a cascade is neither.
ALTER TABLE "scribe_documents"
    ADD COLUMN IF NOT EXISTS "parent_document_id" integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'scribe_documents_parent_document_id_fk'
    ) THEN
        ALTER TABLE "scribe_documents"
            ADD CONSTRAINT "scribe_documents_parent_document_id_fk"
            FOREIGN KEY ("parent_document_id") REFERENCES "scribe_documents"("id")
            ON DELETE SET NULL;
    END IF;
END $$;

-- Labels are a jsonb array of strings, matching how settings/publications are
-- already stored on this table. Defaulted to '[]' rather than left NULL so every
-- read can treat it as an array without a coalesce at each call site.
ALTER TABLE "scribe_documents"
    ADD COLUMN IF NOT EXISTS "labels" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- Listing a space means "children of X within this org", which is the shape of
-- every tree query, so the index leads with the org.
CREATE INDEX IF NOT EXISTS "scribe_documents_org_parent_idx"
    ON "scribe_documents" ("organization_id", "parent_document_id");

-- Label filtering is a containment test; GIN is what jsonb @> can actually use.
CREATE INDEX IF NOT EXISTS "scribe_documents_labels_idx"
    ON "scribe_documents" USING GIN ("labels");
