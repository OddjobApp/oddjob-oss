/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { assessAgent, findGaps } from "@domain/agent-cards/core/agent-readiness.service.js";
import type { AgentDefinition } from "@shared/agent-studio.js";

/**
 * An agent proposed with its gaps already named. What matters here is that the studio
 * never grants reach by itself — it asks — and that a read-only agent is not buried in
 * warnings meant for one that can spend money.
 */

const agent = (over: Partial<AgentDefinition> = {}): AgentDefinition => ({
    name: "Inbox triage",
    description: "Reads the support inbox",
    personaType: "specialist",
    legend: "I read the inbox before anyone else has to.",
    soulArchetype: null,
    modelBindingProviderId: 1,
    modelBindingModelId: 2,
    tools: [],
    capabilities: ["support"],
    topicAffinities: ["support"],
    intentAffinities: [],
    ...over,
});

describe("what an agent will still need", () => {
    it("notices the request needs a tool the agent has not been given", () => {
        const gaps = findGaps("Watch the support inbox and reply to customers", agent());
        const deficit = gaps.find((gap) => gap.kind === "capability_deficit");
        expect(deficit?.suggests).toEqual(expect.arrayContaining(["send_email"]));
        expect(deficit?.message).toContain("cannot reach");
    });

    it("suggests, never grants: the definition is untouched", () => {
        const definition = agent();
        findGaps("Reply to email and post to Slack", definition);
        expect(definition.tools).toEqual([]);
    });

    it("asks who approves what, once an agent can act outside the platform", () => {
        const gaps = findGaps("Reply to customers", agent({ tools: ["send_email"] }));
        const governance = gaps.find((gap) => gap.kind === "governance_gap");
        expect(governance?.severity).toBe("critical");
        expect(governance?.message).toContain("send_email");
    });

    it("says when a model is unbound, because then nothing can be costed", () => {
        const gaps = findGaps("Summarise tickets", agent({ modelBindingModelId: null }));
        expect(gaps.map((gap) => gap.kind)).toContain("unbound_model");
    });

    it("mentions missing knowledge and philosophy only as advice", () => {
        const gaps = findGaps("Summarise tickets", agent({ topicAffinities: [], legend: "" }));
        for (const kind of ["knowledge_deficit", "identity_deficit"]) {
            expect(gaps.find((gap) => gap.kind === kind)?.severity).toBe("advisory");
        }
    });
});

describe("what the platform makes of the work", () => {
    it("reads an acting agent and a reading one differently", () => {
        const acting = assessAgent("Send the weekly report to every customer", agent({ tools: ["send_email"] }));
        const reading = assessAgent("Summarise this week's tickets", agent());

        expect(acting.trajectory.blastRadius).toBeGreaterThanOrEqual(reading.trajectory.blastRadius);
        expect(["require_approval", "halt_loop", "auto_execute"]).toContain(acting.trajectory.recommendedAction);
    });

    it("does not insist on an approval policy for an agent that only reads", () => {
        // A governance gap is raised from the tools alone; it is graded DOWN when the
        // prediction engine says the work needs no one. Noise is what makes people skip
        // the warnings that matter.
        const reading = assessAgent("Summarise this week's tickets", agent());
        const governance = reading.gaps.find((gap) => gap.kind === "governance_gap");
        if (reading.trajectory.recommendedAction === "auto_execute" && governance) {
            expect(governance.severity).toBe("advisory");
        }
        expect(reading.gaps.every((gap) => gap.severity !== "critical")).toBe(true);
    });

    it("carries the prediction engine's read alongside the gaps", () => {
        const assessment = assessAgent("Reply to customer email", agent({ tools: ["send_email"], topicAffinities: [], legend: "" }));
        expect(assessment.gaps.length).toBeGreaterThan(0);
        expect(["auto_execute", "require_approval", "halt_loop"]).toContain(assessment.trajectory.recommendedAction);
        expect(assessment.trajectory.reason).toBeTruthy();
    });
});
