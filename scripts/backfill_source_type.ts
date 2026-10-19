
import { db } from "../server/database_service.js";
import { knowledgeNodes, knowledgeDocuments, saasConnectors } from "../shared/schema/index.js";
import { eq, isNotNull } from "drizzle-orm";

async function backfillSourceType() {
  console.log("Starting backfill of sourceType for knowledgeNodes...");

  // 1. Get all nodes with documents
  const nodes = await db
    .select({
      id: knowledgeNodes.id,
      documentId: knowledgeNodes.knowledgeDocumentId,
    })
    .from(knowledgeNodes)
    .where(isNotNull(knowledgeNodes.knowledgeDocumentId));

  console.log(`Processing ${nodes.length} nodes...`);

  let count = 0;
  for (const node of nodes) {
    if (!node.documentId) continue;

    const [doc] = await db
      .select({
        sourceType: knowledgeDocuments.sourceType,
        integrationId: knowledgeDocuments.integrationId,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, node.documentId))
      .limit(1);

    if (doc) {
      let sourceType = "manual";
      if (doc.integrationId) {
        const [connector] = await db
          .select({ platform: saasConnectors.platform })
          .from(saasConnectors)
          .where(eq(saasConnectors.id, doc.integrationId))
          .limit(1);
        if (connector) {
          sourceType = connector.platform;
        }
      } else if (doc.sourceType === "instruction") {
        sourceType = "system";
      }

      await db
        .update(knowledgeNodes)
        .set({ sourceType: sourceType as any })
        .where(eq(knowledgeNodes.id, node.id));
      
      count++;
      if (count % 100 === 0) {
        console.log(`Progress: ${count}/${nodes.length}`);
      }
    }
  }

  console.log(`Backfill complete. Updated ${count} nodes.`);
}

backfillSourceType().catch(console.error);
