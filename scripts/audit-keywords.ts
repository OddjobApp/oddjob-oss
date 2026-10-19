
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function auditKeywords() {
    console.log("=== Knowledge Base Keyword Audit ===\n");

    const docs = await db.select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        sourceType: knowledgeDocuments.sourceType,
        metadata: knowledgeDocuments.metadata
    }).from(knowledgeDocuments);

    console.log(`Total Documents: ${docs.length}\n`);

    const sourceStats: Record<string, { total: number; withKeywords: number }> = {};
    const allKeywords: Record<string, number> = {};

    docs.forEach(doc => {
        const source = doc.sourceType || "unknown";
        if (!sourceStats[source]) sourceStats[source] = { total: 0, withKeywords: 0 };
        sourceStats[source].total++;

        const metadata = doc.metadata as any;
        const keywords = metadata?.keywords || [];

        if (Array.isArray(keywords) && keywords.length > 0) {
            sourceStats[source].withKeywords++;
            keywords.forEach((k: string) => {
                const term = k.toLowerCase().trim();
                allKeywords[term] = (allKeywords[term] || 0) + 1;
            });
        }
    });

    console.log("Source Statistics:");
    console.table(sourceStats);

    console.log("\nTop 20 Keywords Across All Docs:");
    const sortedKeywords = Object.entries(allKeywords)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    sortedKeywords.forEach(([term, count]) => {
        console.log(`- ${term}: ${count}`);
    });

    console.log("\nExample Document Metadata (Confluence):");
    const confluenceDoc = docs.find(d => d.sourceType === 'confluence');
    if (confluenceDoc) {
        console.log(JSON.stringify(confluenceDoc.metadata, null, 2));
    } else {
        console.log("No confluence documents found.");
    }
}

auditKeywords().catch(console.error);
