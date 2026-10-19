import { describe, expect, it } from "vitest";
import { crewToolsService } from "../crew-tools.service.js";
import { AGENTMAIL_TOOLS } from "@domain/tools/v1/capabilities/agentmail.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

describe("CREW AgentMail Integration", () => {
    it("resolves send_agentmail and send_email for agent cards", async () => {
        const mockCard: AgentCardRecord = {
            id: 114,
            organizationId: 342,
            name: "Sales Outreach Representative",
            description: "Sales specialist",
            personaType: "general",
            modelBindingProviderId: null,
            modelBindingModelId: null,
            capabilities: ["outreach"],
            tools: ["slack_post_message"],
            topicAffinities: ["General"],
            topicLabelAffinities: [],
            intentAffinities: ["Chat"],
            enabled: true,
            isDefault: false,
            oceanTraits: { o: 0.8, c: 0.7, e: 0.8, a: 0.8, n: 0.2 },
            soulArchetype: "Creative Catalyst",
            legend: "Sales lead",
            approvalBoundary: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const resolved = await crewToolsService.resolveForCard(mockCard);
        const resolvedNames = resolved.map((r) => r.definition.name);

        expect(resolvedNames).toContain("send_agentmail");
        expect(resolvedNames).toContain("send_email");
        expect(resolvedNames).toContain("reply_agentmail");
    });

    it("parses single string to and body alias properly in send_agentmail", async () => {
        const parsed = AGENTMAIL_TOOLS.send_agentmail.parameters.safeParse({
            to: "owner@example.com",
            subject: "Welcome to Oddjob",
            body: "Hello Jann, welcome to the platform!",
        });

        expect(parsed.success).toBe(true);
    });
});
