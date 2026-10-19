
import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions, knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { sql, eq, and } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> RUNNING TARGETED DIAGNOSTIC EXTRACTION <<<");
    const docId = 22;
    const missionId = 1;

    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).limit(1);

    if (!doc) {
        console.error(`Document ${docId} not found.`);
        process.exit(1);
    }

    console.log(`Processing Doc ${doc.id}: ${doc.title}`);

    const extractionService = new KnowledgeExtractionService();
    try {
        const [record] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: doc.id,
            schemaId: 1,
            status: "processing",
            organizationId: doc.organizationId,
            missionId: missionId,
            createdBy: "DIAGNOSTIC_RUN_LINKED",
            progress: 0
        }).returning();

        const stats = await extractionService.processExtractionTask(
            record.id,
            doc.id,
            1,
            doc.organizationId,
            async (p, m) => console.log(`  [${p}%] ${m}`),
            missionId
        );

        console.log("✅ Extraction Finished.");
        console.log("Stats:", JSON.stringify(stats, null, 2));

        // Let's verify one of the newly created nodes
        const nodes = await db.select().from(knowledgeNodes).where(
            and(
                eq(knowledgeNodes.knowledgeDocumentId, doc.id),
                eq(knowledgeNodes.missionId, missionId)
            )
        ).limit(5);

        console.log("\n--- Verification: Sample Nodes Created ---");
        console.table(nodes.map(n => ({ id: n.id, label: n.label, name: n.name, missionId: n.missionId })));

        const edges = await db.select().from(knowledgeEdges).where(
            eq(knowledgeEdges.missionId, missionId)
        ).limit(5);

        console.log("\n--- Verification: Sample Edges Created ---");
        console.table(edges.map(e => ({ id: e.id, relation: e.relation, missionId: e.missionId })));

    } catch (e: any) {
        console.error("❌ Extraction Failed:", e.message);
        console.error(e.stack);
    }
    process.exit(0);
}

main().catch(console.error);

