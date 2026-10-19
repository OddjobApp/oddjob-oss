import "dotenv/config";
import { db } from "../db/index.js";
import { pipelines, pipelineSteps, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function check() {
  const orgId = 249;
  const p = await db.select().from(pipelines).where(eq(pipelines.organizationId, orgId));
  console.log('Pipelines:', p.length);
  p.forEach(pl => console.log(' - ' + pl.name));

  const m = await db.select().from(missions).where(eq(missions.organizationId, orgId));
  console.log('Missions (Mission Templates):', m.length);
  m.forEach(mi => console.log(' - ' + mi.name));

  process.exit(0);
}

check().catch(console.error);
