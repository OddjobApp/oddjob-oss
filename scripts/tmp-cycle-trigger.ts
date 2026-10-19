import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, and, or } from "drizzle-orm";
import { CycleManagerService } from "@domain/mission/core/cycle-manager.service.js";

const [c] = await db.select().from(operationalCycles).where(eq(operationalCycles.id,95)).limit(1);
if (!c) { console.log("CYCLE NOT FOUND"); process.exit(1); }
if (c.status !== "active") { console.log(`NOT ACTIVE (${c.status}) — aborting`); process.exit(1); }
const [inflight] = await db.select({id:missionRuns.id}).from(missionRuns)
  .where(and(eq(missionRuns.cycleId,95), or(eq(missionRuns.status,"active"),eq(missionRuns.status,"running"),eq(missionRuns.status,"pending")))).limit(1);
if (inflight) { console.log(`IN-FLIGHT run #${inflight.id} — aborting to avoid duplicate`); process.exit(1); }

const blueprints = (c.metadata as any)?.blueprints || [];
console.log(`Triggering cycle 95 with ${blueprints.length} blueprints, org=291, priority=${c.priority ?? 3}...`);
await CycleManagerService.spawnBlueprintsWithDeps(95, blueprints, "system", 291, c.priority ?? 3);
console.log("TRIGGERED — spawnBlueprintsWithDeps returned");
process.exit(0);
