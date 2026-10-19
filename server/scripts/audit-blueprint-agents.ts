/**
 * Read-only audit of every cycle blueprint's agents, to map the scope of the
 * shared-agent-pool attribution issue (see App Arsenal parent-cycle grouping).
 *
 * Reports, across all server/cycles/*.cycle.yaml:
 *   1. Manifests that fail to parse (their agents can never be tagged).
 *   2. Per-blueprint agent counts + how many of each blueprint's agents are
 *      uniquely owned (declared by only this blueprint) vs shared (declared by
 *      others too → ambiguous, stays org-native).
 *   3. The worst-shared agent names (declared by the most blueprints).
 *
 * No DB access, no writes. Usage:
 *   npx tsx server/scripts/audit-blueprint-agents.ts
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function deriveSlug(manifest: any): string {
    return (manifest.id || manifest.slug || manifest.name || "cycle-app")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

type Blueprint = { file: string; name: string; slug: string; agents: string[] };

function main() {
    const dir = path.resolve(process.cwd(), "server/cycles");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".cycle.yaml")).sort();

    const blueprints: Blueprint[] = [];
    const broken: { file: string; error: string }[] = [];
    const noAgents: string[] = [];

    for (const file of files) {
        let manifest: any;
        try {
            manifest = yaml.load(fs.readFileSync(path.join(dir, file), "utf8"));
        } catch (e) {
            broken.push({ file, error: (e as Error).message.split("\n")[0] });
            continue;
        }
        if (!manifest?.name) { broken.push({ file, error: "missing manifest.name" }); continue; }
        if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) { noAgents.push(file); continue; }
        const agents = manifest.agents.map((a: any) => a.name || a.id).filter(Boolean) as string[];
        blueprints.push({ file, name: manifest.name, slug: deriveSlug(manifest), agents });
    }

    // agent name -> blueprints declaring it
    const owners = new Map<string, string[]>();
    for (const bp of blueprints) {
        for (const agent of new Set(bp.agents)) {
            if (!owners.has(agent)) owners.set(agent, []);
            owners.get(agent)!.push(bp.name);
        }
    }
    const isShared = (agent: string) => (owners.get(agent)?.length ?? 0) > 1;

    console.log(`\n=== Blueprint agent audit (${files.length} manifests) ===\n`);

    console.log(`── ${broken.length} manifests FAIL TO PARSE (agents untaggable) ──`);
    for (const b of broken) console.log(`  ✗ ${b.file}  —  ${b.error}`);
    if (noAgents.length) console.log(`\n  (${noAgents.length} manifests parse but declare no agents: ${noAgents.join(", ")})`);

    console.log(`\n── Per-blueprint ownership (unique = groups cleanly, shared = stays org-native) ──`);
    const rows = blueprints.map((bp) => {
        const uniq = new Set(bp.agents);
        const shared = [...uniq].filter(isShared);
        return { name: bp.name, total: uniq.size, unique: uniq.size - shared.length, shared: shared.length, sharedNames: shared };
    }).sort((a, b) => b.shared - a.shared || b.total - a.total);

    for (const r of rows) {
        const flag = r.unique === 0 ? "  ⚠️ NONE groupable" : r.shared === 0 ? "  ✓ fully groupable" : "";
        console.log(`  ${r.name.padEnd(48)} agents=${String(r.total).padStart(2)}  unique=${String(r.unique).padStart(2)}  shared=${String(r.shared).padStart(2)}${flag}`);
    }

    console.log(`\n── Most-shared agent names (root cause of ambiguity) ──`);
    const shared = [...owners.entries()].filter(([, bps]) => bps.length > 1).sort((a, b) => b[1].length - a[1].length);
    for (const [agent, bps] of shared.slice(0, 20)) {
        console.log(`  ${String(bps.length).padStart(2)}× ${agent}`);
    }

    const totalAgents = owners.size;
    const sharedAgents = shared.length;
    console.log(`\n── Summary ──`);
    console.log(`  blueprints with agents : ${blueprints.length}`);
    console.log(`  broken manifests       : ${broken.length}`);
    console.log(`  distinct agent names   : ${totalAgents}`);
    console.log(`  uniquely-owned         : ${totalAgents - sharedAgents}  (group cleanly under their cycle)`);
    console.log(`  shared across cycles   : ${sharedAgents}  (stay org-native by design)`);
}

main();
