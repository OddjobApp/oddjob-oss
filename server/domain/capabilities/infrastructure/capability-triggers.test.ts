import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";
import {
    toolDefinitionToManifest,
    syncToolsToCapabilities,
    onDocChanged,
} from "./capability-triggers.js";

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
        name: "search_knowledge_base",
        label: "Search Knowledge Base",
        group: "Data Operations",
        description: "Search the knowledge base for relevant documents.",
        parameters: z.object({ query: z.string(), limit: z.number().optional() }),
        execute: async () => "ok",
        ...(overrides as any),
    } as ToolDefinition;
}

describe("toolDefinitionToManifest", () => {
    it("maps a tool to a validated manifest with inputs derived from the zod schema", () => {
        const manifest = toolDefinitionToManifest("search_knowledge_base", makeTool());
        expect(manifest).not.toBeNull();
        expect(manifest!.capability_id).toBe("search_knowledge_base");
        expect(manifest!.metadata.display_name).toBe("Search Knowledge Base");
        expect(manifest!.metadata.category).toBe("Data Operations");
        expect(manifest!.technical_spec.inputs).toEqual({ query: "string", limit: "number" });
        expect(manifest!.metadata.owner).toBe("platform");
    });

    it("slugifies a messy tool name", () => {
        const manifest = toolDefinitionToManifest("Weird Tool-Name!!", makeTool({ name: "Weird Tool-Name!!" }));
        expect(manifest!.capability_id).toBe("weird_tool_name");
    });

    it("preserves a real tool group as the capability category", () => {
        const manifest = toolDefinitionToManifest("forge_trigger", makeTool({ name: "forge_trigger", group: "App Forge" as any }));
        expect(manifest!.metadata.category).toBe("App Forge");
    });

    it("falls back to System Utilities for an unknown group", () => {
        const manifest = toolDefinitionToManifest("x_tool", makeTool({ group: "Nonexistent Group" as any }));
        expect(manifest!.metadata.category).toBe("System Utilities");
    });

    it("returns null when the name cannot form a slug", () => {
        expect(toolDefinitionToManifest("!!!", makeTool({ name: "!!!" }))).toBeNull();
    });
});

describe("syncToolsToCapabilities", () => {
    it("enqueues a code-to-docs job per valid tool and skips unmappable ones", async () => {
        const enqueue = vi.fn(async (_orgId: number, _manifest: CapabilityManifest) => ({ id: "job" }));
        const tools: Record<string, ToolDefinition> = {
            search_knowledge_base: makeTool(),
            "!!!": makeTool({ name: "!!!" }),
        };

        const count = await syncToolsToCapabilities(42, { tools, enqueue });

        expect(count).toBe(1);
        expect(enqueue).toHaveBeenCalledOnce();
        const [orgId, manifest] = enqueue.mock.calls[0]!;
        expect(orgId).toBe(42);
        expect((manifest as CapabilityManifest).capability_id).toBe("search_knowledge_base");
    });
});

describe("onDocChanged", () => {
    it("enqueues docs→code for a .md file", async () => {
        const enqueue = vi.fn(async () => ({ id: "job" }));
        await onDocChanged(7, "/repo/docs/capabilities/x.md", enqueue);
        expect(enqueue).toHaveBeenCalledWith(7, "/repo/docs/capabilities/x.md");
    });

    it("ignores non-Markdown files", async () => {
        const enqueue = vi.fn(async () => ({ id: "job" }));
        await onDocChanged(7, "/repo/docs/capabilities/notes.txt", enqueue);
        expect(enqueue).not.toHaveBeenCalled();
    });
});

describe("toolDefinitionToManifest risk and guardrails", () => {
    // Both fields were hardcoded — "Low" and [] — so every page generated from
    // a tool advertised the safest possible profile regardless of what the tool
    // did, including the ones that fetch caller-supplied URLs.
    it("carries riskLevel through to the manifest risk profile", () => {
        const cases: Array<[ToolDefinition["riskLevel"], string]> = [
            ["low", "Low"],
            ["medium", "Medium"],
            ["high", "High"],
        ];

        for (const [riskLevel, expected] of cases) {
            const manifest = toolDefinitionToManifest("t", makeTool({ riskLevel }));
            expect(manifest!.runtime_context.risk_profile).toBe(expected);
        }
    });

    it("defaults an undeclared riskLevel to Low", () => {
        const manifest = toolDefinitionToManifest("t", makeTool());
        expect(manifest!.runtime_context.risk_profile).toBe("Low");
    });

    it("does not emit a risk profile the manifest schema rejects", () => {
        // A lowercase value would fail safeParseCapabilityManifest and drop the
        // whole tool from the sync, silently.
        const manifest = toolDefinitionToManifest("t", makeTool({ riskLevel: "high" }));
        expect(manifest).not.toBeNull();
        expect(manifest!.runtime_context.risk_profile).toBe("High");
    });

    it("carries declared guardrails into documentation_meta", () => {
        const guardrails = [
            "Every redirect hop is validated by EgressFirewall.",
            "Honours AGENT_EGRESS_WHITELIST when configured.",
        ];
        const manifest = toolDefinitionToManifest("t", makeTool({ guardrails } as Partial<ToolDefinition>));
        expect(manifest!.documentation_meta.guardrails).toEqual(guardrails);
    });

    it("falls back to an empty guardrail list when none are declared or the field is malformed", () => {
        expect(toolDefinitionToManifest("t", makeTool())!.documentation_meta.guardrails).toEqual([]);
        expect(
            toolDefinitionToManifest("t", makeTool({ guardrails: "not a list" } as any))!
                .documentation_meta.guardrails
        ).toEqual([]);
    });
});

describe("egress tools declare their guardrails", () => {
    // The three tools that fetch a caller-supplied URL are the pages a reviewer
    // reads first. Each shipped as "Risk Profile: Low / No explicit guardrails
    // declared", which reads as "unconstrained".
    it.each([
        ["http_query", () => import("@domain/tools/v1/capabilities/web.js").then((m) => m.WEB_TOOLS.http_query)],
        ["browse_web", () => import("@domain/tools/v1/capabilities/web.js").then((m) => m.WEB_TOOLS.browse_web)],
        [
            "attach_url",
            () => import("@domain/tools/v1/capabilities/attachment-tools.js").then((m) => m.ATTACHMENT_TOOLS.attach_url),
        ],
    ])("%s declares a risk level and guardrails that mention the firewall", async (name, load) => {
        const tool = (await load()) as ToolDefinition;
        expect(tool, `${name} is missing from its tool group`).toBeTruthy();

        const manifest = toolDefinitionToManifest(name, tool);
        expect(manifest!.runtime_context.risk_profile).not.toBe("Low");
        expect(manifest!.documentation_meta.guardrails.length).toBeGreaterThan(0);
        expect(manifest!.documentation_meta.guardrails.join(" ")).toMatch(/EgressFirewall/);
    });
});
