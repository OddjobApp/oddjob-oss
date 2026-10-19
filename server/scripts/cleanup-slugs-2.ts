import "dotenv/config";
import { db } from "../db/index.js";
import { appDeployments, apps, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function cleanup() {
  console.log("Cleaning up apps...");
  const slugs = ['pm_workbench', 'sdlc_blueprint', 'hybrid_sdlc', 'oddjob-enterprise-hybrid-ai-sdlc', 'scrum_master_workbench', 'developer_workbench', 'qa_workbench', 'sdlc', 'devops_workbench', 'stakeholder_workbench', 'ai_workforce_dashboard'];
  
  for (const s of slugs) {
     await db.delete(appDeployments).where(eq(appDeployments.publicSlug, s));
     await db.delete(apps).where(eq(apps.slug, s));
  }
  
  // also clean up any deployments for org 2 (which is old TECHHEAD maybe)
  // await db.delete(appDeployments).where(eq(appDeployments.organizationId, 2));

  console.log("Done");
  process.exit(0);
}

cleanup().catch(console.error);
