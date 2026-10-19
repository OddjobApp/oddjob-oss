
import "dotenv/config";
import { db } from "../server/db/index.js";
import { agentCritiques } from "@shared/schema";
import { desc } from "drizzle-orm";

async function main() {
    const critiques = await db.select()
        .from(agentCritiques)
        .orderBy(desc(agentCritiques.createdAt))
        .limit(5);

    console.log("--- Recent Critiques ---");
    critiques.forEach(c => {
        console.log(`[${c.score}/10] Interaction: ${c.interactionId}`);
        console.log(`Critique: ${c.criticism}`);
        if (c.correction) {
            console.log(`Correction: ${c.correction}`);
        }
        console.log("-------------------------");
    });
}

main().catch(console.error);
