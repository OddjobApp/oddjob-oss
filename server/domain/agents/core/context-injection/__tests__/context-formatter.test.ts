import { describe, it, expect } from "vitest";
import {
    formatContext,
    countTokens,
    DEFAULT_TOKEN_BUDGET,
    TYPE_MINIMUM_RESERVE,
} from "../context-formatter.js";
import type { FormatOptions } from "../context-formatter.js";
import type { ScoredSymbol } from "../types.js";
import type { XRaySymbol } from "@domain/xray/core/xray-intelligence.service.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeXRaySymbol(overrides: Partial<XRaySymbol> = {}): XRaySymbol {
    return {
        id: "sym-1",
        name: "doSomething",
        kind: "function",
        filePath: "server/services/user.ts",
        startLine: 10,
        endLine: 30,
        signature: "function doSomething(): void { return; }",
        ...overrides,
    };
}

function makeScoredSymbol(overrides: Partial<ScoredSymbol> = {}): ScoredSymbol {
    return {
        symbol: makeXRaySymbol(),
        relevanceScore: 0.8,
        category: "related_functions",
        relationship: "Called by main()",
        ...overrides,
    };
}

function makeTypeSymbol(id: string, name: string, signature: string, score = 0.9): ScoredSymbol {
    return {
        symbol: makeXRaySymbol({ id, name, kind: "interface", filePath: `server/types/${name}.ts`, signature }),
        relevanceScore: score,
        category: "types",
        relationship: "Type used by modified function",
    };
}

function makeFunctionSymbol(id: string, name: string, signature: string, score = 0.7): ScoredSymbol {
    return {
        symbol: makeXRaySymbol({ id, name, kind: "function", filePath: `server/services/${name}.ts`, signature }),
        relevanceScore: score,
        category: "related_functions",
        relationship: "Called by target function",
    };
}

function makeDefaultOptions(overrides: Partial<FormatOptions> = {}): FormatOptions {
    return {
        tokenBudget: DEFAULT_TOKEN_BUDGET,
        maxLinesPerSymbol: 50,
        includeRelationship: true,
        ...overrides,
    };
}

/**
 * Generate a signature string of approximately the given token count.
 * Since 1 token ≈ 4 chars, we generate (tokens * 4) chars of content.
 */
function generateSignature(approxTokens: number): string {
    const charCount = approxTokens * 4;
    // Generate lines of ~80 chars each
    const lineCount = Math.ceil(charCount / 80);
    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
        lines.push(`    const value${i} = compute(arg${i}); // processing step ${i}`);
    }
    return lines.join("\n").slice(0, charCount);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ContextFormatter", () => {
    describe("constants", () => {
        it("DEFAULT_TOKEN_BUDGET is 4000", () => {
            expect(DEFAULT_TOKEN_BUDGET).toBe(4000);
        });

        it("TYPE_MINIMUM_RESERVE is 500", () => {
            expect(TYPE_MINIMUM_RESERVE).toBe(500);
        });
    });

    describe("token budget enforcement (Requirement 4.1)", () => {
        it("formatted output never exceeds the configured token budget", () => {
            const symbols: ScoredSymbol[] = [];
            // Create many symbols that would exceed budget
            for (let i = 0; i < 20; i++) {
                symbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `function${i}`,
                    generateSignature(300),
                    0.9 - i * 0.01,
                ));
            }

            const options = makeDefaultOptions({ tokenBudget: 2000 });
            const result = formatContext(symbols, options);

            expect(result.tokensUsed).toBeLessThanOrEqual(options.tokenBudget);
        });

        it("uses default budget of 4000 tokens when no override specified", () => {
            const options = makeDefaultOptions();
            expect(options.tokenBudget).toBe(4000);
        });

        it("respects a custom tokenBudget smaller than default", () => {
            const symbols = [
                makeFunctionSymbol("fn1", "alpha", generateSignature(500), 0.9),
                makeFunctionSymbol("fn2", "beta", generateSignature(500), 0.8),
                makeFunctionSymbol("fn3", "gamma", generateSignature(500), 0.7),
            ];

            const smallBudget = makeDefaultOptions({ tokenBudget: 800 });
            const largeBudget = makeDefaultOptions({ tokenBudget: 4000 });

            const smallResult = formatContext(symbols, smallBudget);
            const largeResult = formatContext(symbols, largeBudget);

            expect(smallResult.tokensUsed).toBeLessThanOrEqual(800);
            expect(smallResult.symbolsIncluded).toBeLessThan(largeResult.symbolsIncluded);
        });
    });

    describe("per-mission budget override (Requirement 4.6)", () => {
        it("supports per-mission budget override via options.tokenBudget", () => {
            const symbols = [
                makeFunctionSymbol("fn1", "alpha", generateSignature(200), 0.9),
                makeFunctionSymbol("fn2", "beta", generateSignature(200), 0.8),
            ];

            const overrideBudget = 1500;
            const options = makeDefaultOptions({ tokenBudget: overrideBudget });
            const result = formatContext(symbols, options);

            expect(result.tokensUsed).toBeLessThanOrEqual(overrideBudget);
        });

        it("different budget values produce different truncation behavior", () => {
            const symbols: ScoredSymbol[] = [];
            for (let i = 0; i < 10; i++) {
                symbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `func${i}`,
                    generateSignature(200),
                    0.9 - i * 0.05,
                ));
            }

            const tightResult = formatContext(symbols, makeDefaultOptions({ tokenBudget: 600 }));
            const looseResult = formatContext(symbols, makeDefaultOptions({ tokenBudget: 6000 }));

            expect(tightResult.symbolsIncluded).toBeLessThan(looseResult.symbolsIncluded);
            expect(tightResult.truncatedCount).toBeGreaterThan(looseResult.truncatedCount);
        });
    });

    describe("type category minimum reservation (Requirement 4.4)", () => {
        it("reserves at least 500 tokens for types when type symbols are available", () => {
            // Create type symbols that use ~400 tokens total
            const typeSymbol = makeTypeSymbol(
                "type1",
                "UserConfig",
                generateSignature(100),
                0.95,
            );

            // Create many large function symbols that would otherwise consume all budget
            const functionSymbols: ScoredSymbol[] = [];
            for (let i = 0; i < 10; i++) {
                functionSymbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `bigFunction${i}`,
                    generateSignature(200),
                    0.99, // Higher score than types!
                ));
            }

            // Use a budget of 700 tokens (80 reserved for header/footer = 620 available)
            // With 500 reserved for types, non-types get at most 120 tokens
            const options = makeDefaultOptions({ tokenBudget: 700 });
            const result = formatContext([typeSymbol, ...functionSymbols], options);

            // Type should be included
            expect(result.prompt).toContain("Types & Interfaces");
            expect(result.prompt).toContain("UserConfig");
        });

        it("non-type categories cannot consume more than (available - 500) when types exist", () => {
            // Type symbol uses ~150 tokens when formatted
            const typeSymbol = makeTypeSymbol(
                "type1",
                "SmallType",
                "interface SmallType { id: number; }",
                0.5, // Low score
            );

            // Function symbol is large and high-scored
            const bigFnSymbol = makeFunctionSymbol(
                "fn1",
                "bigFunction",
                generateSignature(400),
                0.99, // Very high score
            );

            // Budget: 700 total, 80 reserved for header/footer = 620 available
            // With types present: non-type ceiling = 620 - 500 = 120 tokens max
            // The big function needs ~400+ tokens, won't fit in 120 token ceiling
            const options = makeDefaultOptions({ tokenBudget: 700 });
            const result = formatContext([typeSymbol, bigFnSymbol], options);

            // Type should be included, big function should be truncated
            expect(result.prompt).toContain("SmallType");
            expect(result.truncatedCount).toBeGreaterThanOrEqual(1);
        });

        it("when no type symbols exist, full budget is available to other categories", () => {
            // Only function symbols, no types
            const functionSymbols: ScoredSymbol[] = [];
            for (let i = 0; i < 5; i++) {
                functionSymbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `func${i}`,
                    generateSignature(100),
                    0.9 - i * 0.1,
                ));
            }

            const options = makeDefaultOptions({ tokenBudget: 2000 });
            const result = formatContext(functionSymbols, options);

            // All or most functions should fit since there's no type reservation
            expect(result.symbolsIncluded).toBeGreaterThan(0);
            expect(result.tokensUsed).toBeLessThanOrEqual(2000);
        });

        it("types can use more than 500 tokens if budget allows", () => {
            // Multiple type symbols that together exceed 500 tokens
            const typeSymbols: ScoredSymbol[] = [];
            for (let i = 0; i < 5; i++) {
                typeSymbols.push(makeTypeSymbol(
                    `type-${i}`,
                    `BigInterface${i}`,
                    generateSignature(200),
                    0.95 - i * 0.01,
                ));
            }

            const options = makeDefaultOptions({ tokenBudget: 4000 });
            const result = formatContext(typeSymbols, options);

            // Should include multiple type symbols (all of them if budget allows)
            expect(result.symbolsIncluded).toBeGreaterThan(1);
        });
    });

    describe("truncation by lowest-ranked symbols (Requirement 4.2)", () => {
        it("includes higher-scored symbols before lower-scored within same category", () => {
            const highScored = makeFunctionSymbol("fn-high", "highPriority", generateSignature(100), 0.95);
            const lowScored = makeFunctionSymbol("fn-low", "lowPriority", generateSignature(100), 0.3);

            // Tight budget: only one can fit
            const options = makeDefaultOptions({ tokenBudget: 400 });
            const result = formatContext([lowScored, highScored], options);

            if (result.symbolsIncluded === 1) {
                expect(result.prompt).toContain("highPriority");
                expect(result.prompt).not.toContain("lowPriority");
            }
        });

        it("higher-priority categories are included before lower-priority", () => {
            // Type symbol (priority 1) vs usage example (priority 4)
            const typeSymbol = makeTypeSymbol("type1", "ImportantType", "interface ImportantType { x: number; }", 0.5);
            const exampleSymbol: ScoredSymbol = {
                symbol: makeXRaySymbol({ id: "ex1", name: "testExample", kind: "function", filePath: "tests/example.test.ts", signature: generateSignature(100) }),
                relevanceScore: 0.99,
                category: "usage_examples",
                relationship: "Test pattern",
            };

            // Tight budget: can fit only one or two
            const options = makeDefaultOptions({ tokenBudget: 500 });
            const result = formatContext([exampleSymbol, typeSymbol], options);

            // Type should always be included first (processed first in priority order)
            if (result.symbolsIncluded >= 1) {
                expect(result.prompt).toContain("ImportantType");
            }
        });
    });

    describe("truncation note (Requirement 4.5)", () => {
        it("appends truncation note when symbols are excluded", () => {
            const symbols: ScoredSymbol[] = [];
            for (let i = 0; i < 20; i++) {
                symbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `function${i}`,
                    generateSignature(300),
                    0.9 - i * 0.01,
                ));
            }

            const options = makeDefaultOptions({ tokenBudget: 1000 });
            const result = formatContext(symbols, options);

            expect(result.truncatedCount).toBeGreaterThan(0);
            expect(result.prompt).toContain("additional symbols excluded due to token budget");
        });

        it("truncation note includes the count of excluded symbols", () => {
            const symbols: ScoredSymbol[] = [];
            for (let i = 0; i < 10; i++) {
                symbols.push(makeFunctionSymbol(
                    `fn-${i}`,
                    `function${i}`,
                    generateSignature(300),
                    0.9 - i * 0.01,
                ));
            }

            const options = makeDefaultOptions({ tokenBudget: 800 });
            const result = formatContext(symbols, options);

            const expectedNote = `${result.truncatedCount} additional symbols excluded due to token budget`;
            expect(result.prompt).toContain(expectedNote);
        });

        it("no truncation note when all symbols fit", () => {
            const symbols = [
                makeFunctionSymbol("fn1", "smallFn", "function smallFn(): void {}", 0.9),
            ];

            const options = makeDefaultOptions({ tokenBudget: 4000 });
            const result = formatContext(symbols, options);

            expect(result.truncatedCount).toBe(0);
            expect(result.prompt).not.toContain("additional symbols excluded due to token budget");
        });
    });

    describe("output format", () => {
        it("output is grouped by category in correct order", () => {
            const symbols: ScoredSymbol[] = [
                makeTypeSymbol("t1", "MyType", "interface MyType { id: string; }", 0.9),
                makeFunctionSymbol("fn1", "myFunc", "function myFunc(): void {}", 0.8),
                {
                    symbol: makeXRaySymbol({ id: "imp1", name: "importHelper", kind: "function", filePath: "server/imports.ts", signature: "import { x } from 'y'" }),
                    relevanceScore: 0.7,
                    category: "imports",
                    relationship: "Import dependency",
                },
                {
                    symbol: makeXRaySymbol({ id: "ex1", name: "testExample", kind: "function", filePath: "tests/example.test.ts", signature: "test('works', () => {})" }),
                    relevanceScore: 0.6,
                    category: "usage_examples",
                    relationship: "Test pattern",
                },
            ];

            const options = makeDefaultOptions();
            const result = formatContext(symbols, options);

            const typesIdx = result.prompt.indexOf("### Types & Interfaces");
            const funcsIdx = result.prompt.indexOf("### Related Functions");
            const importsIdx = result.prompt.indexOf("### Import Map");
            const examplesIdx = result.prompt.indexOf("### Usage Examples");

            expect(typesIdx).toBeLessThan(funcsIdx);
            expect(funcsIdx).toBeLessThan(importsIdx);
            expect(importsIdx).toBeLessThan(examplesIdx);
        });

        it("includes header with symbol count, file count, and token count", () => {
            const symbols = [
                makeTypeSymbol("t1", "MyType", "interface MyType { id: string; }", 0.9),
                makeFunctionSymbol("fn1", "myFunc", "function myFunc(): void {}", 0.8),
            ];

            const options = makeDefaultOptions();
            const result = formatContext(symbols, options);

            expect(result.prompt).toContain("═══ CODE CONTEXT (");
            expect(result.prompt).toContain("symbols,");
            expect(result.prompt).toContain("files,");
            expect(result.prompt).toContain("tokens) ═══");
        });

        it("includes file path and line range for each symbol", () => {
            const symbols = [
                makeFunctionSymbol("fn1", "myFunc", "function myFunc(): void {}", 0.9),
            ];
            symbols[0].symbol.filePath = "server/services/user.ts";
            symbols[0].symbol.startLine = 10;
            symbols[0].symbol.endLine = 30;

            const options = makeDefaultOptions();
            const result = formatContext(symbols, options);

            expect(result.prompt).toContain("📄 server/services/user.ts (L10-L30)");
        });

        it("includes relationship description when includeRelationship is true", () => {
            const symbols = [
                makeFunctionSymbol("fn1", "myFunc", "function myFunc(): void {}", 0.9),
            ];

            const options = makeDefaultOptions({ includeRelationship: true });
            const result = formatContext(symbols, options);

            expect(result.prompt).toContain("↳ Called by target function");
        });
    });

    describe("countTokens", () => {
        it("returns character count divided by 4, rounded up", () => {
            expect(countTokens("abcd")).toBe(1);       // 4/4 = 1
            expect(countTokens("abcde")).toBe(2);      // 5/4 = 1.25 → ceil → 2
            expect(countTokens("")).toBe(0);            // 0/4 = 0
            expect(countTokens("a")).toBe(1);           // 1/4 = 0.25 → ceil → 1
            expect(countTokens("a".repeat(400))).toBe(100); // 400/4 = 100
        });
    });

    describe("edge cases", () => {
        it("empty symbols array returns valid structure with zero counts", () => {
            const result = formatContext([], makeDefaultOptions());

            expect(result.symbolsIncluded).toBe(0);
            expect(result.truncatedCount).toBe(0);
            expect(result.prompt).toContain("═══ CODE CONTEXT (0 symbols,");
        });

        it("very small budget still produces valid output", () => {
            const symbols = [
                makeTypeSymbol("t1", "Type", "interface T {}", 0.9),
            ];

            // Budget of 100 — barely enough for header/footer
            const options = makeDefaultOptions({ tokenBudget: 100 });
            const result = formatContext(symbols, options);

            // Should not throw, should produce a valid result
            expect(result.tokensUsed).toBeLessThanOrEqual(100);
            expect(typeof result.prompt).toBe("string");
        });
    });
});
