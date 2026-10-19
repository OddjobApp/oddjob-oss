import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DiverseIntakeCard, parseDiverseIntake } from "./DiverseIntakeCard";

afterEach(cleanup);

describe("parseDiverseIntake", () => {
  it("parses an Agent Fleet DIVERSE primitive intake message", () => {
    const message = `[DIVERSE PRIMITIVE INTAKE: CONFIGURE AGENT FLEET] • Direction (D): Roster: Pixel Maestro • Intent (I): Configured through AgenticHRPod Module Surface • Variables & Inputs (V): {"stageId":"stage-agent_roster","primaryAgentId":"agent-art-director","assignedRoster":[{"id":"agent-art-director","name":"Pixel Maestro","role":"Visual Style, Theme & Art Direction Specialist","soulArchetype":"Visionary Aesthetician","modelTier":"tier-1-frontier","capabilities":["select_design_system","synthesize_art_direction_prompts","validate_wcag_contrast"],"autonomyTier":"L2","modelProvider":"google/gemini-2.0-flash","budgetUsd":10,"maxTokens":300000}],"totalBudgetCapUsd":10,"timestamp":"2026-09-11T19:29:36.060Z","_trace":{"traceparent":"00-47694f4244c4095e419a9f7eb4c9e49c-528012218172aa55-01","generatedAt":"2026-09-11T19:29:36.060Z"}} • Expectations (E): Execute and realize configured Configure Agent Fleet artifact • Resources (R): Recommended Roles: Copilot, Team Lead, Security Lead • Scope & Blast Radius (S): Development Sandbox (Non-destructive) • Evaluation & Governance (E): High Governance (Mandatory Human-in-the-Loop Signoff) Crew Directive: Align all participants to this configured primitive. Execute domain tools to fulfill the user's setup.`;

    const parsed = parseDiverseIntake(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("primitive_intake");
    expect(parsed?.archetypeLabel).toBe("CONFIGURE AGENT FLEET");
    expect(parsed?.direction).toBe("Roster: Pixel Maestro");
    expect(parsed?.traceparent).toBe("00-47694f4244c4095e419a9f7eb4c9e49c-528012218172aa55-01");
    expect(parsed?.rawVariables?.primaryAgentId).toBe("agent-art-director");
    expect(parsed?.rawVariables?.assignedRoster).toHaveLength(1);
    expect(parsed?.rawVariables?.assignedRoster[0].name).toBe("Pixel Maestro");
  });

  it("returns null for standard conversational messages", () => {
    expect(parseDiverseIntake("Hello team!")).toBeNull();
    expect(parseDiverseIntake("Can someone review this slide?")).toBeNull();
  });
});

describe("DiverseIntakeCard", () => {
  const sampleMessage = `[DIVERSE PRIMITIVE INTAKE: CONFIGURE AGENT FLEET] • Direction (D): Roster: Pixel Maestro • Intent (I): Configured through AgenticHRPod Module Surface • Variables & Inputs (V): {"stageId":"stage-agent_roster","primaryAgentId":"agent-art-director","assignedRoster":[{"id":"agent-art-director","name":"Pixel Maestro","role":"Visual Style, Theme & Art Direction Specialist","soulArchetype":"Visionary Aesthetician","modelTier":"tier-1-frontier","capabilities":["select_design_system","synthesize_art_direction_prompts","validate_wcag_contrast"],"autonomyTier":"L2","modelProvider":"google/gemini-2.0-flash","budgetUsd":10,"maxTokens":300000}],"totalBudgetCapUsd":10,"timestamp":"2026-09-11T19:29:36.060Z","_trace":{"traceparent":"00-47694f4244c4095e419a9f7eb4c9e49c-528012218172aa55-01","generatedAt":"2026-09-11T19:29:36.060Z"}} • Expectations (E): Execute and realize configured Configure Agent Fleet artifact • Resources (R): Recommended Roles: Copilot, Team Lead, Security Lead • Scope & Blast Radius (S): Development Sandbox (Non-destructive) • Evaluation & Governance (E): High Governance (Mandatory Human-in-the-Loop Signoff)`;

  it("renders the executive roster card for Pixel Maestro", () => {
    const intake = parseDiverseIntake(sampleMessage)!;
    render(<DiverseIntakeCard intake={intake} isCurrentUser={true} />);

    expect(screen.getByTestId("diverse-intake-card")).toBeInTheDocument();
    expect(screen.getByText("Pixel Maestro")).toBeInTheDocument();
    expect(screen.getByText("Visual Style, Theme & Art Direction Specialist")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("L2 Bounded")).toBeInTheDocument();
    expect(screen.getByText("$10.00 spend cap")).toBeInTheDocument();
  });

  it("toggles the audit parameters on click", () => {
    const intake = parseDiverseIntake(sampleMessage)!;
    render(<DiverseIntakeCard intake={intake} isCurrentUser={true} />);

    const auditBtn = screen.getByRole("button", { name: "Show raw parameters" });
    expect(screen.queryByText(/"stageId"/)).not.toBeInTheDocument();

    fireEvent.click(auditBtn);
    expect(screen.getByText(/"stageId"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide raw parameters" })).toBeInTheDocument();
  });
});
