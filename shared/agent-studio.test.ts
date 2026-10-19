import { describe, expect, it } from "vitest";
import {
    agentReferenceFromMessage,
    agentStudioViewFromMessage,
    diffAgent,
    grantsOf,
    isConsequentialTool,
    needsCloseReading,
    type AgentDefinition,
} from "./agent-studio.js";

/**
 * The diff is what someone approves, so what it separates matters more than what it
 * lists: renaming an agent and letting it email customers must not read the same way.
 */

const agent = (over: Partial<AgentDefinition> = {}): AgentDefinition => ({
    name: "Inbox triage",
    description: "Reads the support inbox and drafts replies",
    personaType: "specialist",
    legend: null,
    soulArchetype: null,
    modelBindingProviderId: null,
    modelBindingModelId: null,
    tools: [],
    capabilities: ["support"],
    topicAffinities: [],
    intentAffinities: [],
    ...over,
});

describe("what a proposal says it changes", () => {
    it("reports a new agent as its fields, not as a wall of grants", () => {
        const lines = diffAgent(null, agent());
        expect(lines.filter((l) => l.kind === "edit").map((l) => l.field)).toEqual(
            expect.arrayContaining(["Name", "Description", "Persona"]),
        );
        expect(lines.find((l) => l.field === "Name")?.after).toBe("Inbox triage");
    });

    it("calls a new tool a grant, one line each, never 'tools changed'", () => {
        const lines = diffAgent(agent({ tools: ["search_knowledge_graph"] }), agent({ tools: ["search_knowledge_graph", "send_email"] }));
        const grants = grantsOf({ changes: lines });
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ kind: "grant", field: "Tools", after: "send_email" });
    });

    it("marks a tool that reaches outside the platform, so the card can say so", () => {
        const lines = diffAgent(agent(), agent({ tools: ["send_email"] }));
        expect(needsCloseReading({ changes: lines })).toBe(true);

        const harmless = diffAgent(agent(), agent({ tools: ["search_knowledge_graph"] }));
        expect(needsCloseReading({ changes: harmless })).toBe(false);
    });

    it("records a tool taken away as a revoke, not as an edit", () => {
        const lines = diffAgent(agent({ tools: ["send_email"] }), agent({ tools: [] }));
        expect(lines).toContainEqual({ kind: "revoke", field: "Tools", before: "send_email" });
    });

    it("says nothing changed when nothing changed", () => {
        expect(diffAgent(agent(), agent())).toEqual([]);
    });

    it("knows which tools act on the world", () => {
        for (const tool of ["send_email", "slack_post_message", "deploy_app", "delete_dataset", "computer_use_task"]) {
            expect(isConsequentialTool(tool)).toBe(true);
        }
        for (const tool of ["search_knowledge_graph", "query_dataset", "summarize_text"]) {
            expect(isConsequentialTool(tool)).toBe(false);
        }
    });

    it("shows every field apply() can write, not only the interesting ones", () => {
        const lines = diffAgent(
            agent({ enabled: true, modelBindingProviderId: 1, oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 } }),
            agent({ enabled: false, modelBindingProviderId: 2, oceanTraits: { o: 0.9, c: 0.5, e: 0.5, a: 0.5, n: 0.5 } }),
        );
        expect(lines).toContainEqual({ kind: "edit", field: "State", before: "Active", after: "Switched off" });
        expect(lines).toContainEqual({ kind: "edit", field: "Provider", before: "1", after: "2" });
        expect(lines.find((l) => l.field === "Temperament")?.after).toContain("O 0.9");
    });
});

describe("what a mount request refers to", () => {
    it.each([
        ["Open Agent Studio for Support", "Support"],
        ["open the agent Smith", "Smith"],
        ["agent studio for The Warden", "The Warden"],
    ])("reads %s as naming %s", (message, reference) => {
        expect(agentReferenceFromMessage(message)).toBe(reference);
    });

    it.each([
        "agent studio",
        "Open Agent Studio",
        "Please show bot builder",
        "open the agent",
        "Open Agent Studio on the reach tab",
    ])("reads %s as a bare gesture", (message) => {
        expect(agentReferenceFromMessage(message)).toBeNull();
    });

    it("picks up the tab a mount request names, and nothing else", () => {
        expect(agentStudioViewFromMessage("open agent studio on the reach tab")).toBe("reach");
        expect(agentStudioViewFromMessage("open agent studio")).toBeNull();
        expect(agentStudioViewFromMessage("try to open agent studio")).toBeNull();
    });
});
