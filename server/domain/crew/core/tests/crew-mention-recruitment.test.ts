import { describe, expect, it, vi, beforeEach } from "vitest";
import { crewPersonaService } from "../crew-persona.service.js";
import { crewOrchestratorService } from "../crew-orchestrator.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

describe("CREW Mention Recruitment & Context Resolution", () => {
    const mockCard: AgentCardRecord = {
        id: 114,
        organizationId: 342,
        name: "Sales Outreach Representative",
        personaType: "general",
        modelBindingProviderId: null,
        modelBindingModelId: null,
        isDefault: false,
        soulArchetype: "Creative Catalyst",
        description: "Executes targeted outreach, manages sales pipelines, and optimizes deliverability.",
        capabilities: ["email_outreach", "pipeline_management"],
        topicAffinities: ["General"],
        topicLabelAffinities: [],
        intentAffinities: ["Chat", "Analysis"],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        tools: ["render_intake_form", "request_human_input"],
        oceanTraits: { o: 0.8, c: 0.7, e: 0.8, a: 0.8, n: 0.2 },
        legend: "I specialize in personalized outreach.",
        approvalBoundary: null,
    };

    it("injects organization name, user identity, and zero-placeholder rule into system prompt", () => {
        const prompt = crewPersonaService.buildSystemPrompt(
            mockCard,
            [{ name: "Copilot", description: "Lead Directive" }],
            "Prior warmups were successful.",
            "sales-pipeline",
            ["render_intake_form", "request_human_input"],
            "Copilot",
            [],
            { orgName: "Acme Global", userDisplayName: "Super Admin" },
        );

        expect(prompt).toContain("Organization / Company Name: **Acme Global**");
        expect(prompt).toContain("Requesting User / Host: **Super Admin**");
        expect(prompt).toContain("NO UNFILLED PLACEHOLDERS");
        expect(prompt).toContain("Acme Global");
        expect(prompt).toContain("Super Admin");
    });

    it("parses explicit @mentions and prioritizes matching cards", () => {
        const members: AgentCardRecord[] = [
            {
                ...mockCard,
                id: 26,
                name: "Copilot",
                personaType: "copilot",
                modelBindingProviderId: null,
                modelBindingModelId: null,
                isDefault: false,
            },
            mockCard,
        ];

        const message = "@Sales Outreach Representative Can you draft the intro email?";
        const mentioned = crewOrchestratorService.parseMentions(message, members);

        expect(mentioned).toHaveLength(1);
        expect(mentioned[0].name).toBe("Sales Outreach Representative");

        const speakers = crewOrchestratorService.selectSpeakers(members, "Sales", "Create", message);
        expect(speakers[0].name).toBe("Sales Outreach Representative");
    });
});
