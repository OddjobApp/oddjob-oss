import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const projects = await db.execute(sql`SELECT id, key, name, organization_id FROM projects WHERE key = 'acme-corp-default' OR key ILIKE '%acme%'`);
  console.log("PROJECTS:", projects.rows);

  const orgId = projects.rows[0]?.organization_id || 342;
  const projectId = projects.rows[0]?.id;

  const appRows = await db.execute(sql`SELECT id, name, slug, organization_id, status FROM apps WHERE organization_id = ${orgId} LIMIT 10`);
  console.log("APPS IN ORG:", appRows.rows);

  const deployments = await db.execute(sql`SELECT id, app_id, organization_id, status, is_published, project_id FROM app_deployments WHERE organization_id = ${orgId} LIMIT 10`);
  console.log("APP DEPLOYMENTS IN ORG:", deployments.rows);

  const agentDeps = await db.execute(sql`SELECT id, name, organization_id, is_active, project_id FROM agent_deployments WHERE organization_id = ${orgId} LIMIT 10`);
  console.log("AGENT DEPLOYMENTS IN ORG:", agentDeps.rows);

  const pr = await db.execute(sql`SELECT * FROM project_resources WHERE project_id = ${projectId}`);
  console.log("PROJECT RESOURCES FOR THIS PROJECT:", pr.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
