/**
 * Apply Training Plans TM-01 through TM-05 to TECHHEAD7 Agents
 *
 * For each of the 5 training plans, this script:
 * 1. Finds the target agent job by name in the TECHHEAD7 org (ID 291)
 * 2. Appends behavioral rules to the job's systemPrompt (jobs.config JSONB)
 * 3. If agent_deployment exists, appends mastery legend + OCEAN drift
 *    Otherwise, applies legend as a systemIdentity addition on the job config
 *
 * Usage: npx tsx server/scripts/apply-training-plans-techhead7.ts
 */
import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { agentDeployments } from "@shared/schema/agent-deployments.js";
import { jobs } from "@shared/schema/jobs/table.js";
import { eq, and } from "drizzle-orm";
import { TECHHEAD7_TRAINING_PLANS, type OceanDrift } from "../domain/agents/training-plans/techhead7-plans.js";

interface OceanTraits {
    o: number;
    c: number;
    e: number;
    a: number;
    n: number;
}

const DEFAULT_OCEAN: OceanTraits = { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 };

function applyOceanDrift(current: OceanTraits, drift: OceanDrift): OceanTraits {
    const clamp = (v: number) => Math.min(1.0, Math.max(0.0, v));
    return {
        o: clamp(current.o + (drift.o ?? 0)),
        c: clamp(current.c + (drift.c ?? 0)),
        e: clamp(current.e + (drift.e ?? 0)),
        a: clamp(current.a + (drift.a ?? 0)),
        n: clamp(current.n + (drift.n ?? 0)),
    };
}

/**
 * Mapping from training plan slug identifiers to the actual job names
 * as provisioned by the hybrid-sdlc.cycle.yaml OrgForge installation.
 */
const SLUG_TO_JOB_NAME: Record<string, string> = {
    "ai-systems-analyst": "Systems Analyst",
    "ai-backend-dev": "Backend Developer",
    "ai-qa-engineer": "QA Automation Engineer",
    "ai-scrum-master": "Scrum Master & Agile Coach",
    "ai-dba": "Database Administrator",
};

async function applyTrainingPlans() {
    try {
        // 1. Find TECHHEAD7 org
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) throw new Error("TECHHEAD7 org not found. Ensure org named 'TECHHEAD7' exists (expected ID 291).");
        const orgId = org.id;
        console.log(`\n🧬 Applying training plans to "${org.name}" (ID: ${orgId})...\n`);

        // 2. Fetch all jobs in this org
        const orgJobs = await db
            .select({ id: jobs.id, name: jobs.name, config: jobs.config })
            .from(jobs)
            .where(eq(jobs.organizationId, orgId));

        console.log(`Found ${orgJobs.length} jobs in org ${orgId}.\n`);

        // Also fetch agent deployments for OCEAN/legend updates where available
        const deployments = await db
            .select()
            .from(agentDeployments)
            .where(eq(agentDeployments.organizationId, orgId));

        // 3. Apply each training plan
        let applied = 0;
        let skipped = 0;

        for (const plan of TECHHEAD7_TRAINING_PLANS) {
            console.log(`\n${"═".repeat(60)}`);
            console.log(`📋 ${plan.id}: ${plan.name}`);
            console.log(`   Target: ${plan.targetAgentSlug} → "${SLUG_TO_JOB_NAME[plan.targetAgentSlug] || plan.targetAgentSlug}"`);
            console.log(`${"═".repeat(60)}`);

            // Find the job by name
            const jobName = SLUG_TO_JOB_NAME[plan.targetAgentSlug];
            const job = orgJobs.find(j => j.name === jobName);
            if (!job) {
                console.warn(`   ⚠️  SKIPPED — No job found with name "${jobName}" in org ${orgId}`);
                skipped++;
                continue;
            }

            console.log(`   ✓ Found job: "${job.name}" (id=${job.id})`);

            // --- A. System Prompt Augmentation (jobs.config.systemPrompt) ---
            const config = (job.config ?? {}) as Record<string, any>;
            const currentPrompt: string = config.systemPrompt ?? "";

            // Check if this plan was already applied (idempotency guard)
            if (currentPrompt.includes(`TRAINING PLAN ${plan.id}:`)) {
                console.log(`   ⏭️  System prompt already contains ${plan.id} — skipping prompt update`);
            } else {
                const updatedPrompt = currentPrompt + plan.systemPromptAddition;
                const updatedConfig = { ...config, systemPrompt: updatedPrompt };

                await db.update(jobs).set({ config: updatedConfig }).where(eq(jobs.id, job.id));
                console.log(`   ✅ System prompt augmented (+${plan.systemPromptAddition.length} chars)`);
            }

            // --- B. Legend & OCEAN (via agent_deployment if exists, else via job config) ---
            const deployment = deployments.find(d => d.jobId === job.id);
            if (deployment) {
                // Update legend
                const currentLegend: string = (deployment.legend as string) ?? "";
                if (!currentLegend.includes(plan.legendAddition.slice(0, 50))) {
                    const separator = currentLegend.trim() ? "\n\n" : "";
                    const updatedLegend = currentLegend + separator + plan.legendAddition;
                    await db.update(agentDeployments)
                        .set({ legend: updatedLegend, updatedAt: new Date() })
                        .where(eq(agentDeployments.id, deployment.id));
                    console.log(`   ✅ Legend evolved (+${plan.legendAddition.length} chars)`);
                } else {
                    console.log(`   ⏭️  Legend already contains plan content — skipping`);
                }

                // Update OCEAN traits
                const currentOcean: OceanTraits = (deployment.oceanTraits as OceanTraits) ?? { ...DEFAULT_OCEAN };
                const updatedOcean = applyOceanDrift(currentOcean, plan.oceanDrift);
                await db.update(agentDeployments)
                    .set({ oceanTraits: updatedOcean, updatedAt: new Date() })
                    .where(eq(agentDeployments.id, deployment.id));

                const driftDesc = Object.entries(plan.oceanDrift)
                    .map(([k, v]) => `${k}: ${(v as number) >= 0 ? "+" : ""}${v}`)
                    .join(", ");
                console.log(`   ✅ OCEAN traits adjusted (${driftDesc})`);
                console.log(`      Before: O=${currentOcean.o.toFixed(2)} C=${currentOcean.c.toFixed(2)} E=${currentOcean.e.toFixed(2)} A=${currentOcean.a.toFixed(2)} N=${currentOcean.n.toFixed(2)}`);
                console.log(`      After:  O=${updatedOcean.o.toFixed(2)} C=${updatedOcean.c.toFixed(2)} E=${updatedOcean.e.toFixed(2)} A=${updatedOcean.a.toFixed(2)} N=${updatedOcean.n.toFixed(2)}`);
            } else {
                // No deployment record — store legend in the job's systemIdentity field
                const currentIdentity: string = config.systemIdentity ?? "";
                if (!currentIdentity.includes(plan.legendAddition.slice(0, 50))) {
                    const separator = currentIdentity.trim() ? "\n\n" : "";
                    const updatedIdentity = currentIdentity + separator + plan.legendAddition;
                    const updatedConfig = { ...(config as any), systemIdentity: updatedIdentity };
                    await db.update(jobs).set({ config: updatedConfig }).where(eq(jobs.id, job.id));
                    console.log(`   ✅ Legend stored in job.config.systemIdentity (no deployment record)`);
                } else {
                    console.log(`   ⏭️  systemIdentity already contains plan content — skipping`);
                }
                console.log(`   ℹ️  No agent_deployment for this job — OCEAN traits not adjusted (no personality layer)`);
            }

            applied++;
        }

        // 4. Summary
        console.log(`\n\n${"═".repeat(60)}`);
        console.log(`🎯 TRAINING PLAN APPLICATION COMPLETE`);
        console.log(`${"═".repeat(60)}`);
        console.log(`   Applied: ${applied}/${TECHHEAD7_TRAINING_PLANS.length}`);
        console.log(`   Skipped: ${skipped}/${TECHHEAD7_TRAINING_PLANS.length}`);
        console.log(`${"═".repeat(60)}\n`);

        process.exit(0);
    } catch (e: any) {
        console.error("\n❌ Training plan application failed:", e?.message || e);
        console.error(e);
        process.exit(1);
    }
}

applyTrainingPlans();
