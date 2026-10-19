/**
 * PatternExportService.validateImportFormat Tests — pure validation logic
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("drizzle-orm", () => ({ sql: vi.fn() }));
vi.mock("@shared/utils/errorKnowledgeBase", () => ({
    BUILTIN_ERROR_PATTERNS: [],
}));

import { PatternExportService } from "@domain/knowledge/core/pattern-export.service.js";

const svc = new PatternExportService();

describe("PatternExportService.validateImportFormat", () => {

    it("returns valid for a well-formed export", () => {
        const data = {
            version: "1.0",
            patterns: [
                {
                    id: "err-1",
                    name: "Auth Error",
                    category: "auth",
                    triggers: [{ type: "status", value: 401 }],
                    diagnosis: { summary: "Auth failed", explanation: "Token expired" },
                },
            ],
        };
        const result = svc.validateImportFormat(data);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("reports error when version is missing", () => {
        const data = { patterns: [{ id: "x", name: "X", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.errors).toContain("Missing version field");
    });

    it("warns on version mismatch", () => {
        const data = { version: "2.0", patterns: [{ id: "x", name: "X", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.warnings.some(w => w.includes("Version mismatch"))).toBe(true);
    });

    it("reports error when patterns is missing", () => {
        const data = { version: "1.0" };
        const result = svc.validateImportFormat(data);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing or invalid patterns array");
    });

    it("reports error when patterns is not an array", () => {
        const data = { version: "1.0", patterns: "not-array" };
        const result = svc.validateImportFormat(data);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Missing or invalid patterns array");
    });

    it("reports error for pattern missing id", () => {
        const data = { version: "1.0", patterns: [{ name: "X", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.errors.some(e => e.includes("Missing id"))).toBe(true);
    });

    it("reports error for pattern missing name", () => {
        const data = { version: "1.0", patterns: [{ id: "x", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.errors.some(e => e.includes("Missing name"))).toBe(true);
    });

    it("warns for pattern missing category", () => {
        const data = { version: "1.0", patterns: [{ id: "x", name: "X", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.warnings.some(w => w.includes("Missing category"))).toBe(true);
    });

    it("warns for pattern missing triggers", () => {
        const data = { version: "1.0", patterns: [{ id: "x", name: "X", category: "auth", diagnosis: {} }] };
        const result = svc.validateImportFormat(data);
        expect(result.warnings.some(w => w.includes("Missing triggers"))).toBe(true);
    });

    it("reports error for pattern missing diagnosis", () => {
        const data = { version: "1.0", patterns: [{ id: "x", name: "X", category: "auth" }] };
        const result = svc.validateImportFormat(data);
        expect(result.errors.some(e => e.includes("Missing diagnosis"))).toBe(true);
    });

    it("validates multiple patterns independently", () => {
        const data = {
            version: "1.0",
            patterns: [
                { id: "a", name: "A", diagnosis: {} },
                { name: "B", diagnosis: {} }, // missing id
                { id: "c", diagnosis: {} },   // missing name
            ],
        };
        const result = svc.validateImportFormat(data);
        expect(result.errors.filter(e => e.includes("Missing id"))).toHaveLength(1);
        expect(result.errors.filter(e => e.includes("Missing name"))).toHaveLength(1);
    });

    it("returns valid=true when only warnings exist", () => {
        const data = {
            version: "1.0",
            patterns: [{ id: "x", name: "X", diagnosis: {} }],
        };
        const result = svc.validateImportFormat(data);
        expect(result.valid).toBe(true);
        // Warnings for missing category and triggers, but no errors
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});
