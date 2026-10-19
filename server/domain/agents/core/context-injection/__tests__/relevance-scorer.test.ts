import { describe, it, expect } from "vitest";
import { scoreSymbols } from "../relevance-scorer.js";
import type { XRaySymbol, ImpactNode } from "@domain/xray/core/xray-intelligence.service.js";
import type { ExtractedReferences } from "../types.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSymbol(overrides: Partial<XRaySymbol> = {}): XRaySymbol {
    return {
        id: "sym-1",
        name: "doSomething",
        kind: "function",
        filePath: "server/services/user.ts",
        startLine: 10,
        endLine: 30,
        signature: "function doSomething(): void",
        ...overrides,
    };
}

function makeImpactNode(overrides: Omit<Partial<ImpactNode>, "symbol"> & { symbol?: Partial<XRaySymbol> } = {}): ImpactNode {
    const { symbol: symbolOverrides, ...rest } = overrides;
    return {
        symbol: makeSymbol(symbolOverrides),
        reason: "Called by main()",
        depth: 0,
        ...rest,
    };
}

function makeReferences(overrides: Partial<ExtractedReferences> = {}): ExtractedReferences {
    return {
        filePaths: ["server/services/user.ts"],
        functionNames: ["doSomething"],
        classNames: [],
        moduleNames: [],
        typeNames: [],
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("scoreSymbols", () => {
    describe("scoring range", () => {
        it("produces scores in [0.0, 1.0] for all outputs", () => {
            const symbols: XRaySymbol[] = [
                makeSymbol({ id: "s1", name: "alpha", filePath: "server/services/user.ts" }),
                makeSymbol({ id: "s2", name: "beta", filePath: "lib/utils/format.ts" }),
                makeSymbol({ id: "s3", name: "gamma", filePath: "deep/nested/other/file.ts" }),
            ];
            const impactNodes: ImpactNode[] = [
                makeImpactNode({ symbol: { id: "s1", name: "alpha" }, depth: 0 }),
                makeImpactNode({ symbol: { id: "s2", name: "beta" }, depth: 2 }),
            ];
            const refs = makeReferences({
                filePaths: ["server/services/user.ts"],
                functionNames: ["alpha", "beta", "alpha", "alpha"],
            });

            const result = scoreSymbols(symbols, impactNodes, refs);

            for (const entry of result) {
                expect(entry.relevanceScore).toBeGreaterThanOrEqual(0.0);
                expect(entry.relevanceScore).toBeLessThanOrEqual(1.0);
            }
        });

        it("symbols in same file as references score higher than distant symbols", () => {
            const sameFileSymbol = makeSymbol({ id: "same", name: "close", filePath: "server/services/user.ts" });
            const distantSymbol = makeSymbol({ id: "distant", name: "far", filePath: "completely/different/path.ts" });

            const symbols = [sameFileSymbol, distantSymbol];
            const impactNodes: ImpactNode[] = [];
            const refs = makeReferences({ filePaths: ["server/services/user.ts"] });

            const result = scoreSymbols(symbols, impactNodes, refs);

            const sameFileResult = result.find((r) => r.symbol.id === "same")!;
            const distantResult = result.find((r) => r.symbol.id === "distant")!;

            expect(sameFileResult.relevanceScore).toBeGreaterThan(distantResult.relevanceScore);
        });

        it("symbols with multiple name mentions in references score higher", () => {
            const mentionedSymbol = makeSymbol({ id: "popular", name: "createUser", filePath: "server/a.ts" });
            const rareSymbol = makeSymbol({ id: "rare", name: "helperFn", filePath: "server/a.ts" });

            const symbols = [mentionedSymbol, rareSymbol];
            const impactNodes: ImpactNode[] = [];
            const refs = makeReferences({
                filePaths: [],
                functionNames: ["createUser", "createUser", "createUser"],
                classNames: [],
                typeNames: [],
            });

            const result = scoreSymbols(symbols, impactNodes, refs);

            const popularResult = result.find((r) => r.symbol.id === "popular")!;
            const rareResult = result.find((r) => r.symbol.id === "rare")!;

            expect(popularResult.relevanceScore).toBeGreaterThan(rareResult.relevanceScore);
        });
    });

    describe("category priority", () => {
        it("type definitions (interface kind) get category 'types'", () => {
            const typeSymbol = makeSymbol({ id: "t1", name: "UserConfig", kind: "interface", filePath: "server/types.ts" });
            const result = scoreSymbols([typeSymbol], [], makeReferences());

            expect(result[0].category).toBe("types");
        });

        it("type definitions (type kind) get category 'types'", () => {
            const typeSymbol = makeSymbol({ id: "t2", name: "AppOptions", kind: "type", filePath: "server/types.ts" });
            const result = scoreSymbols([typeSymbol], [], makeReferences());

            expect(result[0].category).toBe("types");
        });

        it("symbols in test files get category 'usage_examples'", () => {
            const testSymbol = makeSymbol({ id: "test1", name: "testHelper", kind: "function", filePath: "server/__tests__/user.test.ts" });
            const result = scoreSymbols([testSymbol], [], makeReferences());

            expect(result[0].category).toBe("usage_examples");
        });

        it("symbols in spec files get category 'usage_examples'", () => {
            const specSymbol = makeSymbol({ id: "spec1", name: "specHelper", kind: "function", filePath: "tests/e2e/user.spec.ts" });
            const result = scoreSymbols([specSymbol], [], makeReferences());

            expect(result[0].category).toBe("usage_examples");
        });

        it("for same file, a type def ranks above a usage example when both present", () => {
            const typeSymbol = makeSymbol({ id: "type1", name: "UserInterface", kind: "interface", filePath: "server/services/user.ts" });
            const testSymbol = makeSymbol({ id: "test1", name: "testFn", kind: "function", filePath: "server/services/__tests__/user.test.ts" });

            const refs = makeReferences({ filePaths: ["server/services/user.ts"] });
            const impactNodes: ImpactNode[] = [
                makeImpactNode({ symbol: { id: "type1", name: "UserInterface", kind: "interface", filePath: "server/services/user.ts" }, depth: 0 }),
                makeImpactNode({ symbol: { id: "test1", name: "testFn", kind: "function", filePath: "server/services/__tests__/user.test.ts" }, depth: 1 }),
            ];

            const result = scoreSymbols([typeSymbol, testSymbol], impactNodes, refs);

            const typeResult = result.find((r) => r.symbol.id === "type1")!;
            const testResult = result.find((r) => r.symbol.id === "test1")!;

            expect(typeResult.category).toBe("types");
            expect(testResult.category).toBe("usage_examples");
            // Type should rank above usage example (higher score due to proximity)
            expect(typeResult.relevanceScore).toBeGreaterThanOrEqual(testResult.relevanceScore);
        });
    });

    describe("deduplication", () => {
        it("keeps only highest-scored entry when two symbols have same ID", () => {
            // Two symbols with same ID but different file paths (different proximity scores)
            const sym1 = makeSymbol({ id: "dup", name: "handler", filePath: "server/services/user.ts" });
            const sym2 = makeSymbol({ id: "dup", name: "handler", filePath: "completely/different/place.ts" });

            const refs = makeReferences({ filePaths: ["server/services/user.ts"] });

            const result = scoreSymbols([sym1, sym2], [], refs);

            const dupEntries = result.filter((r) => r.symbol.id === "dup");
            expect(dupEntries).toHaveLength(1);
            // Should keep the one from the same file (higher proximity score)
            expect(dupEntries[0].symbol.filePath).toBe("server/services/user.ts");
        });

        it("total output count is less than or equal to input count", () => {
            const symbols: XRaySymbol[] = [
                makeSymbol({ id: "a", name: "a", filePath: "server/a.ts" }),
                makeSymbol({ id: "b", name: "b", filePath: "server/b.ts" }),
                makeSymbol({ id: "a", name: "a", filePath: "server/c.ts" }), // duplicate ID
                makeSymbol({ id: "c", name: "c", filePath: "server/d.ts" }),
            ];

            const result = scoreSymbols(symbols, [], makeReferences());

            expect(result.length).toBeLessThanOrEqual(symbols.length);
        });
    });

    describe("exclusion", () => {
        it("excludes symbols with filePath containing 'node_modules/'", () => {
            const nodeModuleSymbol = makeSymbol({ id: "nm1", name: "external", filePath: "node_modules/lodash/index.ts" });
            const validSymbol = makeSymbol({ id: "v1", name: "internal", filePath: "server/utils.ts" });

            const result = scoreSymbols([nodeModuleSymbol, validSymbol], [], makeReferences());

            expect(result.find((r) => r.symbol.id === "nm1")).toBeUndefined();
            expect(result.find((r) => r.symbol.id === "v1")).toBeDefined();
        });

        it("excludes symbols with filePath containing 'dist/'", () => {
            const distSymbol = makeSymbol({ id: "d1", name: "compiled", filePath: "dist/server/utils.js" });
            const validSymbol = makeSymbol({ id: "v2", name: "source", filePath: "server/utils.ts" });

            const result = scoreSymbols([distSymbol, validSymbol], [], makeReferences());

            expect(result.find((r) => r.symbol.id === "d1")).toBeUndefined();
            expect(result.find((r) => r.symbol.id === "v2")).toBeDefined();
        });

        it("excludes symbols with filePath containing '.generated.'", () => {
            const generatedSymbol = makeSymbol({ id: "g1", name: "genType", filePath: "server/types.generated.ts" });
            const validSymbol = makeSymbol({ id: "v3", name: "manualType", filePath: "server/types.ts" });

            const result = scoreSymbols([generatedSymbol, validSymbol], [], makeReferences());

            expect(result.find((r) => r.symbol.id === "g1")).toBeUndefined();
            expect(result.find((r) => r.symbol.id === "v3")).toBeDefined();
        });

        it("excludes symbols with filePath containing 'vendor/'", () => {
            const vendorSymbol = makeSymbol({ id: "vn1", name: "vendored", filePath: "vendor/lib/helper.ts" });
            const validSymbol = makeSymbol({ id: "v4", name: "own", filePath: "server/helper.ts" });

            const result = scoreSymbols([vendorSymbol, validSymbol], [], makeReferences());

            expect(result.find((r) => r.symbol.id === "vn1")).toBeUndefined();
            expect(result.find((r) => r.symbol.id === "v4")).toBeDefined();
        });
    });

    describe("edge cases", () => {
        it("empty symbols array returns empty result", () => {
            const result = scoreSymbols([], [], makeReferences());
            expect(result).toEqual([]);
        });

        it("empty impactNodes still produces scored results with min depth score", () => {
            const symbols = [makeSymbol({ id: "s1", name: "fn1", filePath: "server/a.ts" })];
            const result = scoreSymbols(symbols, [], makeReferences());

            expect(result).toHaveLength(1);
            expect(result[0].relevanceScore).toBeGreaterThan(0);
        });

        it("empty references still produces scored results with min proximity/frequency", () => {
            const symbols = [makeSymbol({ id: "s1", name: "fn1", filePath: "server/a.ts" })];
            const emptyRefs = makeReferences({
                filePaths: [],
                functionNames: [],
                classNames: [],
                moduleNames: [],
                typeNames: [],
            });
            const impactNodes = [makeImpactNode({ symbol: { id: "s1", name: "fn1" }, depth: 0 })];

            const result = scoreSymbols(symbols, impactNodes, emptyRefs);

            expect(result).toHaveLength(1);
            expect(result[0].relevanceScore).toBeGreaterThan(0);
        });
    });

    describe("sorting", () => {
        it("results are sorted descending by relevanceScore", () => {
            const symbols: XRaySymbol[] = [
                makeSymbol({ id: "low", name: "lowFn", filePath: "far/away/file.ts" }),
                makeSymbol({ id: "high", name: "highFn", filePath: "server/services/user.ts" }),
                makeSymbol({ id: "mid", name: "midFn", filePath: "server/other/file.ts" }),
            ];
            const refs = makeReferences({
                filePaths: ["server/services/user.ts"],
                functionNames: ["highFn", "highFn", "highFn"],
            });
            const impactNodes = [
                makeImpactNode({ symbol: { id: "high", name: "highFn", filePath: "server/services/user.ts" }, depth: 0 }),
            ];

            const result = scoreSymbols(symbols, impactNodes, refs);

            for (let i = 0; i < result.length - 1; i++) {
                expect(result[i].relevanceScore).toBeGreaterThanOrEqual(result[i + 1].relevanceScore);
            }
        });
    });
});
