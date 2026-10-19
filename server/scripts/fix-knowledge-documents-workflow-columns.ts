/**
 * Hotfix migration: add the missing workflow_execution_id / workflow_step_id
 * columns (+ indexes) to knowledge_documents. The Drizzle schema
 * (shared/schema/knowledge-base.ts:153-168) declares them, but the DB table was
 * never migrated, so EVERY insert into knowledge_documents fails with
 * 42703 (undefined_column). That breaks the local-artifact fallback used by the
 * SDLC tools (confluence/jira publish → KB doc) when external SaaS is absent.
 *
 * Idempotent. Usage: npx tsx server/scripts/fix-knowledge-documents-workflow-columns.ts
 */
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    const stmts = [
        `ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "workflow_execution_id" integer`,
        `ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "workflow_step_id" integer`,
        `CREATE INDEX IF NOT EXISTS "knowledge_docs_workflow_execution_idx" ON "knowledge_documents" ("workflow_execution_id")`,
        `CREATE INDEX IF NOT EXISTS "knowledge_docs_workflow_step_idx" ON "knowledge_documents" ("workflow_step_id")`,
    ];
    for (const s of stmts) {
        await db.execute(sql.raw(s));
        console.log("✓ " + s);
    }

    // Verify the columns now exist
    const check: any = await db.execute(sql.raw(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'knowledge_documents'
           AND column_name IN ('workflow_execution_id','workflow_step_id')
         ORDER BY column_name`
    ));
    const found = (check.rows ?? check).map((r: any) => r.column_name);
    console.log("Columns present now:", found);
    process.exit(found.length === 2 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
