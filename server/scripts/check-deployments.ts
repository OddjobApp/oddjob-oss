import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";

async function main() {
    const allApps = await db.select().from(apps);
    const allDeps = await db.select().from(appDeployments);
    const allInsts = await db.select().from(appInstances);
    
    console.log("=== APPS ===");
    console.log(JSON.stringify(allApps, null, 2));
    console.log("=== DEPLOYMENTS ===");
    console.log(JSON.stringify(allDeps, null, 2));
    console.log("=== INSTANCES ===");
    console.log(JSON.stringify(allInsts, null, 2));
}

main().catch(console.error);
