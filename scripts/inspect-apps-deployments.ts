import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const allProjects = await db.execute(sql`SELECT id, key, name, organization_id FROM projects`);
  console.log("ALL PROJECTS:", allProjects.rows);

  const allApps = await db.execute(sql`SELECT id, name, slug, organization_id, developer_org_id, is_public, is_system FROM apps LIMIT 20`);
  console.log("SAMPLE APPS:", allApps.rows);

  const allDeployments = await db.execute(sql`SELECT id, app_id, organization_id, status, is_published, project_id FROM app_deployments`);
  console.log("ALL APP DEPLOYMENTS:", allDeployments.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
