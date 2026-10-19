/**
 * Backfill + audit deterministic fallback manifests across every agent.
 *
 * New agents get a manifest automatically at synthesis time
 * (AgentDeploymentService.upsert -> agentFallbackService.derive). This script
 * covers the two cases that hook cannot:
 *
 *   1. Agents that already existed before fallbacks were introduced.
 *   2. Marketplace apps and blueprints whose agents were installed earlier —
 *      "every app in the market has a fallback" is only true if we can prove it,
 *      so --check makes it a verifiable, CI-able property rather than a claim.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-agent-fallbacks.ts           # derive for all
 *   npx tsx server/scripts/backfill-agent-fallbacks.ts --check   # audit only, non-zero exit on gaps
 *   npx tsx server/scripts/backfill-agent-fallbacks.ts --force   # re-derive even if present
 */
import { db } from "../database_service.js";
import { agentDeployments, apps } from "@shared/schema/index.js";
import { agentFallbackService } from "@domain/agents/agent-fallback.service.js";
import type { AgentFallbackManifest } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

const CHECK_ONLY = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");

function hasManifest(value: unknown): value is AgentFallbackManifest {
    const m = value as AgentFallbackManifest | null;
    return !!m && Array.isArray(m.routes) && m.routes.length > 0;
}

/**
 * A manifest whose only route is the terminal static reply is technically
 * present but operationally useless — the agent can say "I'm degraded" and
 * nothing else. Worth surfacing separately so it reads as a gap in the agent's
 * declarations (no forms, no pipelines, no read-safe tools) rather than a bug here.
 */
function isTerminalOnly(m: AgentFallbackManifest): boolean {
    return m.routes.length === 1 && m.routes[0].kind === "static_reply";
}

async function main() {
    console.log(`\n🛟 Agent fallback ${CHECK_ONLY ? "audit" : "backfill"}\n`);

    const deployments = await db.select().from(agentDeployments);
    const marketApps = await db.select({ id: apps.id, slug: apps.slug, name: apps.name, isPublic: apps.isPublic })
        .from(apps).where(eq(apps.isPublic, true));

    console.log(`  ${deployments.length} agent deployment(s), ${marketApps.length} public marketplace app(s)\n`);

    const missing: string[] = [];
    const thin: string[] = [];
    let derived = 0;
    let failed = 0;

    for (const d of deployments) {
        const current = d.fallbackManifest as AgentFallbackManifest | null;
        const present = hasManifest(current);

        if (CHECK_ONLY) {
            if (!present) missing.push(`${d.slug} (#${d.id})`);
            else if (isTerminalOnly(current)) thin.push(`${d.slug} (#${d.id})`);
            continue;
        }

        if (present && !FORCE) continue;

        try {
            // serve_form routes are derived FROM formManifest, so an agent whose
            // form manifest was never populated would silently backfill to
            // "terminal reply only" — present but useless. Populate forms first
            // (updateManifest re-derives fallbacks itself once it finishes).
            const formsEmpty = Object.keys((d.formManifest as any) ?? {}).length === 0;
            if (formsEmpty && (d.allowedPipelineIds?.length ?? 0) > 0) {
                const { AgentDeploymentService } = await import("@domain/agents/agent-deployment.service.js");
                await AgentDeploymentService.updateManifest(d.id);
                console.log(`  🔄 ${d.slug.padEnd(32)} populated empty form manifest first`);
            }

            const manifest = await agentFallbackService.derive(d.id);
            derived++;
            const kinds = manifest.routes.map(r => r.kind);
            console.log(`  ✅ ${d.slug.padEnd(32)} ${manifest.routes.length} route(s): ${[...new Set(kinds)].join(", ")}`);
            if (isTerminalOnly(manifest)) thin.push(`${d.slug} (#${d.id})`);
        } catch (err: any) {
            failed++;
            console.error(`  ❌ ${d.slug.padEnd(32)} ${err.message}`);
        }
    }

    // Marketplace apps reach users through their agents, so an app is "covered"
    // when the agents its blueprint installed have manifests. Apps with no agent
    // deployment yet are not a gap — they have nothing to degrade.
    const orgAgnosticSlugs = new Set(deployments.map(d => d.slug));
    const appsWithoutAgents = marketApps.filter(a => !orgAgnosticSlugs.has(a.slug) &&
        !deployments.some(d => d.slug.includes(a.slug) || a.slug.includes(d.slug)));

    console.log("");
    if (CHECK_ONLY) {
        if (missing.length) {
            console.error(`  ❌ ${missing.length} agent(s) with NO fallback manifest:`);
            missing.forEach(s => console.error(`       - ${s}`));
        } else {
            console.log(`  ✅ Every agent deployment has a fallback manifest.`);
        }
        if (thin.length) {
            console.warn(`\n  ⚠️  ${thin.length} agent(s) have only the terminal reply (no forms/pipelines/read-safe tools declared):`);
            thin.forEach(s => console.warn(`       - ${s}`));
            console.warn(`      These stay responsive under an outage but can only explain that they are degraded.`);
        }
    } else {
        console.log(`  Derived: ${derived}   Failed: ${failed}   Skipped (already present): ${deployments.length - derived - failed}`);
    }

    if (appsWithoutAgents.length) {
        console.log(`\n  ℹ️  ${appsWithoutAgents.length} public app(s) have no installed agent deployment (nothing to degrade yet):`);
        appsWithoutAgents.slice(0, 20).forEach(a => console.log(`       - ${a.slug}`));
    }

    console.log("");
    if (CHECK_ONLY && missing.length) process.exit(1);
    if (failed > 0) process.exit(1);
    process.exit(0);
}

main().catch(err => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
