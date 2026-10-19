
import "dotenv/config";
import { db } from "./server/db.js";
import { knowledgeNodes } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

async function listKusNodesFull() {
    try {
        const result = await db.select({
            id: knowledgeNodes.id,
            label: knowledgeNodes.label,
            name: knowledgeNodes.name,
            verificationStatus: knowledgeNodes.verificationStatus,
            knowledgeDocumentId: knowledgeNodes.knowledgeDocumentId
        })
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.organizationId, 1));
        
        console.log(`Found ${result.length} nodes for Org 1.`);
        
        const statusCounts = result.reduce((acc: any, node) => {
            acc[node.verificationStatus || 'null'] = (acc[node.verificationStatus || 'null'] || 0) + 1;
            return acc;
        }, {});
        
        console.log("Status Counts:", JSON.stringify(statusCounts, null, 2));
        
        if (result.length > 0) {
            console.log("Samples (first 20):");
            console.log(JSON.stringify(result.slice(0, 20), null, 2));
        }
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        process.exit(0);
    }
}

listKusNodesFull();
