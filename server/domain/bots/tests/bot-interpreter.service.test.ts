/**
 * Tests for BotInterpreterService
 *
 * These tests rely ONLY on the keyword-match fallback path (no API key needed)
 * and on schema validation of the structured output format.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotInterpreterService, type BotBlueprint } from "../core/bot-interpreter.service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInterpreter(hasApiKey = false) {
    if (!hasApiKey) {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("GOOGLE_API_KEY", "");
    }
    return new BotInterpreterService();
}

// ── Keyword-match (fallback) path ────────────────────────────────────────────

describe("BotInterpreterService – keyword-match fallback", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("GOOGLE_API_KEY", "");
    });

    it("extracts jira + slack integrations", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Monitor my Jira board daily and post a Slack summary");
        expect(bp.integrations).toContain("jira");
        expect(bp.integrations).toContain("slack");
    });

    it("detects daily schedule → cron 0 9 * * *", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Send a daily report to slack");
        expect(bp.schedule).toBe("0 9 * * *");
    });

    it("detects hourly schedule", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Run a check every hour and update the dashboard");
        expect(bp.schedule).toBe("0 * * * *");
    });

    it("returns null schedule for conversational prompt", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Answer questions about our product documentation");
        expect(bp.schedule).toBeNull();
    });

    it("assigns analyst persona for summarize/report keywords", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Summarize and analyze my team metrics");
        expect(bp.persona).toBe("analyst");
    });

    it("assigns coder persona for code/debug keywords", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Debug my Node.js code and run tests");
        expect(bp.persona).toBe("coder");
    });

    it("marks result as NOT AI-generated", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Some prompt");
        expect(bp.isAiGenerated).toBe(false);
    });

    it("produces a name with max 80 chars", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("A very long and descriptive prompt about doing many things to many systems");
        expect(bp.name.length).toBeLessThanOrEqual(80);
    });

    it("description is at most 200 chars", async () => {
        const long = "x".repeat(500);
        const svc = makeInterpreter(false);
        const bp = await svc.interpret(long);
        expect(bp.description.length).toBeLessThanOrEqual(200);
    });

    it("always produces at least one capability", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Do stuff");
        expect(bp.capabilities.length).toBeGreaterThanOrEqual(1);
    });

    it("detects github integration", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Review pull requests on Github and comment");
        expect(bp.integrations).toContain("github");
    });

    it("detects gmail integration", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Send an email report via Gmail every week");
        expect(bp.integrations).toContain("gmail");
    });
});

// ── Blueprint schema validation ───────────────────────────────────────────────

describe("BotBlueprint shape invariants", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("GOOGLE_API_KEY", "");
    });

    it("all required fields are present", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("Test prompt");
        const keys: (keyof BotBlueprint)[] = [
            "name", "description", "persona", "schedule",
            "integrations", "capabilities", "isAiGenerated",
        ];
        for (const k of keys) {
            expect(bp).toHaveProperty(k);
        }
    });

    it("integrations is an array (possibly empty)", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("An assistant that chats");
        expect(Array.isArray(bp.integrations)).toBe(true);
    });

    it("capabilities is a non-empty array", async () => {
        const svc = makeInterpreter(false);
        const bp = await svc.interpret("An assistant");
        expect(Array.isArray(bp.capabilities)).toBe(true);
        expect(bp.capabilities.length).toBeGreaterThan(0);
    });
});

// ── LLM path (mocked) ────────────────────────────────────────────────────────

// vi.mock is hoisted to the top of the file, so two of them inside separate tests
// both registered against the same module and the last one - the rejecting one -
// answered every test. One mock, steered per test.
const generateStructured = vi.hoisted(() => vi.fn());
vi.mock("@server/domain/ai/core/llm-client.js", () => ({
    LLMClient: class {
        generateStructured = generateStructured;
    },
}));

describe("BotInterpreterService – LLM path (mocked client)", () => {
    it("marks result as AI-generated when LLM succeeds", async () => {
        vi.unstubAllEnvs();
        vi.stubEnv("GEMINI_API_KEY", "fake-key");

        const mockBlueprint = {
            name: "Jira Summary Bot",
            description: "Monitors Jira and posts daily Slack summaries.",
            persona: "analyst",
            schedule: "0 9 * * 1-5",
            integrations: ["jira", "slack"],
            capabilities: ["jira-integration", "slack-notification", "scheduled-task"],
        };

        generateStructured.mockResolvedValue(mockBlueprint);

        const { BotInterpreterService: SVC } = await import("../core/bot-interpreter.service.js");
        const svc = new SVC();
        const bp = await svc.interpret("Monitor my Jira board daily and post to Slack");

        expect(bp.isAiGenerated).toBe(true);
        expect(bp.name).toBe("Jira Summary Bot");
        expect(bp.schedule).toBe("0 9 * * 1-5");

        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it("falls back to keyword match when LLM throws", async () => {
        vi.unstubAllEnvs();
        vi.stubEnv("GEMINI_API_KEY", "fake-key");

        generateStructured.mockRejectedValue(new Error("LLM timeout"));

        const { BotInterpreterService: SVC2 } = await import("../core/bot-interpreter.service.js");
        const svc = new SVC2();
        const bp = await svc.interpret("Check Github daily");

        expect(bp.isAiGenerated).toBe(false);
        expect(bp.integrations).toContain("github");

        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
});
