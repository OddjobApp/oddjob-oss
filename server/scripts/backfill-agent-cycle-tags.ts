/**
 * Backfill `config.sourceCycleSlug` / `config.sourceCycleName` onto existing
 * ai_agent jobs so the App Arsenal can group them under the blueprint that
 * created them (matching the install-time stamp added in org-forge.service.ts).
 *
 * Existing org-scoped agents have no link to their parent cycle, so the Fleet
 * read model (apps.route.ts /fleet) lists them under "Org Apps". New installs
 * stamp the tag automatically; this script is for already-installed orgs that
 * shouldn't need a full blueprint re-install.
 *
 * Mapping is authoritative, not heuristic: an agent job is only stamped when
 *   (a) its org has the cycle installed (operational_cycles.name === manifest.name), and
 *   (b) exactly one such installed cycle declares an agent with the job's name.
 * Jobs that already carry a sourceCycleSlug, or whose name is ambiguous across
 * two installed cycles, are left untouched (and reported).
 *
 * Usage:
 *   npx tsx server/scripts/backfill-agent-cycle-tags.ts            # dry run (default)
 *   npx tsx server/scripts/backfill-agent-cycle-tags.ts --apply    # write changes
 *   npx tsx server/scripts/backfill-agent-cycle-tags.ts --apply --org TECHHEAD7
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { db } from "../database_service.js";
import { orgs, jobs, operationalCycles } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const orgFlagIdx = process.argv.indexOf("--org");
const ORG_FILTER = orgFlagIdx >= 0 ? process.argv[orgFlagIdx + 1] : null;

// Mirror org-forge.service.ts cycleAppSlug derivation so the tag matches the
// one stamped at install time.
function deriveSlug(manifest: any): string {
    return (manifest.id || manifest.slug || manifest.name || "cycle-app")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

type CycleSpec = { cycleName: string; slug: string; agentNames: Set<string> };

function loadCycleSpecs(): CycleSpec[] {
    const dir = path.resolve(process.cwd(), "server/cycles");
    const specs: CycleSpec[] = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".cycle.yaml")) continue;
        let manifest: any;
        try {
            manifest = yaml.load(fs.readFileSync(path.join(dir, file), "utf8"));
        } catch (e) {
            console.warn(`⚠️  ${file}: could not parse — ${(e as Error).message}`);
            continue;
        }
        if (!manifest?.name || !Array.isArray(manifest.agents)) continue;
        // agentName mirrors org-forge: `agent.name || agent.id`.
        const agentNames = new Set<string>(
            manifest.agents.map((a: any) => a.name || a.id).filter(Boolean)
        );
        if (agentNames.size === 0) continue;
        specs.push({ cycleName: manifest.name, slug: deriveSlug(manifest), agentNames });
    }
    return specs;
}

async function main() {
    const cycleSpecs = loadCycleSpecs();
    console.log(`📐 Loaded ${cycleSpecs.length} cycle manifests with declared agents`);

    const orgRows = ORG_FILTER
        ? await db.select().from(orgs).where(eq(orgs.name, ORG_FILTER))
        : await db.select().from(orgs);
    if (orgRows.length === 0) {
        console.log(ORG_FILTER ? `No org named "${ORG_FILTER}"` : "No orgs found");
        process.exit(0);
    }

    let stamped = 0;
    let skippedTagged = 0;
    let skippedAmbiguous = 0;
    let skippedUnmatched = 0;

    for (const org of orgRows) {
        const installedCycleNames = new Set(
            (await db.select({ name: operationalCycles.name })
                .from(operationalCycles)
                .where(eq(operationalCycles.organizationId, org.id)))
                .map((c) => c.name)
        );
        const applicable = cycleSpecs.filter((s) => installedCycleNames.has(s.cycleName));
        if (applicable.length === 0) continue;

        const agentRows = await db.select()
            .from(jobs)
            .where(and(eq(jobs.organizationId, org.id), eq(jobs.type, "ai_agent")));

        for (const job of agentRows) {
            const cfg: any = job.config ?? {};
            if (cfg.sourceCycleSlug) { skippedTagged++; continue; }

            const matches = applicable.filter((s) => s.agentNames.has(job.name));
            if (matches.length === 0) { skippedUnmatched++; continue; }
            if (matches.length > 1) {
                skippedAmbiguous++;
                console.warn(`  ⚠️  ${org.name} · "${job.name}" declared by ${matches.length} installed cycles (${matches.map((m) => m.cycleName).join(", ")}) — skipped`);
                continue;
            }

            const match = matches[0];
            console.log(`  ${APPLY ? "✅" : "→"} ${org.name} · "${job.name}"  →  ${match.slug} (${match.cycleName})`);
            if (APPLY) {
                await db.update(jobs)
                    .set({
                        config: { ...cfg, sourceCycleSlug: match.slug, sourceCycleName: match.cycleName },
                        updatedAt: new Date(),
                    })
                    .where(eq(jobs.id, job.id));
            }
            stamped++;
        }
    }

    console.log(`\n${APPLY ? "Applied" : "Dry run"} — ${stamped} stamped, ${skippedTagged} already tagged, ${skippedAmbiguous} ambiguous, ${skippedUnmatched} org-native/unmatched`);
    if (!APPLY) console.log("Re-run with --apply to write changes.");
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
