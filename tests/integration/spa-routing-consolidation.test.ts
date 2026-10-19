/**
 * SPA Routing Consolidation Tests
 *
 * Validates that the SPA merge (Pipelines→Operations, Observability→Intelligence)
 * correctly routes all paths to the expected entry points.
 */
import { describe, it, expect } from "vitest";
import { getEntryForUrl, SPA_ENTRIES } from "@/lib/spa-utils";

describe("SPA Routing Consolidation", () => {
    describe("Pipelines merged into Operations", () => {
        it("routes /pipelines to operations", () => {
            expect(getEntryForUrl("/pipelines")).toBe("operations");
        });

        it("routes /pipelines/123 to operations", () => {
            expect(getEntryForUrl("/pipelines/123")).toBe("operations");
        });

        it("routes /templates to operations", () => {
            expect(getEntryForUrl("/templates")).toBe("operations");
        });

        it("routes /pipeline-executions to operations", () => {
            expect(getEntryForUrl("/pipeline-executions")).toBe("operations");
        });

        it("PIPELINES SPA_ENTRIES is empty (deprecated)", () => {
            expect(SPA_ENTRIES.PIPELINES).toEqual([]);
        });

        it("OPERATIONS SPA_ENTRIES includes pipeline prefixes", () => {
            expect(SPA_ENTRIES.OPERATIONS).toContain("/pipelines");
            expect(SPA_ENTRIES.OPERATIONS).toContain("/templates");
            expect(SPA_ENTRIES.OPERATIONS).toContain("/pipeline-executions");
        });
    });

    describe("Observability merged into Intelligence", () => {
        it("routes /monitoring to intelligence", () => {
            expect(getEntryForUrl("/monitoring")).toBe("intelligence");
        });

        it("routes /monitoring/123 to intelligence", () => {
            expect(getEntryForUrl("/monitoring/123")).toBe("intelligence");
        });

        it("routes /observability to intelligence", () => {
            expect(getEntryForUrl("/observability")).toBe("intelligence");
        });

        it("routes /alerts to intelligence", () => {
            expect(getEntryForUrl("/alerts")).toBe("intelligence");
        });

        it("routes /events to intelligence", () => {
            expect(getEntryForUrl("/events")).toBe("intelligence");
        });

        it("OBSERVABILITY SPA_ENTRIES is empty (deprecated)", () => {
            expect(SPA_ENTRIES.OBSERVABILITY).toEqual([]);
        });

        it("INTELLIGENCE SPA_ENTRIES includes observability prefixes", () => {
            expect(SPA_ENTRIES.INTELLIGENCE).toContain("/monitoring");
            expect(SPA_ENTRIES.INTELLIGENCE).toContain("/observability");
            expect(SPA_ENTRIES.INTELLIGENCE).toContain("/alerts");
            expect(SPA_ENTRIES.INTELLIGENCE).toContain("/events");
        });
    });

    describe("Existing routes unchanged", () => {
        it("routes /operations to operations", () => {
            expect(getEntryForUrl("/operations")).toBe("operations");
        });

        it("routes /missions to operations", () => {
            expect(getEntryForUrl("/missions")).toBe("operations");
        });

        it("routes /insights to intelligence", () => {
            expect(getEntryForUrl("/insights")).toBe("intelligence");
        });

        it("routes /control to intelligence", () => {
            expect(getEntryForUrl("/control")).toBe("intelligence");
        });

        it("routes /knowledge to knowledge", () => {
            expect(getEntryForUrl("/knowledge")).toBe("knowledge");
        });

        it("routes /armory to armory", () => {
            expect(getEntryForUrl("/armory")).toBe("armory");
        });

        it("routes /organizations to operations", () => {
            expect(getEntryForUrl("/organizations")).toBe("operations");
        });

        it("routes /dashboard to operations", () => {
            expect(getEntryForUrl("/dashboard")).toBe("operations");
        });

        it("routes / to auth", () => {
            expect(getEntryForUrl("/")).toBe("auth");
        });
    });

    describe("Cross-SPA navigation detection", () => {
        it("operations→pipelines is NOT cross-SPA (same bundle now)", () => {
            // Both resolve to 'operations'
            expect(getEntryForUrl("/operations")).toBe(getEntryForUrl("/pipelines"));
        });

        it("insights→monitoring is NOT cross-SPA (same bundle now)", () => {
            // Both resolve to 'intelligence'
            expect(getEntryForUrl("/insights")).toBe(getEntryForUrl("/monitoring"));
        });

        it("operations→monitoring IS cross-SPA", () => {
            expect(getEntryForUrl("/operations")).not.toBe(getEntryForUrl("/monitoring"));
        });

        it("intelligence→armory IS cross-SPA", () => {
            expect(getEntryForUrl("/insights")).not.toBe(getEntryForUrl("/armory"));
        });
    });
});
