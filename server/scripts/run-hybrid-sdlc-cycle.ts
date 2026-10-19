import "dotenv/config";
import { db } from "../database_service.js";
import { orgs, users } from "../../shared/schema/index.js";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runLiveCycle() {
    console.log("=== LAUNCHING LIVE HYBRID AI SDLC CYCLE ===");

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

    // 2. Read the SDLC Cycle App YAML
    const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    const manifest = yaml.load(yamlContent) as any;

    // 3. Parse manifest missions into blueprints
    const blueprints = manifest.missions.map((m: any) => {
        const dependencies: any[] = [];
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
        name: "Live Enterprise Hybrid AI SDLC Cycle",
        objective: "Run actual SDLC missions using active agents with Jira/GitHub webhook gating",
        priority: 5,
        budgetLimitUsd: "100.00",
        requiresApproval: 0,
        blueprints
    };

    console.log("Launching cycle via CycleManagerService...");
    const cycle = await CycleManagerService.launchCycle(cycleData, userId, orgId);

    console.log("==========================================");
    console.log(`Live Operational Cycle launched! ID: ${cycle.id}`);
    console.log(`Status: ${cycle.status}`);
    console.log("The initial missions (Sprint Zero & Sprint Kickoff) are starting asynchronously.");
    console.log("==========================================");
    process.exit(0);
}

runLiveCycle().catch(e => {
    console.error("Failed to launch live cycle:", e);
    process.exit(1);
});
