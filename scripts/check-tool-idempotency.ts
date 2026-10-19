/**
 * Reports how much of the agent tool surface declares `idempotency`.
 *
 * Why it matters: tool-planner.service.ts is fail-closed. A tool that declares
 * nothing is treated as side-effecting, so it can never be run speculatively or
 * in parallel. Undeclared tools are not a documentation gap — they are a
 * capability ceiling.
 *
 * This is a ratchet, not a gate. It fails only if coverage drops below the
 * recorded baseline, so the gap can shrink but not silently regrow. Lower
 * MIN_DECLARED as coverage improves.
 */
import fs from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "server", "domain", "tools", "v1", "capabilities");

/**
 * Baseline: 0 undeclared tools (100% coverage enforced).
 */
const MAX_UNDECLARED = 0;

interface ToolRef { name: string; file: string; declared: string | null; }

function extractTools(src: string, file: string): ToolRef[] {
    const out: ToolRef[] = [];
    const hits = [...src.matchAll(/^(\s*)name:\s*"([a-z0-9_]+)",/gm)];
    for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index!;
        const end = i + 1 < hits.length ? hits[i + 1].index! : src.length;
        const body = src.slice(start, end);
        if (!body.includes("execute:")) continue;
        out.push({
            name: hits[i][2],
            file,
            declared: /idempotency:\s*"([a-z-]+)"/.exec(body)?.[1] ?? null,
        });
    }
    return out;
}

/**
 * Tools a factory builds, which the literal scan above cannot see.
 *
 * A file may declare `const def = (name, description, parameters, method):
 * ToolDefinition => ({ name, ..., execute: run(method) })` and then list its
 * tools as `trigger_sast_scan: def("trigger_sast_scan", ...)`. There is no
 * `name: "..."` property to match and only one `execute:` in the whole file, so
 * fifteen tools once entered the registry without this check counting a single
 * one — while it reported 398 of 399 declared and passed.
 *
 * The factory's own body carries the declaration every tool it builds inherits,
 * which is exactly how much this can tell: a factory that declares nothing
 * makes every tool it builds undeclared, and says so per call site.
 */
function extractFactoryTools(src: string, file: string): ToolRef[] {
    const out: ToolRef[] = [];
    const factories = [...src.matchAll(
        /const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*(?::\s*ToolDefinition\s*)?=>\s*\(\{([\s\S]*?)\n\}\);/g,
    )];

    for (const [, fnName, body] of factories) {
        if (!body.includes("execute:")) continue;

        // A factory either fixes the declaration for everything it builds, or
        // forwards it as a parameter — in which case the answer is at each call
        // site, and reading only the factory body would call every one of them
        // undeclared while the call sites state it plainly.
        const fixed = /idempotency:\s*"([a-z-]+)"/.exec(body)?.[1] ?? null;
        const forwarded = !fixed && /idempotency\s*(?:,|:\s*idempotency\b)/.test(body);

        const callSites = [...src.matchAll(new RegExp(`^\\s*([a-z0-9_]+):\\s*${fnName}\\(`, "gm"))];
        for (let i = 0; i < callSites.length; i++) {
            let declared = fixed;
            if (forwarded) {
                const start = callSites[i].index!;
                const end = i + 1 < callSites.length ? callSites[i + 1].index! : src.length;
                declared = /"(none|read-safe|idempotent)"/.exec(src.slice(start, end))?.[1] ?? null;
            }
            out.push({ name: callSites[i][1], file, declared });
        }
    }
    return out;
}

const tools: ToolRef[] = [];
for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".ts") || f.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(DIR, f), "utf-8");
    const found = [...extractTools(src, f), ...extractFactoryTools(src, f)];
    // A tool reached both ways is still one tool.
    const seen = new Set<string>();
    for (const tool of found) {
        if (seen.has(tool.name)) continue;
        seen.add(tool.name);
        tools.push(tool);
    }
}

const declared = tools.filter((t) => t.declared);
const undeclared = tools.filter((t) => !t.declared);
const byKind = declared.reduce<Record<string, number>>((acc, t) => {
    acc[t.declared!] = (acc[t.declared!] ?? 0) + 1;
    return acc;
}, {});

console.log("🔧 [TOOL IDEMPOTENCY] Agent tool side-effect declarations");
console.log(`   ${tools.length} tools, ${declared.length} declared, ${undeclared.length} undeclared`);
console.log(`   ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`   speculation-eligible (read-safe + idempotent): ${(byKind["read-safe"] ?? 0) + (byKind["idempotent"] ?? 0)}`);

if (undeclared.length > MAX_UNDECLARED) {
    console.error(
        `\n   ✗ ${undeclared.length} undeclared exceeds the baseline of ${MAX_UNDECLARED}.` +
        `\n     New tools must declare idempotency: "none" | "read-safe" | "idempotent".` +
        `\n     Undeclared means the planner can never parallelise or speculate on them.\n`,
    );
    const worst = Object.entries(
        undeclared.reduce<Record<string, number>>((acc, t) => {
            acc[t.file] = (acc[t.file] ?? 0) + 1;
            return acc;
        }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [file, n] of worst) console.error(`       ${String(n).padStart(3)}  ${file}`);
    process.exit(1);
}

console.log(`   ✓ within baseline (${undeclared.length}/${MAX_UNDECLARED})\n`);
