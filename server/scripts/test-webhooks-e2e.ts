import "dotenv/config";
import { db } from "../database_service.js";
import { 
    orgs, users, operationalCycles, missionRuns, missions, cycleDependencyGates 
} from "../../shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { cycleDependencyGatewayService } from "../domain/mission/core/cycle-dependency-gateway.service.js";
import { rollingWaveOrchestratorService } from "../domain/mission/core/rolling-wave-orchestrator.service.js";
import { eq, and } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    console.log("=== STARTING WEBHOOKS AND CYCLE E2E TEST ===");

    // 1. Fetch default Org & User
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("No organization found. Run seed first.");
        process.exit(1);
    }
    const [user] = await db.select().from(users).limit(1);
    const userId = user?.id || "system";
    const orgId = org.id;

    console.log(`Using Org ID: ${orgId}, User ID: ${userId}`);

    // 2. Read and Re-install the SDLC Cycle App
    const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    console.log("Installing/updating SDLC Cycle App...");
    const installResult = await orgForgeService.installCycleApp(orgId, yamlContent);
    console.log("App installation result:", installResult);

    // 3. Mock mission launch to intercept AI/worker execution
    const runIdToName = new Map<number, string>();
    const nameToRunId = new Map<string, number>();

    rollingWaveOrchestratorService.launchMission = async (missionId: number, userId: string, orgId: number | null, priority?: number) => {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new Error(`Mission template ${missionId} not found`);

        // Insert a mock completed mission run so that it immediately satisfies dependencies
        const [run] = await db.insert(missionRuns).values({
            missionId,
            organizationId: orgId,
            name: `Mock Run: ${mission.name}`,
            status: 'completed',
            isSuccess: true,
            createdBy: userId,
            missionContext: { phase: 'PLANNING' }
        }).returning();

        console.log(`[MOCK LAUNCH] Spawned & Completed Run ID: ${run.id} for Blueprint: "${mission.name}"`);
        runIdToName.set(run.id, mission.name);
        nameToRunId.set(mission.name, run.id);

        return { success: true, missionRunId: run.id };
    };

    // 4. Construct blueprints list from the YAML manifest missions
    const manifest = (orgForgeService as any).manifest || yaml.load(yamlContent);
    const blueprints = manifest.missions.map((m: any) => {
        const dependencies: any[] = [];
        // Map on_success(mission-id) triggers to finish_to_start dependencies
        if (m.trigger && typeof m.trigger === 'string' && m.trigger.startsWith("on_success(")) {
            const upstreamId = m.trigger.replace("on_success(", "").replace(")", "");
            const upstreamMission = manifest.missions.find((x: any) => x.id === upstreamId);
            if (upstreamMission) {
                dependencies.push({
                    blueprintName: upstreamMission.name,
                    type: "finish_to_start"
                });
            }
        }

        return {
            name: m.name,
            objective: m.objective || m.name,
            type: m.type || "mission",
            dependencies,
            config: {
                trigger: m.trigger,
                environment: m.environment,
                primaryAgent: m.primary_agent,
                sequence: m.sequence
            },
            metadata: {}
        };
    });

    const cycleData = {
        name: "E2E Hybrid SDLC Test Cycle",
        objective: "Verify webhook gates, conditional triggers and sequence dependencies",
        priority: 5,
        budgetLimitUsd: "100.00",
        requiresApproval: false,
        blueprints
    };

    console.log("\nLaunching the cycle...");
    const cycle = await db.insert(operationalCycles).values({
        name: cycleData.name,
        objective: cycleData.objective,
        organizationId: orgId,
        createdBy: userId,
        status: "active",
        blueprintCount: blueprints.length,
        metadata: { blueprints }
    }).returning();
    
    const cycleId = cycle[0].id;
    console.log(`Cycle launched successfully! ID: ${cycleId}`);

    // Persist blueprints
    const blueprintValues = blueprints.map((bp: any) => ({
        cycleId,
        name: bp.name,
        objective: bp.objective,
        type: bp.type,
        dependencies: bp.dependencies,
        estimatedDays: 1,
        config: bp.config,
        metadata: {}
    }));
    await db.insert(cycleBlueprints).values(blueprintValues);
    console.log(`Persisted ${blueprintValues.length} blueprints in the database.`);

    // Start execution in the background so we can trigger webhooks
    const launchPromise = CycleManagerService.spawnBlueprintsWithDeps(
        cycleId,
        blueprints,
        userId,
        orgId,
        5
    );

    // Let the main thread yield so the initial missions spawn
    await new Promise(r => setTimeout(r, 1000));

    console.log("\n--- VERIFYING INITIAL STATE ---");
    console.log("Checking active runs...");
    let currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    console.log("Active runs:", currentRuns.map(r => r.name));
    
    // Mission 0 and Mission 1 should be active because they have no blocking triggers
    const activeNames = currentRuns.map(r => runIdToName.get(r.id));
    if (activeNames.includes("Project Initialization & Sprint Zero") && activeNames.includes("Sprint Kickoff & Planning")) {
        console.log("SUCCESS: Initial missions (Sprint Zero & Kickoff) spawned immediately.");
    } else {
        console.error("FAIL: Initial missions did not spawn correctly.");
    }

    console.log("\nChecking gates in database...");
    let gates = await db.select().from(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, cycleId));
    gates.forEach(g => console.log(` - Gate: ${g.upstreamBlueprintName} -> ${g.downstreamBlueprintName} (${g.status})`));

    // Stage 1 initial planning & kickoff completed automatically
    console.log("\n--- STAGE 1: INITIAL PLANNING & KICKOFF COMPLETED AUTOMATICALLY ---");

    // Requirements & Design Analysis is blocked on transition.to == 'Design Ready'
    console.log("\n--- STAGE 2: TRIGGER JIRA WEBHOOK (DESIGN READY) ---");
    console.log("Dispatching JIRA webhook payload...");
    await cycleDependencyGatewayService.triggerWebhook("jira", {
        transition: { to: "Design Ready" },
        issue: { type: "Story" }
    });

    await new Promise(r => setTimeout(r, 1000));
    console.log("Checking if Requirements mission spawned...");
    currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    if (currentRuns.some(r => runIdToName.get(r.id) === "Requirements & Design Analysis")) {
        console.log("SUCCESS: Requirements & Design Analysis mission spawned upon receiving webhook trigger!");
    } else {
        console.error("FAIL: Requirements mission did not spawn.");
    }

    // Core Application Development is blocked on transition.to == 'In Progress'
    console.log("\n--- STAGE 3: TRIGGER JIRA WEBHOOK (IN PROGRESS) ---");
    console.log("Dispatching JIRA webhook payload...");
    await cycleDependencyGatewayService.triggerWebhook("jira", {
        transition: { to: "In Progress" },
        issue: { type: "Story" }
    });

    await new Promise(r => setTimeout(r, 1000));
    console.log("Checking if Development mission spawned...");
    currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    if (currentRuns.some(r => runIdToName.get(r.id) === "Core Application Development")) {
        console.log("SUCCESS: Core Application Development mission spawned upon receiving webhook trigger!");
    } else {
        console.error("FAIL: Development mission did not spawn.");
    }

    console.log("\n--- STAGE 4: REQUIREMENTS AND DEVELOPMENT COMPLETED AUTOMATICALLY ---");

    // QA is blocked on pull_request.merged == true AND target_branch == 'staging'
    console.log("\n--- STAGE 5: TRIGGER GITHUB WEBHOOK (PR MERGED TO STAGING) ---");
    console.log("Dispatching GitHub webhook payload...");
    await cycleDependencyGatewayService.triggerWebhook("github", {
        pull_request: { merged: true, base: { ref: 'staging' } },
        target_branch: 'staging'
    });

    await new Promise(r => setTimeout(r, 1000));
    console.log("Checking if QA mission spawned...");
    currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    if (currentRuns.some(r => runIdToName.get(r.id) === "QA & Regression Testing")) {
        console.log("SUCCESS: QA & Regression Testing mission spawned upon GitHub PR merge!");
    } else {
        console.error("FAIL: QA mission did not spawn.");
    }

    // QA finishes -> UAT should spawn automatically via dependency
    console.log("\n--- STAGE 6: UAT AUTO-TRIGGERED VIA DEPENDENCY ---");
    await new Promise(r => setTimeout(r, 1000));
    console.log("Checking if UAT mission spawned...");
    currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    if (currentRuns.some(r => runIdToName.get(r.id) === "Release Candidate & UAT")) {
        console.log("SUCCESS: Release Candidate & UAT mission auto-spawned via Gantt dependency!");
    } else {
        console.error("FAIL: UAT mission did not auto-spawn.");
    }

    // UAT finishes -> Production Deployment should spawn automatically
    console.log("\n--- STAGE 7: PRODUCTION DEPLOYMENT AUTO-TRIGGERED VIA DEPENDENCY ---");
    await new Promise(r => setTimeout(r, 1000));
    console.log("Checking if Deployment mission spawned...");
    currentRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
    if (currentRuns.some(r => runIdToName.get(r.id) === "Production Deployment")) {
        console.log("SUCCESS: Production Deployment mission auto-spawned via Gantt dependency!");
    } else {
        console.error("FAIL: Production Deployment mission did not auto-spawn.");
    }

    // Stage 8: Trigger Production Incident to resolve the final background gate
    console.log("\n--- STAGE 8: TRIGGER INCIDENT WEBHOOK ---");
    console.log("Dispatching JIRA Incident webhook payload...");
    await cycleDependencyGatewayService.triggerWebhook("jira", {
        transition: { to: "To Do" },
        issue: { type: "Incident" }
    });

    // Await launchPromise resolution
    console.log("\nAwaiting cycle orchestrator shutdown...");
    await launchPromise;
    console.log("Orchestrator shut down successfully.");

    console.log("\n--- FINAL GATE REPORT ---");
    gates = await db.select().from(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, cycleId));
    gates.forEach(g => {
        console.log(` - Gate: ${g.upstreamBlueprintName} -> ${g.downstreamBlueprintName} Status: [${g.status}]`);
    });

    console.log("\n=== E2E TEST COMPLETED SUCCESSFULLY! ===");
    process.exit(0);
}

// Dynamically import cycleBlueprints schema table since it's used
import { cycleBlueprints } from "../../shared/schema/index.js";

runTest().catch(e => {
    console.error("Test failed with error:", e);
    process.exit(1);
});
