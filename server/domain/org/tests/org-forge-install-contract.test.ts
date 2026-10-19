/**
 * Characterization tests for OrgForgeService.installCycleApp.
 *
 * installCycleApp is a ~1250-line method with no test coverage, so these pin the
 * behaviour of its entry contract BEFORE it is decomposed: what it validates,
 * which options short-circuit before any provisioning, and what each early
 * return looks like. They are deliberately written against the public method so
 * they keep passing as the body is split into provision* steps.
 *
 * The validateOnly and dryRun paths both return before any database work, which
 * is what makes this surface testable without a live schema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    validate: vi.fn(),
    startSpan: vi.fn(),
    addSpanTag: vi.fn(),
    finishSpan: vi.fn(),
    dbSelect: vi.fn(),
    getCurrentVersion: vi.fn().mockResolvedValue(null),
    needsMigration: vi.fn().mockResolvedValue(false),
    migrate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (...a: unknown[]) => { h.dbSelect(...a); return { from: () => ({ where: () => ({ limit: () => [] }) }) }; },
        insert: () => ({ values: () => ({ returning: () => [{ id: 1 }] }) }),
        update: () => ({ set: () => ({ where: () => undefined }) }),
        delete: () => ({ where: () => undefined }),
    },
}));

// Module-load side effect: org-forge calls this at import time.
vi.mock("@domain/org/core/event-handlers.js", () => ({ registerCrossAppEventHandlers: vi.fn() }));
vi.mock("../core/event-handlers.js", () => ({ registerCrossAppEventHandlers: vi.fn() }));

vi.mock("../core/blueprint-schema.validator.js", () => ({
    BlueprintSchemaValidator: { validate: h.validate },
}));
vi.mock("../core/enhanced-observability.service.js", () => ({
    enhancedObservabilityService: { startSpan: h.startSpan, addSpanTag: h.addSpanTag, finishSpan: h.finishSpan },
}));
vi.mock("../core/blueprint-migration.service.js", () => ({
    blueprintMigrationService: {
        getCurrentVersion: h.getCurrentVersion,
        needsMigration: h.needsMigration,
        migrate: h.migrate,
    },
}));

import { OrgForgeService } from "../core/org-forge.service.js";

const VALID = { valid: true, errors: [], warnings: [] };

const MANIFEST = `
name: Test Cycle
version: 1.2.0
description: A cycle used by the contract tests
agents:
  - id: triage
    name: Triage Agent
missions:
  - id: mission-a
    name: Mission A
`;

describe("OrgForgeService.installCycleApp — entry contract", () => {
    let service: OrgForgeService;

    beforeEach(() => {
        vi.clearAllMocks();
        h.validate.mockReturnValue(VALID);
        h.getCurrentVersion.mockResolvedValue(null);
        service = new OrgForgeService();
    });

    describe("schema validation", () => {
        it("throws with every validation error joined, and provisions nothing", async () => {
            h.validate.mockReturnValue({
                valid: false,
                errors: [
                    { path: "name", message: "is required" },
                    { path: "agents[0].id", message: "must be a string" },
                ],
                warnings: [],
            });

            await expect(service.installCycleApp(1, MANIFEST)).rejects.toThrow(
                "Blueprint validation failed: name: is required; agents[0].id: must be a string"
            );
            expect(h.dbSelect).not.toHaveBeenCalled();
        });

        it("surfaces validation warnings without failing the install", async () => {
            h.validate.mockReturnValue({
                valid: true,
                errors: [],
                warnings: [{ path: "schedules", message: "none defined" }],
            });

            const result: any = await service.installCycleApp(1, MANIFEST, { validateOnly: true });

            expect(result.success).toBe(true);
            expect(result.warnings).toContain("Validation warning: schedules - none defined");
        });
    });

    describe("validateOnly", () => {
        it("returns the validation report and never touches the database", async () => {
            const result: any = await service.installCycleApp(1, MANIFEST, { validateOnly: true });

            expect(result).toMatchObject({ success: true, validationOnly: true });
            expect(result).not.toHaveProperty("preview");
            expect(h.dbSelect).not.toHaveBeenCalled();
        });
    });

    describe("dryRun", () => {
        it("returns a preview of the manifest and never touches the database", async () => {
            const result: any = await service.installCycleApp(1, MANIFEST, { dryRun: true });

            expect(result).toMatchObject({ success: true, dryRun: true });
            expect(result.preview.blueprint).toMatchObject({
                name: "Test Cycle",
                version: "1.2.0",
            });
            expect(h.dbSelect).not.toHaveBeenCalled();
        });

        it("validateOnly takes precedence over dryRun", async () => {
            const result: any = await service.installCycleApp(1, MANIFEST, { validateOnly: true, dryRun: true });

            expect(result.validationOnly).toBe(true);
            expect(result.dryRun).toBeUndefined();
        });
    });

    describe("observability", () => {
        it("opens a span tagged with the validation counts", async () => {
            h.validate.mockReturnValue({
                valid: true,
                errors: [],
                warnings: [{ path: "a", message: "b" }],
            });

            await service.installCycleApp(42, MANIFEST, { validateOnly: true });

            expect(h.startSpan).toHaveBeenCalled();
            expect(h.addSpanTag).toHaveBeenCalledWith(expect.any(String), "validation_errors", "0");
            expect(h.addSpanTag).toHaveBeenCalledWith(expect.any(String), "validation_warnings", "1");
        });
    });

    describe("manifest parsing", () => {
        it("rejects a manifest with no name", async () => {
            await expect(
                service.installCycleApp(1, "version: 1.0.0\ndescription: nameless")
            ).rejects.toThrow("Missing 'name'");
        });
    });
    describe("failure path", () => {
        it("runs best-effort cleanup keyed on the manifest name, closes the span as errored, and rethrows", async () => {
            const cleanup = vi
                .spyOn(service, "cleanupFailedInstall")
                .mockResolvedValue(undefined as never);
            h.getCurrentVersion.mockRejectedValue(new Error("migration lookup exploded"));

            await expect(service.installCycleApp(7, MANIFEST)).rejects.toThrow("migration lookup exploded");

            expect(cleanup).toHaveBeenCalledWith(7, "Test Cycle");
            expect(h.finishSpan).toHaveBeenCalledWith(expect.any(String), "error");
        });

        it("still rethrows the original error when cleanup itself throws", async () => {
            vi.spyOn(service, "cleanupFailedInstall").mockRejectedValue(new Error("cleanup failed too"));
            h.getCurrentVersion.mockRejectedValue(new Error("original failure"));

            await expect(service.installCycleApp(7, MANIFEST)).rejects.toThrow("original failure");
        });
    });
});
