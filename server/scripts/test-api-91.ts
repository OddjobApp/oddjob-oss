import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { missionService } from "@domain/mission/core/mission.service.js";
import { db } from "@server/database_service.js";

async function testService() {
  console.log("Testing missionService.getMissionDetail(91) directly...");
  try {
    const detail = await missionService.getMissionDetail(91);
    if (!detail) {
      console.log("Mission 91 not found");
      process.exit(1);
    }
    console.log("Mission Details retrieved successfully!");
    console.log("ID:", detail.id);
    console.log("Name:", detail.name);
    console.log("Details:", JSON.stringify(detail, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("Error calling service:", e);
    process.exit(1);
  }
}

testService().catch(console.error);

