import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import fs from "fs";

async function main() {
    console.log("Starting focused document metadata extraction...");

    try {
        const docs = await db.select().from(knowledgeDocuments);
        console.log(`Total documents in DB: ${docs.length}`);

        const summary = docs.map(d => ({
            id: d.id,
            title: d.title,
            source: (d.metadata as any)?.source,
            jobId: (d.metadata as any)?.jobId,
            metadataType: typeof d.metadata
        }));

        fs.writeFileSync('doc_summary.json', JSON.stringify(summary, null, 2));

        const confluence = summary.filter(s => s.source === 'confluence');
        console.log(`Filtered Confluence documents: ${confluence.length}`);

        if (confluence.length > 0) {
            console.log(`Sample Confluence Doc ID: ${confluence[0].id}`);
        } else {
            console.log("No confluence 'source' found in JS filter. Checking for 'jobId' 121...");
            const byJob = summary.filter(s => s.jobId == 121);
            console.log(`Documents with jobId 121: ${byJob.length}`);
        }

        process.exit(0);
    } catch (error) {
        console.error("Extraction failed:", error);
        process.exit(1);
    }
}

main();

