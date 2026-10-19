
import { db } from "../server/db/index.js";
import { orgs } from "../shared/schema/index.js";

async function checkOrgs() {
    try {
        const result = await db.select().from(orgs);
        console.log("Orgs List:");
        result.forEach(o => console.log(` - ID: ${o.id}, Name: ${o.name}`));
    } catch (e) {
        console.error("Error checking orgs:", e);
    } finally {
        process.exit();
    }
}

checkOrgs();
