// @ts-nocheck
import { db } from "../server/db/index.js";
import { missionRuns, orgs } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";
// import { sdmRegistryService } from "@domain/mission/core/sdm-registry.service.js";

async function seed() {
  console.log("--- Seeding SDM Changelog Demo Data ---");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const [lastRun] = await db.select().from(missionRuns).orderBy(desc(missionRuns.id)).limit(1);
  const missionId = lastRun?.missionId || 1;

  console.log(`Targeting Mission ID: ${missionId} for seeding.`);

  const mockOrgContext = { organizationId: org.id, userId: 1 };

  // Ensure dataset exists
  console.log("Ensuring Software Engineering Registry dataset exists...");
  await sdmRegistryService.toggleDataset(mockOrgContext);

  const resolutions = [
    {
      title: "Fix Workspace Latency",
      objective: "Resolve N+1 query issue in the Decision Timeline data fetcher.",
      workspace: "Oddjob / Server",
      resolution: "The data fetcher was updated to use a unified query for all timeline items instead of individual calls for each item type. This reduced SQL round-trips by 85%."
    },
    {
      title: "Integrate SDM Registry Hooks",
      objective: "Hook the Mission Lifecycle to the new Engineering Registry Dataset.",
      workspace: "Oddjob / Mission Domain",
      resolution: "Implemented terminal hooks in `MissionLifecycleService` to automatically trigger `SDMRegistryService.logMissionResolution` upon successful mission termination."
    },
    {
      title: "Refactor Component Imports",
      objective: "Standardize import patterns for Mission Intelligence components.",
      workspace: "Oddjob / Client",
      resolution: "Standardized all client-side imports to use absolute `@/` aliases, improving build stability and IDE path resolution."
    },
    {
      title: "Premium Changelog UI",
      objective: "Implement a high-fidelity timeline for software evolutions.",
      workspace: "Oddjob / UI Components",
      resolution: "Created the `SoftwareChangelog` component using a vertical timeline aesthetic with HSL-themed indicators and full markdown support for resolution narratives."
    }
  ];

  for (const res of resolutions) {
    console.log(`Logging resolution: ${res.title}...`);
    await sdmRegistryService.logMissionResolution(
      missionId,
      res.title,
      res.objective,
      res.workspace,
      res.resolution,
      mockOrgContext
    );
  }

  console.log("--- Seeding Complete ---");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
