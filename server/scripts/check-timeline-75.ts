import "dotenv/config";
import { missionRunService } from "../domain/mission/core/mission-run.service.js";

async function main() {
  const runId = 75;
  const timeline = await missionRunService.getTimeline(runId);
  console.log(JSON.stringify(timeline, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

