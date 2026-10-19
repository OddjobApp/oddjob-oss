
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/knowledge-base.js";
import { or, and, eq } from "drizzle-orm";

async function simulateAgentSearchImproved() {
    const query = "Maintenance Schedules";
    const queryLower = query.toLowerCase();
    const tokens = queryLower.split(/\s+/).filter(t => t.length > 0);

    console.log(`Improved Simulating search for: "${query}"`);

    const documents = await db.select().from(knowledgeDocuments).where(
        and(
            eq(knowledgeDocuments.sourceType, "confluence"),
            eq(knowledgeDocuments.organizationId, 1) // Acme
        )
    ).limit(1000);

    const scored = documents.map((d: any) => {
        const title = d.title?.toLowerCase() || "";
        const content = (d.textContent || "").toLowerCase();
        let score = 0;
        let matchesAll = true;

        tokens.forEach(token => {
            const inTitle = title.includes(token);
            const inContent = content.includes(token);
            if (inTitle) { score += 50; } // Increased from 10
            if (inContent) { score += 5; } // Increased from 2
            if (!inTitle && !inContent) matchesAll = false;
        });

        if (matchesAll) { score += 10; } // Decreased from 15
        if (title.includes(queryLower)) { score += 100; } // New boost for exact title match

        return { id: d.id, title: d.title, score };
    }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);

    console.log(`Found ${scored.length} results.`);
    scored.slice(0, 5).forEach(s => {
        console.log(` - [${s.id}] Score: ${s.score}, Title: ${s.title}`);
    });
    process.exit(0);
}

simulateAgentSearchImproved();
