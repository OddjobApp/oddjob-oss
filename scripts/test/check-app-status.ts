import "dotenv/config";
import { db } from "../../server/database_service.js";
import { apps, appInstances, appDeployments } from "../../shared/schema/index.js";
import { eq } from 'drizzle-orm';

async function run() {
  const [app] = await db.select().from(apps).where(eq(apps.id, 824));
  console.log('APP 824 FULL RECORD:', JSON.stringify(app, null, 2));
  const deps = await db.select().from(appDeployments).where(eq(appDeployments.appId, 824));
  console.log('DEPS:', deps.map(d => ({ id: d.id, slug: d.publicSlug, org: d.organizationId })));
  for (const dep of deps) {
    const insts = await db.select().from(appInstances).where(eq(appInstances.deploymentId, dep.id));
    console.log(`INSTANCES FOR DEP ${dep.id} (org ${dep.organizationId}):`, insts.map(i => ({ id: i.id, port: i.port, status: i.status })));
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
