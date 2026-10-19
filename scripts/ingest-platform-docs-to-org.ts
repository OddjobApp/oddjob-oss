import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";
import { bestPracticesService } from "../server/domain/admin/best-practices.service.js";
import { documentService } from "../server/domain/knowledge/core/extraction/document-service.js";
import { graphService } from "../server/domain/knowledge/core/graph/graph-service.js";

async function main() {
  console.log("Fetching all organizations from `orgs` table...");
  const orgResult = await db.execute(sql`SELECT org_id, name FROM orgs ORDER BY org_id ASC`);
  console.log(`Found ${orgResult.rows.length} organizations:`, orgResult.rows);

  const articles = await bestPracticesService.getArticles(true);
  console.log(`Ingesting ${articles.length} platform best practice articles into each organization...`);

  for (const org of orgResult.rows) {
    const orgId = Number(org.org_id);
    const orgContext = {
      organizationId: orgId,
      userId: "system",
      role: "admin",
      permissions: ["*"]
    };

    console.log(`\n=== Ingesting into Org #${orgId} (${org.name}) ===`);
    let count = 0;

    for (const article of articles) {
      try {
        // 1. Create Document in Organization
        const doc = await documentService.createDocument({
          title: `[Best Practice] ${article.title}`,
          textContent: article.markdown,
          sourceType: "best_practices" as any,
          metadata: {
            articleId: article.id,
            category: article.category,
            badge: article.badge,
            audience: article.audience,
            autonomyLevel: article.autonomyLevel,
            version: article.version,
            tags: article.tags,
            filePath: article.filePath
          }
        }, orgContext as any);

        // 2. Create Knowledge Graph Node in Organization
        await graphService.createNode({
          label: "Document",
          name: article.title,
          properties: {
            articleId: article.id,
            category: article.category,
            badge: article.badge,
            sourceType: "best_practices",
            filePath: article.filePath
          },
          data: {
            summary: article.summary,
            tags: article.tags
          },
          knowledgeDocumentId: doc.id,
          extractionSources: [],
          verificationStatus: "verified"
        }, orgContext as any);

        count++;
      } catch (err: any) {
        console.warn(`Note on article ${article.id} in org ${orgId}: ${err.message}`);
      }
    }

    console.log(`Successfully synced ${count}/${articles.length} articles into Org #${orgId} (${org.name})`);
  }

  console.log("\nAll platform documentation articles successfully synchronized and moved to organization knowledge base!");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal ingestion error:", err);
  process.exit(1);
});
