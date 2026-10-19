/**
 * Generate a comprehensive capability catalog from the LIVE tool registry using
 * the ACDD capability-manifest mapping. Documents every registered capability
 * (306+ across ~47 categories) — the concrete capability surface the platform
 * exposes — grouped by category with its contract.
 *
 * Run: npx tsx scripts/acdd-generate-catalog.ts
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";

function anchor(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function cell(text: string): string {
    return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// Heuristic risk from name/description — a first-pass signal, not authoritative.
// (The ACDD manifest mapping hardcodes Low; a richer per-tool risk profile is a
// follow-up. Flagged in the catalog header.) Word boundaries matter here:
// "deployment" must not read as "deploy", and a read-only "query" tool is not High.
function inferRisk(name: string, desc: string): string {
    const n = name.toLowerCase();
    const s = `${n} ${desc.toLowerCase()}`;

    // Destructive or privileged → High (checked first, wins over read prefixes).
    if (/super ?admin|self.?modif|system_file|\bdelete\b|\bdrop\b|\bdeploy\b|\buninstall\b|\bpurge\b|\bterminate\b|\boverwrite\b|\bshell\b|external_sql/.test(s)) {
        return "High";
    }
    // Read-only verbs by name prefix → Low.
    if (/^(get_|list_|read_|search_|find_|discover_|preview_|current_|analyze_|query_)/.test(n)) {
        return "Low";
    }
    // Mutations / side-effecting verbs → Medium.
    if (/\b(write|create|update|set|send|launch|trigger|insert|patch|publish|commit|invoke|edit|scaffold|add|remove|execute|run|refactor|compose|evolve)\b/.test(s)) {
        return "Medium";
    }
    return "Low";
}

async function main() {
    const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
    const { toolDefinitionToManifest } = await import("@domain/capabilities/infrastructure/capability-triggers.js");

    const tools = getAgentTools();
    interface Entry {
        id: string;
        name: string;
        group: string;
        inputs: Record<string, string>;
        risk: string;
        description: string;
    }
    const entries: Entry[] = [];
    let skipped = 0;
    for (const [name, tool] of Object.entries(tools)) {
        const manifest = toolDefinitionToManifest(name, tool as any);
        if (!manifest) {
            skipped++;
            continue;
        }
        const description = (tool as any).description || manifest.metadata.description;
        entries.push({
            id: manifest.capability_id,
            // Prefer the tool's rich, real group over the manifest's collapsed category.
            name: (tool as any).label || manifest.metadata.display_name,
            group: (tool as any).group || "Ungrouped",
            inputs: manifest.technical_spec.inputs,
            risk: inferRisk(name, description),
            description,
        });
    }

    const byCategory: Record<string, Entry[]> = {};
    for (const e of entries) (byCategory[e.group] ||= []).push(e);
    const categories = Object.keys(byCategory).sort();
    const manifests = entries; // for count reporting

    const lines: string[] = [];
    lines.push("# Oddjob Capability Catalog");
    lines.push("");
    lines.push(
        "_Auto-generated from the live agent tool registry via the ACDD capability-manifest mapping " +
            "(`toolDefinitionToManifest`). Regenerate with `npx tsx scripts/acdd-generate-catalog.ts`._",
    );
    lines.push("");
    lines.push(
        `**${manifests.length} capabilities** across **${categories.length} categories**. ` +
            "Each row is a capability contract — a discrete outcome the platform can perform — with its typed " +
            "inputs (derived from the tool's schema). Categories reflect the tool's registered group. " +
            "**Risk is a name/description heuristic**, a first-pass signal only (a per-tool risk profile is a follow-up). " +
            "See `capabilities.md` for the capability model, lifecycle, and synchronization engine that keep these " +
            "documents in sync with the code.",
    );
    lines.push("");
    lines.push("## Categories");
    lines.push("");
    for (const category of categories) {
        lines.push(`- [${category}](#${anchor(category)}) — ${byCategory[category].length}`);
    }
    lines.push("");

    for (const category of categories) {
        lines.push(`## ${category}`);
        lines.push("");
        lines.push("| Capability ID | Name | Inputs | Risk* | Description |");
        lines.push("| --- | --- | --- | --- | --- |");
        const rows = byCategory[category].sort((a, b) => a.id.localeCompare(b.id));
        for (const e of rows) {
            const inputs =
                Object.entries(e.inputs)
                    .map(([k, v]) => `\`${k}\`: ${v}`)
                    .join("<br>") || "—";
            lines.push(`| \`${e.id}\` | ${cell(e.name)} | ${inputs} | ${e.risk} | ${cell(e.description).slice(0, 160)} |`);
        }
        lines.push("");
    }

    const outPath = path.join(process.cwd(), "docs", "capabilities", "CATALOG.md");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, lines.join("\n") + "\n", "utf8");

    console.log(
        `Wrote ${outPath}\n  ${manifests.length} capabilities documented, ${categories.length} categories` +
            `${skipped ? `, ${skipped} unmappable tools skipped` : ""}.`,
    );
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
