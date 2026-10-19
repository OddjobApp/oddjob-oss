import { db } from "../server/database_service.js";
import { xrayNodeDocumentation } from "../shared/schema/xray-documentation.js";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("Seeding high-density Xray feature documentation specs for AI agents...");

  const featureSpecs = [
    {
      nodeId: "feature::swarm_marketplace",
      nodeType: "capability",
      summary: "Swarm Task Marketplace for decentralized multi-agent bidding and capacity allocation.",
      status: "published",
      documentationStatus: "up-to-date",
      tags: ["swarm", "marketplace", "bidding", "agents"],
      isAiGenerated: false,
      content: `# Swarm Task Marketplace Specification

## Overview
Decentralized multi-agent bidding and execution routing platform. Agents evaluate task requirements, compute confidence scores, and place bids on open marketplace tasks.

## Core API Endpoints
- \`POST /api/swarm/tasks\` — Create open task (binds W3C traceparent metadata).
- \`POST /api/swarm/tasks/:id/bids\` — Submit agent bid (specifying score, cost, latency).
- \`POST /api/swarm/tasks/:id/accept-bid\` — Accept winning bid with optimistic concurrency lock.
- \`POST /api/swarm/tasks/:id/auto-match\` — Automatically evaluate and match highest-scoring bid.

## Concurrency & Safety Protocol
- \`acceptBid\` uses optimistic locking (\`WHERE status = 'open'\`).
- Winning bid status updated to \`accepted\`; sibling bids updated to \`rejected\`.
- Capacity limits enforce per-organization token budget caps.
`,
    },
    {
      nodeId: "feature::graph_rag",
      nodeType: "capability",
      summary: "Hybrid Graph RAG and entity-relation extraction for enterprise knowledge retrieval.",
      status: "published",
      documentationStatus: "up-to-date",
      tags: ["rag", "graph", "qdrant", "knowledge"],
      isAiGenerated: false,
      content: `# Hybrid Graph RAG Specification

## Overview
Combines Qdrant dense vector search with multi-hop graph topology expansion to perform structured enterprise knowledge retrieval.

## Core API Endpoints
- \`POST /api/knowledge-extraction/batch\` — Dispatch parallel document entity-relation extraction jobs.
- \`POST /api/knowledge/rag/query\` — Perform hybrid vector + graph RAG query.

## Traversal Rules & Performance Caching
- Query hash responses cached in Redis (\`graph_rag:cache:\${hash}\`) for instant fast-path hits.
- Multi-hop traversal honors \`maxHops\` (default 2) and \`similarityThreshold\` (default 0.75).
- Automated fallback to keyword search if vector embedding services fail.
`,
    },
    {
      nodeId: "feature::cycle_builder",
      nodeType: "capability",
      summary: "Graph-based visual canvas for composing multi-step operational cycle blueprints.",
      status: "published",
      documentationStatus: "up-to-date",
      tags: ["cycle-builder", "blueprints", "flow", "operations"],
      isAiGenerated: false,
      content: `# Cycle Blueprint Builder Specification

## Overview
Visual operational workflow canvas enabling users and AI agents to design, draft, and execute multi-phase cycle blueprints.

## Core API Endpoints
- \`GET /api/cycle-builder/drafts\` — List active draft definitions.
- \`POST /api/cycle-builder/drafts\` — Create or update draft flow graph.
- \`POST /api/cycle-builder/drafts/:id/publish\` — Validate readiness checklist and promote draft to production cycle blueprint.

## Operational Constraints
- Dependency graph must be a Directed Acyclic Graph (DAG).
- Requires at least one trigger node (manual, schedule, or webhook).
- Supports HIL approval nodes for gated human sign-off.
`,
    },
    {
      nodeId: "feature::steering_vectors",
      nodeType: "capability",
      summary: "Prompt-space behavioral vector control and closed-loop critique calibration.",
      status: "published",
      documentationStatus: "up-to-date",
      tags: ["steering", "behavioral", "ocean", "ai"],
      isAiGenerated: false,
      content: `# AI Steering Vector Service Specification

## Overview
Provides dynamic behavioral prompt steering by injecting activation directives and Golden Path SOPs based on task type and critique feedback loops.

## Core API Endpoints
- \`GET /api/ai/steering/vector\` — Resolve active steering vector for mission context.
- \`POST /api/ai/steering/feedback\` — Record post-execution critique feedback and recalibrate \\(\\alpha\\) intensity.

## Feedback Calibration Rules
- When critique consensus score $< 60/100$, \\(\\alpha\\) intensity scales to $0.85$ (enforcing tight conservatism).
- When critique score $\\ge 80/100$, \\(\\alpha\\) scales down to $0.5$.
- Steering block is omitted when \\(\\alpha < 0.1\\).
`,
    },
  ];

  for (const spec of featureSpecs) {
    const existing = await db.select().from(xrayNodeDocumentation).where(eq(xrayNodeDocumentation.nodeId, spec.nodeId)).limit(1);

    if (existing.length > 0) {
      await db.update(xrayNodeDocumentation)
        .set({
          summary: spec.summary,
          content: spec.content,
          status: spec.status,
          documentationStatus: spec.documentationStatus,
          tags: spec.tags,
          updatedAt: new Date(),
        })
        .where(eq(xrayNodeDocumentation.nodeId, spec.nodeId));
      console.log(`Updated Xray doc for ${spec.nodeId}`);
    } else {
      await db.insert(xrayNodeDocumentation).values(spec);
      console.log(`Created Xray doc for ${spec.nodeId}`);
    }
  }

  console.log("✅ All Xray feature documentation specs seeded successfully!");
  process.exit(0);
}

main().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
