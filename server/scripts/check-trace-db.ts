import 'dotenv/config';
import fs from 'fs';
import { db } from "../database_service.js";
import { knowledgeNodes, orgs } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function checkTrace() {
    console.log("Checking Trace in DB...");
    try {

        const organizations = await db.select().from(orgs).limit(5);
        console.log("Orgs found:", organizations.length);
        organizations.forEach(o => console.log(`- [${o.id}] ${o.name}`));

        const nodes = await db.select().from(knowledgeNodes)
            .where(eq(knowledgeNodes.label, 'AgentReasoning'))
            .orderBy(desc(knowledgeNodes.createdAt))
            .limit(5);

        console.log("Found nodes:", nodes.length);
        nodes.forEach(n => console.log(`- [${n.id}] ${n.name}`));

        process.exit(0);
    } catch (e: any) {
        fs.writeFileSync('db_error_msg.txt', `DB ERROR: ${e.message}\nSTACK: ${e.stack}`);
        process.exit(1);
    }
}

checkTrace();

