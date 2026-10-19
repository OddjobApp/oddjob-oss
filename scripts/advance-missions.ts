import { missionService } from "../server/domain/mission/core/mission.service.js";

async function advance() {
  const runIds = [268, 269, 270];
  console.log("--- Advancing Mission Sequences ---");
  
  for (const id of runIds) {
    try {
      console.log(`Advancing run ${id}...`);
      await missionService.advanceSequence(id);
      console.log(`  -> Advance triggered for ${id}`);
    } catch (err: any) {
      console.error(`  -> Failed to advance ${id}: ${err.message}`);
    }
  }
  
  // Wait a bit for the async launches to settle
  await new Promise(resolve => setTimeout(resolve, 3000));
  process.exit(0);
}

advance().catch(err => {
  console.error(err);
  process.exit(1);
});
