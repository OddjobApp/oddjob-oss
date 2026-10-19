import "dotenv/config";
import { db } from "../db/index.js";
import { appDeployments, apps, orgs } from "@shared/schema/index.js";
import { eq, like, ne } from "drizzle-orm";

async function cleanup() {
  const deployments = await db.select().from(appDeployments).where(like(appDeployments.publicSlug, 'sdlc%'));
  console.log('Found deployments:', deployments.map(d => d.publicSlug));

  // Delete all deployments that have sdlc but are NOT org 255
  for (const dep of deployments) {
    if (dep.organizationId !== 255) {
      console.log(`Deleting deployment ${dep.publicSlug} from org ${dep.organizationId}`);
      await db.delete(appDeployments).where(eq(appDeployments.id, dep.id));
      await db.delete(apps).where(eq(apps.id, dep.appId));
    }
  }
  
  console.log('Cleanup complete.');
  process.exit(0);
}

cleanup().catch(console.error);
