ALTER TABLE "knowledge_nodes" ADD COLUMN IF NOT EXISTS "embedding_provider" text;
ALTER TABLE "knowledge_nodes" ADD COLUMN IF NOT EXISTS "embedding_model" text;
ALTER TABLE "knowledge_nodes" ADD COLUMN IF NOT EXISTS "embedding_dimensions" integer;
ALTER TABLE "knowledge_nodes" ADD COLUMN IF NOT EXISTS "embedding_version" text;
CREATE INDEX IF NOT EXISTS "knowledge_nodes_embedding_contract_idx" ON "knowledge_nodes" USING btree ("organization_id", "embedding_provider", "embedding_model", "embedding_dimensions", "embedding_version");
