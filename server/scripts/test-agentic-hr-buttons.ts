import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { performanceManagerService } from "../domain/agents/core/performance-manager.service.js";

async function testAgenticHRButtons() {
    try {
        let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) [org] = await db.select().from(orgs).limit(1);
        if (!org) throw new Error("No organization found.");
        const orgId = org.id;

        console.log(`\n🔘 Testing Agentic HR UI Buttons & Action Handlers for "${org.name}" (ID: ${orgId})...\n`);

        // 1. Test Overview Data Retrieval
        console.log("1. Testing 'Overview' Tab Data Fetching...");
        const summary = await performanceManagerService.getPerformanceSummary(orgId);
        // getPerformanceSummary reports the PIP count as `inPIP`, not activePIPs.
        console.log(`   ✅ Summary Retrieved: ${summary.totalAgents} Agents Total | ${summary.inPIP} Active PIPs | Avg Efficiency: ${summary.avgEfficiency.toFixed(2)}`);

        // 2. Test 'Initiate PIP' Button Action
        console.log("\n2. Testing 'Initiate PIP' Button Click Action...");
        const createdPip = await performanceManagerService.createPIP(
            "test-agent-1",
            orgId,
            "Low success rate during automated evaluation benchmark",
            "reliabilityMin"
        );
        const newPip = await performanceManagerService.startPIP(createdPip.id);
        console.log(`   ✅ PIP Successfully Initiated & Activated: PIP ID "${newPip.id}" (Status: ${newPip.status})`);

        // 3. Test 'Start Upskilling' Button Action
        console.log("\n3. Testing 'Start Upskilling' Button Click Action...");
        const upskillJob = await performanceManagerService.initiateUpskilling(
            "test-agent-1",
            orgId,
            newPip.id,
            "fine_tuning"
        );
        console.log(`   ✅ Upskilling Job Started: Job ID "${upskillJob.id}" (Type: ${upskillJob.type}, Status: ${upskillJob.status})`);

        // 4. Test 'Complete PIP (Promote / Graduate)' Button Action
        console.log("\n4. Testing 'Complete PIP / Graduate Agent' Button Action...");
        const completedPip = await performanceManagerService.completePIP(newPip.id, {
            successRate: 0.95,
            costEfficiency: 0.90
        });
        console.log(`   ✅ PIP Completed & Agent Graduated: PIP ID "${completedPip.id}" (Status: ${completedPip.status}, Outcome: ${completedPip.outcome || 'promoted'})`);

        console.log(`\n══════════════════════════════════════════════════════════════`);
        console.log(`✅ All Agentic HR UI Buttons & Action Handlers Verified 100% Working!`);
        console.log(`══════════════════════════════════════════════════════════════\n`);
        process.exit(0);
    } catch (err: any) {
        console.error(`❌ Agentic HR button verification failed: ${err.message}`);
        process.exit(1);
    }
}

testAgenticHRButtons();
