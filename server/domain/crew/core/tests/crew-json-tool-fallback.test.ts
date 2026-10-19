import { describe, expect, it } from "vitest";
import { extractMarkdownJsonToolCalls } from "../crew-turn-generation.js";
import { crewPersonaService } from "../crew-persona.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

describe("CREW Markdown JSON Tool Fallback & Signature Enforcement", () => {
    it("extracts markdown JSON tool calls and cleans content", () => {
        const rawContent = `I will send this email now.\n\n\`\`\`json\n{\n    "name": "render_intake_form",\n    "arguments": {\n        "title": "Verify Agent Functionality",\n        "fields": [\n            {\n                "key": "email",\n                "label": "Email Address",\n                "type": "text",\n                "defaultValue": "Owner@Example.com"\n            }\n        ]\n    }\n}\n\`\`\``;

        const available = new Set(["render_intake_form", "propose_task_run", "google_search"]);
        const result = extractMarkdownJsonToolCalls(rawContent, available);

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("render_intake_form");
        expect(result.toolCalls[0].args).toEqual({
            title: "Verify Agent Functionality",
            fields: [
                {
                    key: "email",
                    label: "Email Address",
                    type: "text",
                    defaultValue: "Owner@Example.com",
                },
            ],
        });
        expect(result.cleanedContent).toBe("I will send this email now.");
    });

    it("ignores markdown blocks that do not match available tools", () => {
        const rawContent = `Here is some sample code:\n\`\`\`json\n{\n    "foo": "bar"\n}\n\`\`\``;
        const available = new Set(["render_intake_form"]);
        const result = extractMarkdownJsonToolCalls(rawContent, available);

        expect(result.toolCalls).toHaveLength(0);
        expect(result.cleanedContent).toBe(rawContent);
    });

    it("enforces agent identity signature in buildSystemPrompt", () => {
        const mockCard: AgentCardRecord = {
            id: 26,
            organizationId: 342,
            name: "Copilot",
            personaType: "copilot",
            modelBindingProviderId: null,
            modelBindingModelId: null,
            isDefault: false,
            soulArchetype: "Lead Directive",
            description: "Room facilitator and primary orchestrator.",
            capabilities: ["coordination"],
            topicAffinities: ["General"],
            topicLabelAffinities: [],
            intentAffinities: ["Code Execution"],
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            tools: ["render_intake_form"],
            oceanTraits: { o: 0.7, c: 0.8, e: 0.6, a: 0.7, n: 0.3 },
            legend: "I guide the discussion.",
            approvalBoundary: null,
        };

        const prompt = crewPersonaService.buildSystemPrompt(
            mockCard,
            [],
            "",
            null,
            ["render_intake_form"],
            null,
            [],
            { orgName: "Oddjob.app", userDisplayName: "admin2" },
        );

        expect(prompt).toContain("SIGNING & SENDER IDENTITY");
        expect(prompt).toContain('always sign with your actual assigned agent name ("Copilot")');
        expect(prompt).toContain('Never output literal placeholder text such as "[Your Name]"');
    });
});
