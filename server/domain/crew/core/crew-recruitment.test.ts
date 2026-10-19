import { describe, expect, it } from "vitest";
import { agentRelevanceScore } from "./crew-orchestrator.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

const card = (over: Partial<AgentCardRecord>) =>
    ({ name: "", description: "", capabilities: [], ...over }) as AgentCardRecord;

describe("agentRelevanceScore", () => {
    it("recruits nobody for a question no agent is about", () => {
        // The regression this exists for: an "action_item_template Form Agent"
        // was pulled in to debate LLM rate limits, because affinity was the only
        // signal and every card declares the same handful of intents.
        const formAgent = card({
            name: "action_item_template Form Agent",
            description: "Form agent based on action_item_template template",
            capabilities: ["general assistance"],
        });

        expect(
            agentRelevanceScore(
                "We keep hitting rate limits on our LLM provider. Should we adopt a local " +
                    "small language model for triage, or fix our quota handling?",
                formAgent,
            ),
        ).toBe(0);
    });

    it("finds the researcher for a research question", () => {
        const researcher = card({
            name: "AI Literature Researcher",
            description: "A specialized mock agent for testing.",
            capabilities: ["search web"],
        });
        expect(
            agentRelevanceScore("Can you research the latest literature on RAG?", researcher),
        ).toBeGreaterThan(0);
    });

    it("weights a name match above a capability match above a description match", () => {
        const byName = card({ name: "Backlog Coordinator", capabilities: [], description: "" });
        const byCapability = card({ name: "Zeta", capabilities: ["backlog grooming"], description: "" });
        const byDescription = card({ name: "Zeta", capabilities: [], description: "Handles backlog work" });

        const q = "our backlog is a mess";
        expect(agentRelevanceScore(q, byName)).toBeGreaterThan(agentRelevanceScore(q, byCapability));
        expect(agentRelevanceScore(q, byCapability)).toBeGreaterThan(
            agentRelevanceScore(q, byDescription),
        );
    });

    it("counts each matching term once, at its best weight", () => {
        // A card repeating a word everywhere should not out-rank a genuinely
        // broader match.
        const repeated = card({
            name: "Backlog Backlog", capabilities: ["backlog"], description: "backlog backlog",
        });
        const broader = card({
            name: "Backlog Sprint Coordinator", capabilities: [], description: "",
        });
        expect(agentRelevanceScore("backlog sprint", broader)).toBeGreaterThan(
            agentRelevanceScore("backlog sprint", repeated),
        );
    });

    it("ignores words too common to indicate relevance", () => {
        // "agent" and "ai" appear in almost every card name in this system, so
        // matching on them would make everything relevant to everything.
        const generic = card({ name: "AI Agent", description: "AI Agent: generic" });
        expect(agentRelevanceScore("what should our ai agent do about this", generic)).toBe(0);
    });

    it("matches a plural in the question to a singular in the card", () => {
        const queues = card({ name: "Queue Manager", capabilities: [] });
        expect(agentRelevanceScore("do we need request queues", queues)).toBeGreaterThan(0);
    });

    it("scores zero for an empty question rather than matching everything", () => {
        expect(agentRelevanceScore("", card({ name: "Anything" }))).toBe(0);
        expect(agentRelevanceScore("the and for our", card({ name: "Anything" }))).toBe(0);
    });

    it("tolerates a card with no description or capabilities", () => {
        expect(agentRelevanceScore("backlog", card({ name: "Backlog Bot" }))).toBeGreaterThan(0);
    });
});
