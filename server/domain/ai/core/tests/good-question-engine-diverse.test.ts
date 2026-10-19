import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GoodQuestionEngine,
  DIVERSE_TOPIC_DEFINITIONS,
  type DiverseTopicArchetype,
} from "../good-question-engine.js";
import { crewPrimersService } from "@domain/crew/core/crew-primers.service.js";

/** The glob the packaged registry resolves podComponent names against. */
const PACKAGED_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../core/ui/components/packaged",
);

describe("GoodQuestionEngine DIVERSE Prompt & Intake Elicitation", () => {
  it("defines the foundational Topic Archetypes", () => {
    const archetypes = Object.keys(DIVERSE_TOPIC_DEFINITIONS) as DiverseTopicArchetype[];
    expect(archetypes).toContain("build_app");
    expect(archetypes).toContain("research_topic");
    expect(archetypes).toContain("analytical_report");
    expect(archetypes).toContain("governance_audit");
    expect(archetypes).toContain("incident_remediation");
  });

  /**
   * The bug this pins: every definition shipped without `podComponent`, and the
   * crew room replaces its own playbook list with this payload. Each card
   * therefore resolved `getLazyPackagedComponent(undefined)` and mounted
   * "Component isn't available to render." — the whole Goal Playbook grid was
   * dead while looking entirely healthy.
   *
   * The old assertions passed throughout, because none of them looked at the
   * field the room actually mounts.
   */
  it("gives every archetype a podComponent that resolves to a real packaged block", () => {
    const defs = Object.values(DIVERSE_TOPIC_DEFINITIONS);
    expect(defs.length).toBeGreaterThan(0);

    for (const def of defs) {
      expect(def.podComponent, `${def.id} has no podComponent`).toBeTruthy();
      expect(
        existsSync(resolve(PACKAGED_DIR, `${def.podComponent}.tsx`)),
        `${def.id} points at ${def.podComponent}, which is not a file in packaged/`,
      ).toBe(true);
    }
  });

  it("synthesizes a structured DIVERSE intake card with 5 dimensions", () => {
    const card = GoodQuestionEngine.synthesizeDIVERSEIntakeCard("build_app");
    expect(card.headline).toContain("Build an App");
    expect(card.formAgentPayload.type).toBe("assistant_form");
    expect(card.formAgentPayload.fields).toHaveLength(5);

    const fieldIds = card.formAgentPayload.fields.map((f: any) => f.id);
    expect(fieldIds).toContain("intent");
    expect(fieldIds).toContain("variables");
    expect(fieldIds).toContain("expectations");
    expect(fieldIds).toContain("scope");
    expect(fieldIds).toContain("evaluation");
  });

  it("formats a DIVERSE FormAgent submission into a compiled mission brief", () => {
    const brief = GoodQuestionEngine.formatDIVERSEPrompt("build_app", {
      intent: "Build an automated incident response cycle",
      variables: "webhook payload, Slack API token, SOC2 policy",
      expectations: "Creation Studio Interactive Blueprint",
      scope: "Staging Environment (Simulated Execution)",
      evaluation: "High Governance (Mandatory Human-In-The-Loop Signoff)",
    });

    expect(brief).toContain("[DIVERSE MISSION BRIEF: BUILD AN APP / WORKFLOW]");
    expect(brief).toContain("• Direction (D):");
    expect(brief).toContain("• Intent (I): Build an automated incident response cycle");
    expect(brief).toContain("• Variables & Inputs (V): webhook payload, Slack API token, SOC2 policy");
    expect(brief).toContain("• Expectations (E): Produce deliverable: Creation Studio Interactive Blueprint");
    expect(brief).toContain("• Resources (R): Recommended Agent Roles: Copilot, Software Architect, Lead Developer");
    expect(brief).toContain("• Scope & Blast Radius (S): Staging Environment (Simulated Execution)");
    expect(brief).toContain("• Evaluation & Governance (E): High Governance (Mandatory Human-In-The-Loop Signoff)");
  });

  it("exposes topic archetypes through crewPrimersService", () => {
    const archetypes = crewPrimersService.getTopicArchetypes();
    // The primers endpoint surfaces the 8 core playbooks for the UI grid.
    // The full DIVERSE_TOPIC_DEFINITIONS set stays intact for GQE routing.
    expect(archetypes.length).toBe(8);
    expect(archetypes.some((a) => a.id === "research_topic")).toBe(true);
    expect(archetypes.some((a) => a.id === "build_app")).toBe(true);
    // Defined but not listed, the film playbook never reached the room's grid.
    expect(archetypes.some((a) => a.id === "film_production")).toBe(true);
    expect(archetypes.some((a) => a.id === "signal_intelligence")).toBe(true);
    // What the room mounts has to survive the trip through the primers route.
    expect(archetypes.every((a) => !!a.podComponent)).toBe(true);
  });
});
