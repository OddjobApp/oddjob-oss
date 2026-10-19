/**
 * Diagnose Mission Failures — TECHHEAD7 (Org 291)
 *
 * Checks why missions are failing by examining:
 * 1. Mission run records and their error messages
 * 2. Agent run steps and failures
 * 3. Environment variable availability
 * 4. AI provider credential status
 */
import { db } from "../database_service.js";
import { missions, missionRuns, agentRunSteps, credentials, jobs } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";

const ORG_ID = 291;

async function diagnose() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  Mission Failure Diagnosis — TECHHEAD7 (Org 291)");
    console.log("═══════════════════════════════════════════════════════════════\n");

    // 1. Get recent mission runs with failures
    console.log("── Recent Mission Runs ──────────────────────────────────────\n");
    const runs = await db.select({
        id: missionRuns.id,
        name: missionRuns.name,
        status: missionRuns.status,
        failureReason: missionRuns.failureReason,
        createdAt: missionRuns.createdAt,
        updatedAt: missionRuns.updatedAt,
    }).from(missionRuns)
      .where(eq(missionRuns.organizationId, ORG_ID))
      .orderBy(desc(missionRuns.createdAt))
      .limit(10);

    if (runs.length === 0) {
        console.log("  No mission runs found for this org.\n");
    } else {
        for (const run of runs) {
            const icon = run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "⏳";
            console.log(`  ${icon} Run #${run.id}: "${run.name}" — ${run.status}`);
            if (run.failureReason) {
                console.log(`     Failure: ${String(run.failureReason).slice(0, 200)}`);
            }
            console.log(`     Created: ${run.createdAt}`);
            console.log("");
        }
    }

    // 2. Get agent run steps with errors
    console.log("── Recent Agent Steps (errors) ─────────────────────────────\n");
    const errorSteps = await db.select({
        id: agentRunSteps.id,
        missionRunId: agentRunSteps.missionRunId,
        type: agentRunSteps.type,
        toolName: agentRunSteps.toolName,
        content: agentRunSteps.content,
        createdAt: agentRunSteps.createdAt,
    }).from(agentRunSteps)
      .where(and(
          eq(agentRunSteps.organizationId, ORG_ID),
          eq(agentRunSteps.type, "error")
      ))
      .orderBy(desc(agentRunSteps.createdAt))
      .limit(10);

    if (errorSteps.length === 0) {
        console.log("  No error steps found.\n");
    } else {
        for (const step of errorSteps) {
            console.log(`  ❌ Step #${step.id} (Run #${step.missionRunId})`);
            console.log(`     Tool: ${step.toolName ?? "N/A"}`);
            console.log(`     Error: ${String(step.content).slice(0, 300)}`);
            console.log("");
        }
    }

    // 3. Check AI provider credential
    console.log("── AI Provider Credential ──────────────────────────────────\n");
    const [aiCred] = await db.select().from(credentials)
        .where(and(eq(credentials.type, "ai_provider"), eq(credentials.organizationId, ORG_ID)))
        .limit(1);

    if (!aiCred) {
        console.log("  ❌ No AI provider credential found for org 291!\n");
    } else {
        const meta = aiCred.metadata as any;
        console.log(`  Credential: "${aiCred.name}" (id: ${aiCred.id})`);
        console.log(`  Provider: ${meta?.provider ?? "unknown"}`);
        console.log(`  Model: ${meta?.default_model ?? "unknown"}`);
        console.log(`  Env Var: ${aiCred.envVarName}`);
        const envValue = process.env[aiCred.envVarName];
        console.log(`  Env Value Set: ${envValue ? "YES (" + envValue.slice(0, 8) + "...)" : "❌ NO — THIS IS THE PROBLEM"}`);
        console.log("");
    }

    // 4. Check key environment variables
    console.log("── Environment Variables ────────────────────────────────────\n");
    const envVars = [
        "AI_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
        "ANTHROPIC_API_KEY", "DATABASE_URL", "REDIS_URL",
        "JIRA_API_TOKEN", "JIRA_BASE_URL", "CONFLUENCE_API_TOKEN",
    ];
    for (const v of envVars) {
        const val = process.env[v];
        const status = val ? `✅ Set (${val.slice(0, 6)}...)` : "❌ NOT SET";
        console.log(`  ${v}: ${status}`);
    }
    console.log("");

    // 5. Check agent jobs
    console.log("── Agent Jobs ──────────────────────────────────────────────\n");
    const agentJobs = await db.select({ id: jobs.id, name: jobs.name, isActive: jobs.isActive })
        .from(jobs)
        .where(and(eq(jobs.organizationId, ORG_ID), eq(jobs.type, "ai_agent")));

    for (const job of agentJobs) {
        console.log(`  ${job.isActive ? "✅" : "❌"} ${job.name} (id: ${job.id}, active: ${job.isActive})`);
    }
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    process.exit(0);
}

diagnose();
