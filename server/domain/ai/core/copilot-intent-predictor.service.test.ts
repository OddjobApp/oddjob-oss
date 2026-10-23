import { describe, expect, it } from "vitest";
import { copilotIntentPredictor } from "./copilot-intent-predictor.service.js";

describe("CopilotIntentPredictorService", () => {
  it("fast-paths daily brief queries deterministically", () => {
    const briefQueries = [
      "daily brief",
      "Daily Brief",
      "daily briefing",
      "morning brief",
      "status brief",
      "give me a daily brief",
      "run daily brief",
    ];

    for (const query of briefQueries) {
      const result = copilotIntentPredictor.predictIntent(query);
      expect(result.intent).toBe("daily_brief");
      expect(result.confidence).toBe(1.0);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it("invokes Good Question Engine (GQE) when user query is ambiguous or underspecified", () => {
    const ambiguousQueries = ["fix it", "check it", "run", "help", "update"];

    for (const query of ambiguousQueries) {
      const result = copilotIntentPredictor.predictIntent(query, {
        page: "data_workbench",
        currentUrl: "/data/workbench",
      });

      expect(result.intent).toBe("clarification_needed");
      expect(result.confidence).toBeLessThan(0.75);
      expect(result.clarification).toBeDefined();
      expect(result.clarification?.headline).toContain("data_workbench");
      expect(result.clarification?.options.length).toBeGreaterThanOrEqual(2);
      expect(result.clarification?.options[0].prompt).toBeDefined();
    }
  });

  it("leaves short replies and names to the conversation instead of asking which action was meant", () => {
    const replies = ["yes", "Yes", "no", "ok", "thanks", "hi", "hello there", "42", "form studio", "Pulse survey", "sure"];

    for (const reply of replies) {
      const result = copilotIntentPredictor.predictIntent(reply, { page: "dashboard", currentUrl: "/dashboard" });
      expect(result.intent, reply).not.toBe("clarification_needed");
      expect(result.clarification, reply).toBeUndefined();
    }
  });

  it("classifies high-risk action verbs as actionable and requires confirmation", () => {
    const result = copilotIntentPredictor.predictIntent("restart production database cluster", {
      currentUrl: "/admin/infrastructure/production",
      page: "infrastructure_production",
    });

    expect(result.intent).toBe("actionable");
    expect(result.suggestedMode).toBe("execute");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.actionPreview).toBeDefined();
    expect(result.actionPreview?.risk).toBe("high");
    expect(result.actionPreview?.requiresApproval).toBe(true);
  });

  it("identifies diagnostic and audit queries accurately", () => {
    const diagnosticQueries = [
      "audit current security policies",
      "why did job 108 fail",
      "investigate bottleneck in ingestion pipeline",
      "find root cause of latency anomaly",
    ];

    for (const query of diagnosticQueries) {
      const result = copilotIntentPredictor.predictIntent(query);
      expect(result.intent).toBe("diagnostic");
      expect(result.suggestedMode).toBe("audit");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it("identifies planning and architecture queries accurately", () => {
    const planningQueries = [
      "plan new workstream pipeline",
      "draft architecture roadmap for spatial engine",
      "blueprint instant app layout",
    ];

    for (const query of planningQueries) {
      const result = copilotIntentPredictor.predictIntent(query);
      expect(result.intent).toBe("planning");
      expect(result.suggestedMode).toBe("plan");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it("falls back to informational intent for descriptive or exploratory queries", () => {
    const infoQueries = [
      "what is the Eulerian hexagonal spatial index?",
      "how does the intervention engine route approvals?",
      "explain the current blackboard structure",
    ];

    for (const query of infoQueries) {
      const result = copilotIntentPredictor.predictIntent(query);
      expect(result.intent).toBe("informational");
      expect(result.suggestedMode).toBe("explain");
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
      expect(result.requiresConfirmation).toBe(false);
    }
  });
});
