/**
 * Seed Training Missions TM-01 through TM-05 for TECHHEAD7 (org id=291)
 *
 * Creates the 5 training missions in the database, linked to the TECHHEAD7 org
 * and targeting the appropriate agents from the Hybrid SDLC cycle.
 *
 * Prerequisites: The agent-training cycle must already be installed in TECHHEAD7.
 *
 * Usage: npx tsx server/scripts/seed-training-missions-techhead7.ts
 */
import { db } from "../database_service.js";
import { orgs, jobs } from "@shared/schema/index.js";
import { missions } from "@shared/schema/missions/core.js";
import { missionMembers } from "@shared/schema/missions/index.js";
import { eq, sql } from "drizzle-orm";

async function seedTrainingMissions() {
    try {
        // 1. Verify TECHHEAD7 org or fallback to first org
        let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) {
            [org] = await db.select().from(orgs).limit(1);
        }
        if (!org) throw new Error("No organization found.");
        const orgId = org.id;
        console.log(`\n🎓 Seeding training missions for "${org.name}" (ID: ${orgId})...\n`);

        // 2. Clear existing training missions to ensure clean re-linking
        await db.delete(missions).where(
            sql`organization_id = ${orgId} AND name LIKE 'TM-0%'`
        );
        console.log("Cleared existing training missions to re-link correctly.");

        // 3. Look up the SDLC agent jobs in TECHHEAD7 by name substring
        const orgJobs = await db.select({
            id: jobs.id,
            name: jobs.name,
        }).from(jobs).where(eq(jobs.organizationId, orgId));

        const getJob = (keyword: string) =>
            orgJobs.find(j => {
                const name = (j.name ?? "").toLowerCase();
                if (keyword === "dba") {
                    return name.includes("database") || name === "dba";
                }
                return name.includes(keyword);
            });

        const systemsAnalyst = getJob("analyst");
        const backendDev     = getJob("backend");
        const qaEngineer     = getJob("qa");
        const scrumMaster    = getJob("scrum");
        const dba            = getJob("dba");

        console.log("Resolved agents:");
        console.log("  Systems Analyst:", systemsAnalyst?.name ?? "NOT FOUND", `(jobId=${systemsAnalyst?.id ?? "?"})`);
        console.log("  Backend Dev:    ", backendDev?.name ?? "NOT FOUND",     `(jobId=${backendDev?.id ?? "?"})`);
        console.log("  QA Engineer:    ", qaEngineer?.name ?? "NOT FOUND",     `(jobId=${qaEngineer?.id ?? "?"})`);
        console.log("  Scrum Master:   ", scrumMaster?.name ?? "NOT FOUND",    `(jobId=${scrumMaster?.id ?? "?"})`);
        console.log("  DBA:            ", dba?.name ?? "NOT FOUND",            `(jobId=${dba?.id ?? "?"})`);

        // 3. Define the 5 training missions (using valid mission schema columns)
        const trainingMissions = [
            {
                name: "TM-01: Systems Analyst PRD Mastery",
                objective: "Evaluate and improve the Systems Analyst's PRD output quality, story decomposition depth, and scope control discipline. Target failure categories: shallow_acceptance_criteria, missing_sequence_diagrams, scope_creep_tolerance.",
                type: "supervisor_led" as const,
                executionStrategy: "pre_planned" as const,
                status: "draft" as const,
                targetAgentJobId: systemsAnalyst?.id ?? null,
            },
            {
                name: "TM-02: Backend Developer Schema Safety Drill",
                objective: "Evaluate and improve the Backend Developer's schema safety discipline, workspace health check compliance, and re-planning capability. Target failure categories: migration_bypass, health_check_skip, spec_invention, no_replan_on_failure.",
                type: "supervisor_led" as const,
                executionStrategy: "pre_planned" as const,
                status: "draft" as const,
                targetAgentJobId: backendDev?.id ?? null,
            },
            {
                name: "TM-03: QA Engineer Flake-Free Test Suite",
                objective: "Evaluate and improve QA Engineer's Playwright test authorship quality and JIRA bug report completeness. Target failure categories: flaky_selectors, happy_path_only, incomplete_bug_reports, no_regression_assessment.",
                type: "supervisor_led" as const,
                executionStrategy: "pre_planned" as const,
                status: "draft" as const,
                targetAgentJobId: qaEngineer?.id ?? null,
            },
            {
                name: "TM-04: Scrum Master Sprint Budget Guardian",
                objective: "Improve the Scrum Master's token budget enforcement and HIL escalation discipline. Target failure categories: budget_overrun_tolerance, no_hil_escalation_on_stall.",
                type: "supervisor_led" as const,
                executionStrategy: "pre_planned" as const,
                status: "draft" as const,
                targetAgentJobId: scrumMaster?.id ?? null,
            },
            {
                name: "TM-05: DBA Migration Rollback Protocol",
                objective: "Drill the DBA agent to always include complete, tested rollback scripts with every migration. Target failure categories: missing_rollback_script, incomplete_reverse_order.",
                type: "supervisor_led" as const,
                executionStrategy: "pre_planned" as const,
                status: "draft" as const,
                targetAgentJobId: dba?.id ?? null,
            },
        ];

        // 4. Insert missions
        const createdMissions: any[] = [];
        for (const mDef of trainingMissions) {
            const { targetAgentJobId, ...missionData } = mDef;

            // Check for existing mission with same name in this org
            const existing = await db.select({ id: missions.id })
                .from(missions)
                .where(
                    sql`${missions.organizationId} = ${orgId} AND ${missions.name} = ${mDef.name}`
                )
                .limit(1);

            if (existing.length > 0) {
                console.log(`⏭️  Skipping "${mDef.name}" — already exists (id=${existing[0].id})`);
                createdMissions.push({ id: existing[0].id, name: mDef.name, targetAgentJobId });
                continue;
            }

            const [created] = await db.insert(missions).values({
                ...missionData,
                organizationId: orgId,
                createdBy: "system-training-seed",
            }).returning();

            console.log(`✅ Created mission: "${created.name}" (id=${created.id})`);
            createdMissions.push({ ...created, targetAgentJobId });

            // 5. Link the target agent job as a mission member
            if (targetAgentJobId) {
                await db.insert(missionMembers).values({
                    missionId: created.id,
                    entityType: "job",
                    entityId: targetAgentJobId,
                    role: "primary",
                }).onConflictDoNothing();
                console.log(`   → Linked agent jobId=${targetAgentJobId} as primary member`);
            }
        }

        console.log("\n══════════════════════════════════════════");
        console.log("✅ Training Mission Seed Complete!");
        console.log(`   ${createdMissions.length} missions ready in TECHHEAD7`);
        console.log("══════════════════════════════════════════\n");
        console.log("Mission IDs:");
        createdMissions.forEach(m => console.log(`  [${m.id}] ${m.name}`));
        console.log("\nNext steps:");
        console.log("  1. Navigate to the Agent Performance & Training Portal in TECHHEAD7");
        console.log("  2. Open TM-01 and click 'Trigger Evaluation Run' to start mission-eval-1");
        console.log("  3. Review failure clusters in the Eval Dashboard");
        console.log("  4. Approve training direction via the HIL form");

        process.exit(0);
    } catch (e: any) {
        console.error("\n❌ Seed failed:", e?.message || e);
        console.error(e);
        process.exit(1);
    }
}

seedTrainingMissions();


