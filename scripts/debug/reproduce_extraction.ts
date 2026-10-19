// @ts-nocheck

import 'dotenv/config';
import { db } from "@server/db/index.js";
import { extractAndCreateKnowledgeGraph } from "@domain/knowledge/core/extraction/knowledge-graph-extractor.js";
import { storage } from "@domain/knowledge/core/storage.service.js";

async function reproduce() {
    try {
        console.log("Starting reproduction...");

        // Mock Data (from user's debug output)
        const data = {
            issues: [
                {
                    id: "1",
                    key: "TEST-1",
                    fields: { summary: "Test Issue 1" }
                },
                {
                    id: "2",
                    key: "TEST-2",
                    fields: { summary: "Test Issue 2" }
                }
            ]
        };

        // Mock Rules (from user's debug output)
        const entityRules = [
            {
                entityType: "Issue",
                label: "Issue Title",
                mappings: {
                    name: "issues"
                }
            }
        ];

        const relationshipRules: any[] = [];
        const organizationId = 5; // User's Org

        console.log("Calling extractor...");
        const result = await extractAndCreateKnowledgeGraph({
            data,
            entityRules,
            relationshipRules: [],
            organizationId,
            storage,
            createdBy: "reproduce-script",
            extractionSource: 'pipeline',
        });

        console.log("Extraction Result:", JSON.stringify(result, null, 2));

    } catch (err) {
        console.error("Reproduction Failed:", err);
    }
    process.exit(0);
}

reproduce();
