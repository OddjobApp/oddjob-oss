import { missionService } from "../domain/mission/core/mission.service.js";

async function checkActivity() {
  const activity = await missionService.listGlobalActivity(1, "24h");
  const badEvents = activity.filter((e: any) => e.missionId === 91);
  console.log("Events with missionId 91:", JSON.stringify(badEvents, null, 2));
  
  const mission7Events = activity.filter((e: any) => e.missionId === 7);
  console.log("Events with missionId 7:", JSON.stringify(mission7Events.slice(0, 2), null, 2));
}

checkActivity().catch(console.error).finally(() => process.exit(0));

