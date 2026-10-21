import { describe, it, expect, vi, beforeEach } from "vitest";
import type { XRaySymbol, ImpactNode } from "@domain/xray/core/xray-intelligence.service.js";

// Mock the XRay intelligence service module
vi.mock("@domain/xray/core/xray-intelligence.service.js", () => ({
    xrayIntelligenceService: {
        findSymbols: vi.fn(),
        traceImpact: vi.fn(),
        collectFiles: vi.fn(),
    },
}));

// Mock the logger to suppress output during tests
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { contextInjectionService } from "../context-injection.service.js";
import { xrayIntelligenceService } from "@domain/xray/core/xray-intelligence.service.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeXRaySymbol(overrides: Partial<XRaySymbol> = {}): XRaySymbol {
    return {
        id: "sym-1",
        name: "createUser",
        kind: "function",
        filePath: "server/routes/users.ts",
        startLine: 10,
        endLine: 40,
        signature: "async function createUser(req, res): Promise<void>",
        ...overrides,
    };
}

function makeImpactNode(overrides: Partial<ImpactNode> = {}): ImpactNode {
    return {
        symbol: makeXRaySymbol({ id: "impact-1", name: "validateInput" }),
        reason: "Called by createUser()",
        depth: 1,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ContextInjectionService integration", () => {
    const mockFindSymbols = xrayIntelligenceService.findSymbols as ReturnType<typeof vi.fn>;
    const mockTraceImpact = xrayIntelligenceService.traceImpact as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe("mocked XRay returning symbols → structured output", () => {
        it("returns structured CODE CONTEXT prompt with injected symbols", async () => {
            // Arrange: XRay returns symbols and impact data
            const symbols: XRaySymbol[] = [
                makeXRaySymbol({ id: "s1", name: "createUser", kind: "function", filePath: "server/routes/users.ts" }),
                makeXRaySymbol({ id: "s2", name: "InsertUser", kind: "interface", filePath: "shared/schema/users.ts", signature: "export interface InsertUser { name: string; email: string; }" }),
                makeXRaySymbol({ id: "s3", name: "validateInput", kind: "function", filePath: "server/routes/users.ts", signature: "function validateInput(data: InsertUser): boolean" }),
            ];
            const impactNodes: ImpactNode[] = [
                makeImpactNode({ symbol: symbols[2], reason: "Called by createUser()", depth: 1 }),
            ];

            mockFindSymbols.mockResolvedValue(symbols);
            mockTraceImpact.mockResolvedValue(impactNodes);

            // Act
            const result = await contextInjectionService.injectContext(
                "Modify function createUser in server/routes/users.ts",
                "/workspace",
                1,
            );

            // Assert: structured output contains CODE CONTEXT header
            expect(result.prompt).toContain("CODE CONTEXT");
            expect(result.metadata.symbolsInjected).toBeGreaterThan(0);
            expect(result.metadata.fallbackActivated).toBe(false);
        });
    });

    describe("XRay timeout → fallback activated", () => {
        it("activates fallback when XRay exceeds timeout", async () => {
            // Arrange: XRay findSymbols never resolves (simulates hung service)
            mockFindSymbols.mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve([]), 10_000)),
            );

            // Act: use a short timeout so the test doesn't actually wait 5s
            const result = await contextInjectionService.injectContext(
                "Modify function createUser in server/routes/users.ts",
                "/workspace",
                1,
                { timeoutMs: 100 },
            );

            // Assert: fallback is activated with timeout info
            expect(result.metadata.fallbackActivated).toBe(true);
            expect(result.prompt).toContain("timed out");
            // It waited for the 100 ms timeout. A timer can fire a millisecond early
            // against Date.now() (CI measured 99 under coverage), so allow that much.
            expect(result.metadata.queryLatencyMs).toBeGreaterThanOrEqual(95);
        });
    });

    describe("XRay 'not indexed' → fallback note in prompt", () => {
        it("activates fallback with not-indexed note when XRay throws not indexed error", async () => {
            // Arrange: XRay throws a "not indexed" error
            mockFindSymbols.mockRejectedValue(new Error("Repository not indexed"));

            // Act
            const result = await contextInjectionService.injectContext(
                "Modify function createUser in server/routes/users.ts",
                "/workspace",
                1,
            );

            // Assert: fallback with not-indexed indication
            expect(result.metadata.fallbackActivated).toBe(true);
            expect(result.prompt).toContain("not indexed");
        });
    });

    describe("disabled flag → empty result returned immediately", () => {
        it("returns empty result immediately when disabled option is set", async () => {
            // Act: call with disabled flag
            const result = await contextInjectionService.injectContext(
                "Modify function createUser in server/routes/users.ts",
                "/workspace",
                1,
                { disabled: true },
            );

            // Assert: empty result, no XRay calls made
            expect(result.prompt).toBe("");
            expect(result.metadata.symbolsInjected).toBe(0);
            expect(result.metadata.fallbackActivated).toBe(false);
            expect(mockFindSymbols).not.toHaveBeenCalled();
            expect(mockTraceImpact).not.toHaveBeenCalled();
        });
    });

    describe("no references extracted → empty result", () => {
        it("returns empty result when plan contains no extractable references", async () => {
            // Act: call with a plan that has no file paths, no function names, nothing extractable
            const result = await contextInjectionService.injectContext(
                "Do something generic with no code references",
                "/workspace",
                1,
            );

            // Assert: empty result, no XRay queries made
            expect(result.prompt).toBe("");
            expect(result.metadata.symbolsInjected).toBe(0);
            expect(mockFindSymbols).not.toHaveBeenCalled();
        });
    });
});
