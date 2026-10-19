import dotenv from "dotenv";
dotenv.config();
import pg from "pg";

const { Pool } = pg;

// Remaining DDL for the Paperclip gap-closure migration.
// cost_ledger and heartbeat_triggers tables were already created by a prior
// direct SQL run.  These statements are safe to re-run.
const stmts: string[] = [
    `ALTER TABLE "agent_deployments" ADD COLUMN IF NOT EXISTS "reports_to_id" integer`,
    `ALTER TABLE "agent_deployments" ADD COLUMN IF NOT EXISTS "org_role" text DEFAULT 'worker'`,
    `CREATE INDEX IF NOT EXISTS "agent_deployments_reports_to_idx" ON "agent_deployments" USING btree ("reports_to_id")`,
    `CREATE INDEX IF NOT EXISTS "agent_deployments_org_hierarchy_idx" ON "agent_deployments" USING btree ("organization_id","reports_to_id")`,
    `ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade`,
    `ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_agent_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null`,
    `ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade`,
    `ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_agent_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null`,
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function main() {
    const client = await pool.connect();
    try {
        for (const stmt of stmts) {
            try {
                await client.query(stmt);
                console.log("OK:", stmt.slice(0, 80));
            } catch (e: any) {
                if (
                    e.message?.includes("already exists") ||
                    e.message?.includes("duplicate")
                ) {
                    console.log("SKIP (exists):", stmt.slice(0, 80));
                } else {
                    throw e;
                }
            }
        }
        console.log("ALL DONE");
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
});
