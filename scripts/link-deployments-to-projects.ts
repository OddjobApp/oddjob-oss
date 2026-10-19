import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Linking Active Deployments & Installed Apps to Project Spaces ===");

  // 1. Fetch all projects grouped by org
  const projectsRes = await db.execute(sql`
    SELECT id, key, name, organization_id, is_default 
    FROM projects 
    ORDER BY organization_id, is_default DESC, id ASC
  `);
  console.log(`Found ${projectsRes.rows.length} total projects across organizations.`);

  const projectsByOrg = new Map<number, any[]>();
  for (const proj of projectsRes.rows) {
    const orgId = Number(proj.organization_id);
    const list = projectsByOrg.get(orgId) || [];
    list.push(proj);
    projectsByOrg.set(orgId, list);
  }

  // 2. Fetch all active app deployments
  const deploymentsRes = await db.execute(sql`
    SELECT id, app_id, organization_id, status, is_published, project_id 
    FROM app_deployments 
    WHERE status IN ('active', 'installed')
  `);
  console.log(`Found ${deploymentsRes.rows.length} active app deployments.`);

  let linkedCount = 0;
  let updatedDeploymentCount = 0;

  for (const dep of deploymentsRes.rows) {
    const orgId = Number(dep.organization_id);
    const appId = Number(dep.app_id);
    const orgProjects = projectsByOrg.get(orgId) || [];

    if (orgProjects.length === 0) {
      // If org has no project, create a default project space for it
      const newProj = await db.execute(sql`
        INSERT INTO projects (organization_id, key, name, description, is_default, created_at, updated_at)
        VALUES (${orgId}, ${`org-${orgId}-default`}, ${`Default Project Space`}, 'Default project workspace for organization apps and missions.', true, NOW(), NOW())
        RETURNING id, key, name, organization_id, is_default
      `);
      orgProjects.push(newProj.rows[0]);
      projectsByOrg.set(orgId, orgProjects);
      console.log(`  + Created default project for Org #${orgId}: org-${orgId}-default (ID: ${newProj.rows[0].id})`);
    }

    // Target the primary/default project for this org
    const targetProject = orgProjects.find((p: any) => p.is_default) || orgProjects[0];
    const projectId = Number(targetProject.id);

    // Update app_deployments.project_id if null
    if (!dep.project_id) {
      await db.execute(sql`
        UPDATE app_deployments 
        SET project_id = ${projectId} 
        WHERE id = ${dep.id}
      `);
      updatedDeploymentCount++;
    }

    // Insert junction into project_resources if not exists
    const existingResource = await db.execute(sql`
      SELECT id FROM project_resources 
      WHERE project_id = ${projectId} AND resource_type = 'app' AND resource_id = ${appId}
      LIMIT 1
    `);

    if (existingResource.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, created_at)
        VALUES (${projectId}, 'app', ${appId}, 'primary', NOW())
        ON CONFLICT DO NOTHING
      `);
      linkedCount++;
    }
  }

  console.log(`\n✅ Finished Linking:`);
  console.log(`  - Linked ${linkedCount} apps into project_resources junction.`);
  console.log(`  - Updated ${updatedDeploymentCount} app deployments with project_id.`);

  // 3. Verify for Acme Corp (Org 473, Project 44)
  const acmeResources = await db.execute(sql`
    SELECT pr.id, pr.project_id, pr.resource_type, pr.resource_id, a.name, a.slug, a.status 
    FROM project_resources pr
    JOIN apps a ON a.id = pr.resource_id
    WHERE pr.project_id = 44 AND pr.resource_type = 'app'
  `);
  console.log(`\nAcme Corp Default (Project #44) Apps count:`, acmeResources.rows.length);
  if (acmeResources.rows.length > 0) {
    console.log(`Sample app in Acme Corp:`, acmeResources.rows[0]);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error linking deployments:", err);
  process.exit(1);
});
