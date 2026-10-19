import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { like, eq } from "drizzle-orm";

async function main() {
  // Find the SDLC app that appears in the marketplace
  const sdlcApps = await db.select({
    id: apps.id,
    slug: apps.slug,
    name: apps.name,
    isPublic: apps.isPublic,
    isSystem: apps.isSystem,
    blueprint: apps.blueprint,
    description: apps.description,
    config: apps.config,
  }).from(apps).where(eq(apps.isPublic, true));

  console.log(`\n=== Public Apps in Global Market (${sdlcApps.length}) ===\n`);
  for (const app of sdlcApps) {
    console.log(`  ID: ${app.id}`);
    console.log(`  Name: ${app.name}`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Blueprint: ${app.blueprint}`);
    console.log(`  System: ${app.isSystem}`);
    console.log(`  Description: ${(app.description || "").slice(0, 100)}`);
    console.log(`  Config type: ${(app.config as any)?.type || "none"}`);
    console.log("");
  }
  process.exit(0);
}
main();
