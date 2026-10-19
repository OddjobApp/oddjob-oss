import "dotenv/config";
import { appRegistryService } from "../../server/domain/apps/app-registry.service.js";

async function run() {
  const res = await appRegistryService.startApp(824, 473);
  console.log("LAUNCH RESULT:", res);
  process.exit(0);
}

run().catch((err) => {
  console.error("LAUNCH ERROR:", err);
  process.exit(1);
});
