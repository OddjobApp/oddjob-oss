import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * The tool registry is one flat namespace. `registerStaticTools` in index.ts
 * spreads ~70 group objects into a single record, so two groups that define the
 * same key do not conflict — the later spread silently wins and the earlier
 * definition becomes unreachable code that still type-checks, still exports, and
 * still looks maintained.
 *
 * That is not hypothetical. `delegate_task` was defined twice: once in
 * PIPELINE_TOOLS (delegate to a pipeline, returns an executionId) and once in
 * DELEGATION_TOOLS (spawn a sub-agent). DELEGATION_TOOLS is spread second, so
 * the pipeline version had never once been reachable.
 *
 * This test parses the group literals rather than importing the registry,
 * because importing it pulls in the database and every integration client.
 */

const CAPABILITIES_DIR = dirname(fileURLToPath(import.meta.url));

/** Top-level keys of each `export const X_TOOLS = { ... }` literal, by group. */
function collectGroupKeys(source: string): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    const lines = source.split(/\r?\n/);
    let group: string | null = null;
    let depth = 0;

    for (const line of lines) {
        if (group === null) {
            const opener = /^export const ([A-Za-z0-9_]+_TOOLS)[^=]*=\s*\{/.exec(line);
            if (opener) {
                group = opener[1];
                depth = 1;
            }
            continue;
        }

        if (depth === 1) {
            const trimmed = line.trim();
            // A key is either `name,` / `name:` unquoted, or `"name":` quoted.
            // A quoted name followed by a COMMA is not a key — several groups are
            // built by a `def("tool_name", ...)` factory whose first argument sits
            // on its own line at this depth, and matching those double-counted
            // every tool in four files.
            const key =
                /^([A-Za-z_][A-Za-z0-9_]*)\s*[,:]/.exec(trimmed) ??
                /^["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/.exec(trimmed);
            if (key && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
                groups.set(group, [...(groups.get(group) ?? []), key[1]]);
            }
        }

        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
        if (depth <= 0) group = null;
    }

    return groups;
}

function everyGroupKey(): Map<string, string[]> {
    const owners = new Map<string, string[]>();
    const files = readdirSync(CAPABILITIES_DIR).filter(
        (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
    );

    for (const file of files) {
        const source = readFileSync(join(CAPABILITIES_DIR, file), "utf8");
        for (const [group, keys] of collectGroupKeys(source)) {
            for (const key of keys) {
                owners.set(key, [...(owners.get(key) ?? []), `${group} (${file})`]);
            }
        }
    }
    return owners;
}

describe("tool registry namespace", () => {
    it("parses the group literals it is meant to be checking", () => {
        // Guards the parser itself: a regex that silently stops matching would
        // make every assertion below vacuously true.
        const owners = everyGroupKey();
        expect(owners.size).toBeGreaterThan(300);
        expect(owners.get("delegate_task")).toEqual(["DELEGATION_TOOLS (delegation.ts)"]);
    });

    it("registers no tool name from more than one group", () => {
        const collisions = [...everyGroupKey().entries()]
            .filter(([, owners]) => owners.length > 1)
            .map(([name, owners]) => `${name} <- ${owners.join(" AND ")}`);

        expect(collisions).toEqual([]);
    });

    it("declares no tool whose name is also a registry alias", () => {
        // normalizeToolName resolves TOOL_ALIASES before it checks the registry,
        // so a tool sharing a name with an alias can never be dispatched.
        const registrySource = readFileSync(
            join(CAPABILITIES_DIR, "..", "tool-registry.service.ts"),
            "utf8",
        );
        const aliasBlock = /export const TOOL_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(registrySource);
        expect(aliasBlock, "TOOL_ALIASES literal not found").not.toBeNull();

        const aliases = new Set(
            [...aliasBlock![1].matchAll(/^\s*["']([a-z0-9_]+)["']\s*:/gm)].map((m) => m[1]),
        );
        expect(aliases.size).toBeGreaterThan(10);

        // `search_documents` and `search_knowledge_base` were both defined here
        // and both aliased to `search_unified_knowledge`, so neither could ever
        // be dispatched. The definitions were removed rather than the aliases:
        // unified search is the superset, and it takes filter_source to cover
        // the narrower cases.
        const shadowed = [...everyGroupKey().keys()].filter((name) => aliases.has(name));
        expect(shadowed).toEqual([]);
    });
});

/**
 * The MCP server has the same flat-namespace problem in its own layer: each
 * `server/mcp/tools/*.ts` exports a `*ToolDefinitions` array, and index.ts
 * spreads them into one advertised list. `delegate_task` was declared in both
 * delegate.ts and pipelines.ts — the pipelines copy was served and validated,
 * the delegate copy was only ever read by the documentation generator, so the
 * published docs described a tool the server did not advertise.
 */
describe("mcp tool namespace", () => {
    const MCP_TOOLS_DIR = join(CAPABILITIES_DIR, "..", "..", "..", "..", "mcp", "tools");

    function advertisedNames(): Map<string, string[]> {
        const owners = new Map<string, string[]>();
        const files = readdirSync(MCP_TOOLS_DIR).filter(
            (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
        );
        for (const file of files) {
            const source = readFileSync(join(MCP_TOOLS_DIR, file), "utf8");
            for (const m of source.matchAll(/^\s*name:\s*["']([a-z0-9_]+)["']\s*,/gm)) {
                owners.set(m[1], [...(owners.get(m[1]) ?? []), file]);
            }
        }
        return owners;
    }

    it("parses the MCP tool files", () => {
        expect(advertisedNames().size).toBeGreaterThan(50);
    });

    it("declares no MCP tool name in more than one file", () => {
        const duplicates = [...advertisedNames().entries()]
            .filter(([, files]) => new Set(files).size > 1)
            .map(([name, files]) => `${name} <- ${[...new Set(files)].join(" AND ")}`);

        expect(duplicates).toEqual([]);
    });
});
