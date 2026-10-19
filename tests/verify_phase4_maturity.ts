import { db } from "../server/db.js";
import { knowledgeNodes } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { graphService } from "../server/domain/knowledge/core/graph/graph-service.js";
import { memoryEvolutionService } from "../server/domain/knowledge/core/evolution/memory-evolution.service.js";
import { knowledgeSynthesisService } from "../server/domain/knowledge/core/evolution/knowledge-synthesis.service.js";

async function verifyPhase4() {
  console.log("--- PHASE 4: AUTONOMOUS MATURITY VERIFICATION ---");

  // 1. Setup Mock Nodes
  const orgId = 1; // Assuming org 1 exists
  const userId = "oddjob-system";

  console.log("1. Creating test nodes...");
  const n1 = await graphService.createNode({
    label: "Feature",
    name: "Autonomous RAG",
    description: "Self-tuning retrieval augmented generation",
    properties: { source: "test" },
    confidenceScore: 0.95,
  }, { organizationId: orgId, userId });

  const n2 = await graphService.createNode({
    label: "Feature",
    name: "Legacy Search",
    description: "Basic keyword search (Obsolete)",
    properties: { source: "test" },
    confidenceScore: 0.4,
  }, { organizationId: orgId, userId });

  const n3 = await graphService.createNode({
    label: "Challenge",
    name: "Recursive Intelligence Gap",
    description: "Uncertainty in how recursive loops converge",
    properties: { source: "test" },
    confidenceScore: 0.7,
  }, { organizationId: orgId, userId });

  // 2. Simulate Usage
  console.log("2. Simulating node usage...");
  await graphService.getNodeById(n1.id, { organizationId: orgId, userId });
  await graphService.getNodeById(n1.id, { organizationId: orgId, userId });
  await graphService.getNodeById(n1.id, { organizationId: orgId, userId });
  await graphService.getNodeById(n3.id, { organizationId: orgId, userId });

  // 3. Refresh Utility Scores
  console.log("3. Refreshing utility scores...");
  await memoryEvolutionService.refreshUtilityScores(orgId);

  const [node1] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, n1.id));
  const [node2] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, n2.id));
  const [node3] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, n3.id));

  console.log(`Node 1 Utility: ${node1.utilityScore} (Usage: ${node1.usageCount})`);
  console.log(`Node 2 Utility: ${node2.utilityScore} (Usage: ${node2.usageCount})`);
  console.log(`Node 3 Utility: ${node3.utilityScore} (Usage: ${node3.usageCount})`);

  // 4. Test Pruning
  console.log("4. Pruning low-utility nodes...");
  const prunedCount = await memoryEvolutionService.pruneStaleKnowledge(orgId, 10.0); // High threshold for test
  console.log(`Pruned ${prunedCount} nodes.`);

  // 5. Test Synthesis
  console.log("5. Detecting knowledge gaps...");
  // Use nodes we just created
  const synthesis = await knowledgeSynthesisService.detectKnowledgeGaps(orgId, [node1.id, node2.id, node3.id]);
  if (synthesis && synthesis.success) {
    console.log("Gap Detected:", synthesis.identifiedGap);
    console.log("Proposed Mission:", synthesis.proposedMission.title);
    
    // 6. Launch Gap Mission
    console.log("6. Launching autonomous gap mission...");
    const missionId = await knowledgeSynthesisService.launchGapMission(orgId, synthesis, userId);
    console.log(`Mission ${missionId} launched successfully!`);
  } else {
    console.warn("Synthesis failed or no gaps detected:", synthesis?.reason || "No summary");
  }

  console.log("--- PHASE 4 VERIFICATION COMPLETE ---");
}

verifyPhase4().catch(err => {
  console.error("VERIFICATION FAILED:");
  console.error(err);
  process.exit(1);
});
