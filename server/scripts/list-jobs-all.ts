import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";

async function main() {
    const list = await db.select().from(jobs);
    console.log("All Jobs in Database:");
    list.forEach(j => {
        console.log(`ID: ${j.id} | Org: ${j.organizationId} | Name: ${j.name} | Type: ${j.type}`);
    });
}
main().catch(console.error).finally(() => process.exit(0));
