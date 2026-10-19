/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./trycua-service.js", () => ({ trycuaService: {
    getSession: vi.fn().mockResolvedValue({ id: "s", organizationId: 7, provider: "cua", os: "linux", status: "running", metadata: {} }),
    getScreenshot: vi.fn().mockResolvedValue("data:image/png;base64," + "A".repeat(10000)),
    getAccessibilityTree: vi.fn().mockResolvedValue({ available: false, source: "unavailable", nodes: [] }),
} }));
// No org connection: outside production the platform key stands in. Mocked so
// the test never reaches a database for the org lookup.
vi.mock("@domain/ai/core/org-model.service.js", () => ({ orgModelService: { resolve: vi.fn(async () => null) } }));
import { resolveGeminiApiKey, TrycuaComputerIntelligenceService } from "./computer-intelligence.service.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function key() {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
}
describe("computer vision configuration", () => {
    it("accepts GOOGLE_API_KEY as an alias", async () => {
        key();
        expect(await resolveGeminiApiKey(7)).toBe("test-key");
    });
    it("sends the screenshot to a supported model and returns usable coordinates", async () => {
        key();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ surfaceType: "browser", activeApp: { name: "Browser", confidence: 0.9 }, visibleText: ["Submit"], clickableRegions: [{ label: "Submit", x: 20, y: 30, width: 100, height: 40 }] }) }] } }] }) });
        vi.stubGlobal("fetch", fetchMock);
        const observation = await new TrycuaComputerIntelligenceService().observeSession({ sessionId: "s", organizationId: 7, userId: "user" });
        expect(fetchMock.mock.calls[0][0]).toContain("gemini-3.8-flash:generateContent");
        expect(fetchMock.mock.calls[0][0]).not.toContain("test-key");
        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("test-key");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].inlineData.data).toHaveLength(10000);
        expect(observation.ui.clickableRegions).toContainEqual(expect.objectContaining({ label: "Submit", bounds: { x: 20, y: 30, width: 100, height: 40 } }));
    });
    it("reports unavailable vision when the provider fails", async () => {
        key();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        const observation = await new TrycuaComputerIntelligenceService().observeSession({ sessionId: "s", organizationId: 7, userId: "user" });
        expect(observation.limitations).toContainEqual(expect.stringContaining("Vision analysis unavailable"));
        expect(observation.ui.clickableRegions).toEqual([]);
    });
});
