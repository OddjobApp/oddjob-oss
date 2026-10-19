
import 'dotenv/config';
import { db } from "../../server/db/index.js";
import { orgs } from "@shared/schema";

async function main() {
    try {
        const results = await db.select().from(orgs);
        console.log("Organizations:", results);
    } catch (e) {
        console.error("Error fetching orgs:", e);
    }
    process.exit(0);
}

main().catch(console.error);
