
import "dotenv/config";
import { db } from "./server/db.js";
import { knowledgeNodes } from "@shared/schema";

async function summarize() {
    try {
        const allNodes = await db.select().from(knowledgeNodes);
        console.log("Total Nodes Count:", allNodes.length);
        const distribution: Record<string, number> = {};
        allNodes.forEach(node => {
            const orgId = node.organizationId === null ? "Global (NULL)" : String(node.organizationId);
            distribution[orgId] = (distribution[orgId] || 0) + 1;
        });
        console.log("Distribution:", JSON.stringify(distribution, null, 2));

        const kusNodes = allNodes.filter(n => n.organizationId === 1);
        console.log("KUS Nodes Sample IDs:", kusNodes.map(n => n.id).join(", "));
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        process.exit(0);
    }
}

summarize();
