import { agentCardService } from "../server/domain/agent-cards/core/agent-card.service.js";
import { projectService } from "../server/domain/projects/core/project.service.js";

async function main() {
  console.log("=== Testing Backend Services for Org 342 (Oddjob System) ===");
  try {
    const cards = await agentCardService.list(342);
    console.log(`Agent cards for Org 342 count: ${cards.length}`);
    if (cards.length > 0) {
      console.log("Sample card:", cards[0].name, cards[0].personaType);
    }
  } catch (e) {
    console.error("agentCardService.list error:", e);
  }

  try {
    const projects = await projectService.listProjects({ organizationId: 342 }, { includeArchived: false });
    console.log(`Projects for Org 342 count: ${projects.length}`);
    if (projects.length > 0) {
      console.log("Sample project:", projects[0]);
    }
  } catch (e) {
    console.error("projectService.listProjects error:", e);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
