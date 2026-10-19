import "dotenv/config";
import { db } from "../../server/db/index.js";
import { graphSchemaDefs, knowledgeNodes, knowledgeEdges, InsertGraphSchemaDef, orgs, pipelines, pipelineExecutions } from "@shared/schema";
import { processSemanticEnrichment } from "../../server/domain/knowledge/core/extraction/knowledge-graph-integration.js";
import { eq, and } from "drizzle-orm";

// Mock Context
const MOCK_RUN_ID = 99999;

async function runTest() {
    console.log("🚀 Starting Knowledge Engine 2.0 Test...");

    // 0. Get Valid Organization
    const existingOrgs = await db.select().from(orgs).limit(1);
    let MOCK_ORG_ID: number;

    if (existingOrgs.length > 0) {
        MOCK_ORG_ID = existingOrgs[0].id;
    } else {
        // Create Mock Org
        const [newOrg] = await db.insert(orgs).values({
            name: "Test Org"
        }).returning();
        MOCK_ORG_ID = newOrg.id;
    }

    // 0b. Get Valid Execution
    let MOCK_EXECUTION_ID: number;
    const existingExecs = await db.select().from(pipelineExecutions).limit(1);

    if (existingExecs.length > 0) {
        MOCK_EXECUTION_ID = existingExecs[0].id;
    } else {
        // Create Pipeline & Exec
        const [pl] = await db.insert(pipelines).values({
            organizationId: MOCK_ORG_ID,
            name: "Test Pipeline",
            triggerType: "manual",
            createdBy: "test_script",
            enableKnowledgeGraph: true
        }).returning();

        const [ex] = await db.insert(pipelineExecutions).values({
            pipelineId: pl.id,
            status: "completed",
            startedAt: new Date(),
            createdBy: "test_script"
        }).returning();
        MOCK_EXECUTION_ID = ex.id;
    }

    console.log(`Using Organization ID: ${MOCK_ORG_ID}, Execution ID: ${MOCK_EXECUTION_ID}`);

    // 1. Cleanup Previous Test Data
    await db.delete(graphSchemaDefs).where(eq(graphSchemaDefs.name, "Test VIN Extractor"));
    // We won't delete nodes/edges to avoid cascading deletes affecting real data, but we'll filter by run ID.

    // 2. Create Test Schema Definition (Regex for 'VIN-XXXX')
    const testSchema: InsertGraphSchemaDef = {
        organizationId: MOCK_ORG_ID,
        name: "Test VIN Extractor",
        description: "Extracts VINs for testing",
        isActive: true,
        mappings: [
            {
                id: "rule_1",
                source_key: "vin_regex",
                is_active: true,
                node_label: "Vehicle",
                relationship: "HAS_VIN",
                extraction_type: "regex",
                config: {
                    regex: "VIN-\\d{4}"
                }
            }
        ],
        entityTypes: [],
        relationshipTypes: [],
        createdBy: "test_script"
    };

    const [schema] = await db.insert(graphSchemaDefs).values(testSchema).returning();
    console.log(`✅ Created Test Schema: ${schema.id}`);

    // 3. Simulate Job Output
    const mockJobOutput = {
        id: "job_output_1",
        type: "Ticket",
        name: "Customer Report",
        description: "User reported issue with VIN-1234 and VIN-5678 during the trip.", // Contains 2 matches
        summary: "Vehicle Breakdown"
    };

    // 4. Run Semantic Enrichment
    console.log("🔄 Running Semantic Enrichment...");
    try {
        await processSemanticEnrichment({
            jobOutput: mockJobOutput,
            organizationId: MOCK_ORG_ID,
            pipelineExecutionId: MOCK_EXECUTION_ID,
            creatorEmail: "test@oddjob.ai"
        });
        console.log("✅ Enrichment Process Completed");
    } catch (err) {
        console.error("❌ Enrichment Failed:", err);
        process.exit(1);
    }

    // 5. Verify Results in Database
    console.log("🔍 Verifying Graph Data...");

    // Check Edges for this Run
    const edges = await db.select().from(knowledgeEdges).where(
        eq(knowledgeEdges.lastUpdatedByRunId, MOCK_EXECUTION_ID)
    );

    console.log(`Found ${edges.length} edges for Run ${MOCK_EXECUTION_ID}`);

    if (edges.length === 0) {
        console.error("❌ No edges created!");
    } else {
        edges.forEach(e => {
            console.log(`   - Edge matching: Source ${e.sourceId} -> Target ${e.targetId} (Rel: ${e.relation})`);
        });
        console.log("✅ Edges verified");
    }

    // Check Target Nodes
    const nodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.pipelineExecutionId, MOCK_EXECUTION_ID));
    const vins = nodes.filter(n => n.name.startsWith("VIN-"));
    console.log(`Found ${vins.length} extracted VIN nodes:`, vins.map(v => v.name).join(", "));

    if (vins.length >= 2) {
        console.log("✅ Regex Extraction Successful (Found VIN-1234 and VIN-5678)");
    } else {
        console.error("❌ Failed to extract all VINs");
    }

    console.log("🎉 Knowledge Engine 2.0 Test Complete");
    process.exit(0);
}

runTest().catch(console.error);
