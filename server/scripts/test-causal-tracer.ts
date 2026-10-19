
import 'dotenv/config';
import fs from 'fs';
import { CausalTracer } from "@domain/core/infrastructure/causal-tracer.service.js";
import { type TraceContext } from "@domain/core/infrastructure/causal-tracer.service.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function testCausalTracer() {
    console.log("Starting CausalTracer test...");

    const sessionId = `test_session_${Date.now()}`;
    const context: TraceContext = {
        sessionId,
        organizationId: 7, // Acme Corp (Default)
        jobId: 99999, // Mock job
        userId: "test-user"
    };

    const tracer = new CausalTracer(context);

    // 1. Trace Thought
    console.log("Tracing thought...");
    let thoughtId;
    try {
        thoughtId = await tracer.traceThought("I need to find recent incidents.", 1);
        console.log(`Thought Node ID: ${thoughtId}`);
    } catch (e: any) {
        console.error("Error tracing thought:", e);
        fs.writeFileSync('trace_error.txt', `Error tracing thought: ${e.message}\n${e.stack}`);
        process.exit(1);
    }

    // 2. Trace Tool Execution
    console.log("Tracing tool execution...");
    const toolId = await tracer.traceToolExecution("search_knowledge_base", { query: "incidents" }, "Found 3 incidents...", 1);
    console.log(`Tool Node ID: ${toolId}`);

    // 3. Trace Follow-up Thought
    console.log("Tracing follow-up thought...");
    const thought2Id = await tracer.traceThought("I will analyze the first incident.", 2);
    console.log(`Follow-up Thought Node ID: ${thought2Id}`);

    // Verification
    console.log("Verifying graph nodes and edges...");

    // Check nodes
    const nodes = await db.select().from(knowledgeNodes)
        .where(eq(knowledgeNodes.organizationId, 7))
        .orderBy(desc(knowledgeNodes.createdAt))
        .limit(3);

    console.log("Nodes found:", nodes.length);
    nodes.forEach(n => console.log(`- [${n.label}] ${n.name} (Session: ${(n.data as any)['sessionId']})`));

    // Check edges
    if (thoughtId && toolId && thought2Id) {
        const edges = await db.select().from(knowledgeEdges)
            .where(eq(knowledgeEdges.relation, 'FOLLOWED_BY'))
            .orderBy(desc(knowledgeEdges.createdAt))
            .limit(2);

        console.log("Edges found:", edges.length);
        edges.forEach(e => console.log(`- Edge: ${e.sourceId} -> ${e.targetId} (${e.relation})`));

        const edge1 = edges.find(e => e.sourceId === thoughtId && e.targetId === toolId);
        const edge2 = edges.find(e => e.sourceId === toolId && e.targetId === thought2Id);

        if (edge1 && edge2) {
            console.log("SUCCESS: Chain is correctly linked!");
            fs.writeFileSync('trace_results.json', JSON.stringify({ success: true, nodes: nodes, edges: edges }, null, 2));
        } else {
            console.error("FAILURE: Chain links logical error.");
            fs.writeFileSync('trace_results.json', JSON.stringify({ success: false, reason: "Chain broken" }, null, 2));
        }
    }

    console.log("Test complete.");
    process.exit(0);
}

testCausalTracer().catch(console.error);

