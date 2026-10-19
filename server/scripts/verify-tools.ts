
import { AGENT_TOOLS } from "../domain/tools/v1/capabilities/index.js";

console.log("Agent Tools Loaded:", Object.keys(AGENT_TOOLS));
console.log("Mission Tools Present:", !!AGENT_TOOLS.launch_mission);

