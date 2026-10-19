import "dotenv/config";
import { db } from "@server/database_service.js";
import { orgs, users } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { fullReindex } from "@domain/xray/core/xray-indexing.service.js";

// MCP Handlers
import { handleCreateDataset } from "../mcp/handlers/datasets.js";
import { handleCreateJob } from "../mcp/handlers/jobs.js";
import { handleCreateMission, handleAddMissionDependency } from "../mcp/handlers/missions-enhanced.js";
import { handleLaunchCycle } from "../mcp/handlers/cycles.js";

async function runMcpOrchestratedCycles() {
    console.log("--- Starting MCP Orchestrated Knowledge Graph Cycles ---");

    const [org] = await db.select().from(orgs).where(eq(orgs.name, "Default Org")).limit(1);
    if (!org) {
        console.error("No organization found.");
        process.exit(1);
    }

    const [sysUser] = await db.select().from(users).limit(1);
    const userId = sysUser?.id || "system";

    const context = {
        userId,
        organizationId: org.id,
        isSuperAdmin: true,
        protocolVersion: "1.0",
        named: {} as Record<string, string>,
        positional: {} as Record<number, string>,
    };

    // Helper to unwrap MCP response
    const unwrap = (res: any) => {
        if (res.isError) throw new Error(res.error || "Unknown MCP Error");
        return res.content.find((c: any) => c.type === 'text')?.text;
    };

    try {
        console.log("\n[1/5] Creating Datasets...");
        const rawRes = await handleCreateDataset({ name: "Unstructured Corpus Alpha", description: "Raw text for KG training" }, context);
        const goldRes = await handleCreateDataset({ name: "Gold Standard KG Triples", description: "Validated triples for RLHF" }, context);
        const synthRes = await handleCreateDataset({ name: "Synthetic Training Scenarios", description: "Generated scenarios for agent training" }, context);
        console.log("Datasets created.");

        console.log("\n[2/5] Creating Agents...");
        // Cycle 1 Agents
        const extractorRes = await handleCreateJob({ name: "Entity Extractor Bot", type: "ai_agent", description: "Extracts raw entities" }, context);
        const mapperRes = await handleCreateJob({ name: "Relationship Mapper Agent", type: "ai_agent", description: "Maps semantic links" }, context);
        const supervisorRes = await handleCreateJob({ name: "Taxonomy Supervisor", type: "ai_agent", description: "Audits mapping against ontology" }, context);
        // Cycle 2 Agents
        const validatorRes = await handleCreateJob({ name: "Graph Validator", type: "ai_agent", description: "Identifies contradictions" }, context);
        const feedbackRes = await handleCreateJob({ name: "RLHF Feedback Generator", type: "ai_agent", description: "Generates binary feedback" }, context);
        // New Specialized Agents
        const ontologyRes = await handleCreateJob({ name: "Ontology Engineer Agent", type: "ai_agent", description: "Structures raw data into semantic triplets" }, context);
        const curatorRes = await handleCreateJob({ name: "Dataset Curator Agent", type: "ai_agent", description: "Generates synthetic training datasets and validates quality" }, context);
        const auditRes = await handleCreateJob({ name: "Compliance & Audit Agent", type: "ai_agent", description: "Reviews agent-generated content against safety guidelines" }, context);
        console.log("Agents created.");

        console.log("\n[3/5] Creating Missions...");
        // Cycle 1 Missions
        const m1 = await handleCreateMission({ name: "Extraction Mission", objective: "Extract entities from Corpus Alpha", orgId: org.id }, context);
        const m2 = await handleCreateMission({ name: "Mapping Mission", objective: "Map semantic relationships", orgId: org.id }, context);
        const m3 = await handleCreateMission({ name: "Supervision Mission", objective: "Audit taxonomy", orgId: org.id }, context);
        
        // Cycle 2 Missions
        const m4 = await handleCreateMission({ name: "Validation Sweep", objective: "Sweep graph for contradictions", orgId: org.id }, context);
        const m5 = await handleCreateMission({ name: "Feedback Generation", objective: "Generate RLHF feedback", orgId: org.id }, context);

        // New Cycle Missions
        const m6 = await handleCreateMission({ name: "Knowledge Enrichment Cycle", objective: "Extract entities and update blackboard", orgId: org.id }, context);
        const m7 = await handleCreateMission({ name: "Dataset Generation Cycle", objective: "Create synthetic scenarios for training", orgId: org.id }, context);
        const m8 = await handleCreateMission({ name: "Forensic Audit Cycle", objective: "Review newly added entities for anomalies", orgId: org.id }, context);
        
        // Parse mission IDs
        const getMissionId = (res: any) => {
            const data = JSON.parse(unwrap(res));
            return data.data?.id || data.id; // handle wrapper
        };
        const id1 = getMissionId(m1);
        const id2 = getMissionId(m2);
        const id3 = getMissionId(m3);
        const id4 = getMissionId(m4);
        const id5 = getMissionId(m5);
        const id6 = getMissionId(m6);
        const id7 = getMissionId(m7);
        const id8 = getMissionId(m8);
        console.log(`Missions created with IDs: ${id1}, ${id2}, ${id3}, ${id4}, ${id5}, ${id6}, ${id7}, ${id8}`);

        console.log("\n[4/5] Setting up Dependencies...");
        await handleAddMissionDependency({ sourceMissionId: id2, targetMissionId: id1, type: "sequential", condition: "completed" }, context);
        await handleAddMissionDependency({ sourceMissionId: id3, targetMissionId: id2, type: "sequential", condition: "completed" }, context);
        await handleAddMissionDependency({ sourceMissionId: id5, targetMissionId: id4, type: "sequential", condition: "completed" }, context);
        
        // New Dependencies
        await handleAddMissionDependency({ sourceMissionId: id8, targetMissionId: id6, type: "sequential", condition: "completed" }, context);
        console.log("Dependencies configured.");

        console.log("\n[5/5] Launching Business Cycles...");
        await handleLaunchCycle({ name: "Raw Text to KG Pipeline", objective: "Process unstructured data into the Knowledge Graph", priority: 1 }, context);
        await handleLaunchCycle({ name: "KG Refinement & Training Loop", objective: "Validate KG entries and generate RLHF training data", priority: 2 }, context);
        await handleLaunchCycle({ name: "Data Augmentation Loop", objective: "Continuous dataset generation and audit loop", priority: 3 }, context);
        console.log("Cycles launched.");

        console.log("\n--- Triggering full X-Ray Reindex ---");
        await fullReindex(org.id);
        console.log("Reindex complete.");

    } catch (err: any) {
        console.error("Error during MCP orchestration:", err.message || err);
    }

    process.exit(0);
}

runMcpOrchestratedCycles();
