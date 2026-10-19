import { db } from "../server/db/index.js";
import { projectService } from "../server/domain/projects/core/project.service.js";

async function main() {
  console.log("=== Testing projectService.listApps ===");

  // Acme Corp Default (Project #44, Org #473)
  const acmeApps = await projectService.listApps({ organizationId: 473 }, 44);
  console.log("ACME CORP (Project #44) APPS:", acmeApps);

  // Oddjob Project
  const oddjobProj = await db.execute("SELECT id, key, name, organization_id FROM projects WHERE organization_id = 342 LIMIT 1");
  if (oddjobProj.rows.length > 0) {
    const projId = Number(oddjobProj.rows[0].id);
    const oddjobApps = await projectService.listApps({ organizationId: 342 }, projId);
    console.log(`ODDJOB (Project #${projId}) APPS COUNT:`, oddjobApps.length, "SAMPLE:", oddjobApps.slice(0, 3));
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error testing listApps:", err);
  process.exit(1);
});
