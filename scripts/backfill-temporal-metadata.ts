import { db } from "../server/database_service.js";
import { knowledgeNodes } from "../shared/schema/index.js";
import { eq, isNull, or, and } from "drizzle-orm";

/**
 * Backfill script to populate sourceCreatedAt and sourceUpdatedAt
 * from the 'data' blob for existing Knowledge Nodes.
 */
async function backfill() {
  console.log("Starting temporal metadata backfill...");

  // Fetch nodes that have temporal data in the blob but not in the columns
  const nodes = await db.select().from(knowledgeNodes).where(
    isNull(knowledgeNodes.sourceCreatedAt)
  );

  console.log(`Found ${nodes.length} nodes to process.`);

  let updatedCount = 0;

  for (const node of nodes) {
    const data = node.data as any;
    let sourceCreatedAt: Date | null = null;
    let sourceUpdatedAt: Date | null = null;

    if (node.label === "Jira Issue") {
      if (data.created) sourceCreatedAt = new Date(data.created);
      if (data.updated) sourceUpdatedAt = new Date(data.updated);
    } else if (node.label === "Confluence Page") {
      // Confluence data might have history or version
      if (data.createdDate) sourceCreatedAt = new Date(data.createdDate);
      if (data.lastUpdated) sourceUpdatedAt = new Date(data.lastUpdated);
      else if (data.version?.when) sourceUpdatedAt = new Date(data.version.when);
    } else if (node.label === "Slack Message") {
      if (data.ts) sourceCreatedAt = new Date(parseFloat(data.ts) * 1000);
    }

    // Generic fallback if label-specific match failed
    if (!sourceCreatedAt && data) {
      const createdKey = ["created", "createdAt", "created_at", "timestamp", "date"].find(k => data[k]);
      if (createdKey) sourceCreatedAt = new Date(data[createdKey]);
    }
    if (!sourceUpdatedAt && data) {
      const updatedKey = ["updated", "updatedAt", "updated_at", "modified", "modifiedAt"].find(k => data[k]);
      if (updatedKey) sourceUpdatedAt = new Date(data[updatedKey]);
    }

    if (sourceCreatedAt || sourceUpdatedAt) {
      await db.update(knowledgeNodes)
        .set({
          sourceCreatedAt,
          sourceUpdatedAt: sourceUpdatedAt || sourceCreatedAt, // Fallback to created if updated is missing
        })
        .where(eq(knowledgeNodes.id, node.id));
      
      updatedCount++;
      if (updatedCount % 10 === 0) {
        console.log(`Updated ${updatedCount} nodes...`);
      }
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} nodes.`);
  process.exit(0);
}

backfill().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
