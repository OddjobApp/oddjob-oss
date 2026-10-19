import { describe, expect, it } from "vitest";
import { crewPersonaService } from "../crew-persona.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

/**
 * buildSystemPrompt runs on the first speaker of every round, so anything that
 * throws here takes the entire room down — every session, regardless of what
 * was typed. That is exactly what happened: a commit deleted the
 * `const canAssemble = …` declaration while editing the line beneath it, and
 * `POST /api/crew/message` 500'd with `ReferenceError: canAssemble is not
 * defined` for every message until it was restored.
 *
 * These tests exercise the guard variables across the tool combinations that
 * switch each conditional block on and off, so a missing declaration fails here
 * instead of in production.
 */

const card = (over: Partial<AgentCardRecord> = {}): AgentCardRecord =>
    ({
        id: 1,
        organizationId: 1,
        name: "Copilot",
        description: "Lead directive",
        soulArchetype: null,
        oceanTraits: null,
        legend: null,
        tools: [],
        ...over,
    }) as unknown as AgentCardRecord;

const ALL_GUARDED_TOOLS = [
    "render_app_surface",
    "mount_builder_pod",
    "propose_cycle_draft",
    "propose_app_draft",
    "propose_mission",
    "propose_assembly_deployment",
    "search_unified_knowledge",
    "discover_capabilities",
    "get_document_template",
    "h3_hexagonal_spatial_evaluate",
    "render_chart",
    "render_table",
    "generate_presentation_deck",
    "generate_pdf",
];

describe("CrewPersonaService.buildSystemPrompt", () => {
    it("builds without throwing when no tools are granted", () => {
        expect(() => crewPersonaService.buildSystemPrompt(card(), [], "", null, [])).not.toThrow();
    });

    it("builds without throwing when every guarded tool is granted", () => {
        expect(() =>
            crewPersonaService.buildSystemPrompt(card(), [], "", "finance", ALL_GUARDED_TOOLS),
        ).not.toThrow();
    });

    // One tool at a time: a conditional block whose guard is undefined only
    // throws once something reaches it, so each branch is entered on its own.
    it.each(ALL_GUARDED_TOOLS)("builds without throwing when only %s is granted", (tool) => {
        expect(() => crewPersonaService.buildSystemPrompt(card(), [], "", null, [tool])).not.toThrow();
    });

    it("instructs the room to assemble when it holds mount_builder_pod", () => {
        const prompt = crewPersonaService.buildSystemPrompt(card(), [], "", null, ["mount_builder_pod"]);
        expect(prompt).toContain("mount_builder_pod with PRE-POPULATED props");
        expect(prompt).toContain("belong to Form Studio (mount_form_studio)");
        expect(prompt).not.toContain("FullStackAssemblyPod");
    });

    it("omits the assembly instruction when mount_builder_pod is withheld", () => {
        const prompt = crewPersonaService.buildSystemPrompt(card(), [], "", null, ["render_chart"]);
        expect(prompt).not.toContain("mount_builder_pod with PRE-POPULATED props");
    });

    it("routes deploy requests to propose_assembly_deployment when it is granted", () => {
        const prompt = crewPersonaService.buildSystemPrompt(card(), [], "", null, [
            "mount_builder_pod",
            "propose_assembly_deployment",
        ]);
        expect(prompt).toContain("propose_assembly_deployment");
        // The point of the line: shipping must not collapse back into
        // re-mounting the pod that only described the app.
        expect(prompt).toContain("never re-mount a pod in place of proposing the deployment");
    });

    it("does not mention the deployment tool when it is withheld", () => {
        const prompt = crewPersonaService.buildSystemPrompt(card(), [], "", null, ["mount_builder_pod"]);
        expect(prompt).not.toContain("propose_assembly_deployment");
    });

    it("assigns Security & Compliance SME domain to security auditor agents", () => {
        const secCard = card({ name: "Security Auditor", description: "Performs security audits and compliance reviews" });
        const prompt = crewPersonaService.buildSystemPrompt(secCard, [], "", null, []);
        expect(prompt).toContain("Security, Governance & Sandbox Compliance");
        expect(prompt).toContain("secure-code-sandbox-and-python-runtime");
        expect(prompt).toContain("SME Execution Principles");
    });

    it("assigns Growth & Marketing SME domain to marketing agents", () => {
        const mktCard = card({ name: "Growth Marketer", description: "Leads growth campaigns and ad creative optimization" });
        const prompt = crewPersonaService.buildSystemPrompt(mktCard, [], "", null, []);
        expect(prompt).toContain("Growth Operations, AI Advertising & Email Lifecycle");
        expect(prompt).toContain("ai-marketing-and-ad-campaign-orchestration");
    });

    it("assigns DevOps & Reliability SME domain to SRE / Chaos agents", () => {
        const sreCard = card({ name: "Site Reliability Engineer", description: "Handles incident triage and chaos experiments" });
        const prompt = crewPersonaService.buildSystemPrompt(sreCard, [], "", null, []);
        expect(prompt).toContain("DevOps, SRE & Incident Recovery");
        expect(prompt).toContain("agent-error-recovery");
    });

    it("gates render_intake_form and BMI calculator instructions behind granted tool", () => {
        const withIntake = crewPersonaService.buildSystemPrompt(card(), [], "", null, ["render_intake_form"]);
        expect(withIntake).toContain("FORMS & CALCULATORS");
        expect(withIntake).toContain("BMI Calculator");

        const withoutIntake = crewPersonaService.buildSystemPrompt(card(), [], "", null, ["search_unified_knowledge"]);
        expect(withoutIntake).not.toContain("FORMS & CALCULATORS");
        expect(withoutIntake).not.toContain("BMI Calculator");
    });
});


