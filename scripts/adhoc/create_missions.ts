
import { db } from '../../server/database_service.js';
import { pipelines, users } from '../../shared/schema/index.js';
import { missionService } from '../../server/domain/mission/core/mission.service.js';

async function main() {
  const [user] = await db.select().from(users).limit(1);
  const userId = user ? String(user.id) : "1";
  const orgId = user?.defaultOrgId || 1;

  console.log(`Using User ID: ${userId}, Org ID: ${orgId}`);

  // 1. Pre-planned Mission
  console.log("Creating Pre-planned Mission...");
  const prePlanned = await missionService.createMission({
    name: "Research: Quantum Computing Trends",
    objective: "Perform a multi-step research into quantum computing trends for 2026.",
    organizationId: orgId,
    type: "collaborative",
    executionStrategy: "pre_planned",
    status: "active"
  }, userId, [], false, {
    steps: [
      { id: "step_1", name: "Initial Search", description: "Search for 2026 QC papers", order: 1 },
      { id: "step_2", name: "Entity Extraction", description: "Extract key companies", order: 2 },
      { id: "step_3", name: "Trend Analysis", description: "Analyze technical breakthroughs", order: 3 },
      { id: "step_4", name: "Market Impact", description: "Predict economic impact", order: 4 },
      { id: "step_5", name: "Final Report", description: "Synthesize findings into a document", order: 5 }
    ]
  });
  console.log(`Created Pre-planned Mission ID: ${prePlanned.id}`);
  await missionService.launchMission(prePlanned.id, userId, orgId);

  // 2. Dynamic Autonomous Mission
  console.log("Creating Dynamic Autonomous Mission...");
  const dynamic = await missionService.createMission({
    name: "Research: Fusion Energy Commercialization",
    objective: "Autonomously investigate the current state of fusion energy commercialization.",
    organizationId: orgId,
    type: "supervisor_led",
    executionStrategy: "dynamic_autonomous",
    status: "active"
  }, userId);
  console.log(`Created Dynamic Autonomous Mission ID: ${dynamic.id}`);
  await missionService.launchMission(dynamic.id, userId, orgId);

  // 3. Rolling Wave Mission
  console.log("Creating Rolling Wave Mission...");
  const rolling = await missionService.createMission({
    name: "Research: Post-AGI Economic Theory",
    objective: "Investigate emerging economic theories for a post-AGI world using a rolling wave approach.",
    organizationId: orgId,
    type: "collaborative",
    executionStrategy: "rolling_wave",
    status: "active"
  }, userId);
  console.log(`Created Rolling Wave Mission ID: ${rolling.id}`);
  await missionService.launchMission(rolling.id, userId, orgId);

  console.log("All missions created and launched.");
}

main().catch(console.error);
