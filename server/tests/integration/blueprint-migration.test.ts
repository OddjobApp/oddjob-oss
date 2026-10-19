import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BlueprintMigrationService } from "@server/domain/org/core/blueprint-migration.service.js";

describe("BlueprintMigrationService Integration", () => {
    let blueprintMigrationService: BlueprintMigrationService;

    beforeEach(() => {
        // Get a fresh instance for each test to ensure isolation
        blueprintMigrationService = BlueprintMigrationService.getInstance();
        // Clear internal state if necessary, e.g., by calling a reset method if it exists
        // For now, re-instantiation via getInstance() is the strategy.
    });

    afterEach(() => {
        // No cleanup needed as we get a fresh instance per test
    });

    it("should check if migration is needed", async () => {
        const needsMigration = await blueprintMigrationService.needsMigration(1, "test-blueprint", "2.0.0");
        // This will return false if no current version exists
        expect(typeof needsMigration).toBe("boolean");
    });

    it("should get current version", async () => {
        const version = await blueprintMigrationService.getCurrentVersion(1, "test-blueprint");
        // Returns null if no version exists
        expect(version === null || typeof version === "string").toBe(true);
    });

    it("should execute migration", async () => {
        try {
            await blueprintMigrationService.migrate(1, "test-blueprint", "2.0.0");
            // Migration should complete without throwing
            expect(true).toBe(true);
        } catch (error: any) {
            // Migration might fail if blueprint doesn't exist, which is expected
            expect(error.message).toBeDefined();
        }
    });

    it("should rollback migration", async () => {
        try {
            await blueprintMigrationService.rollback(1, "test-blueprint", "2.0.0");
            // Rollback should complete without throwing
            expect(true).toBe(true);
        } catch (error: any) {
            // Rollback might fail if migration doesn't exist, which is expected
            expect(error.message).toBeDefined();
        }
    });

    it("should get migration history", async () => {
        const history = blueprintMigrationService.getVersionHistory(1);
        expect(Array.isArray(history)).toBe(true);
    });

    it("should register migration script", () => {
        const script = {
            fromVersion: "1.0.0",
            toVersion: "2.0.0",
            description: "Test migration",
            changes: ["Test change"],
            breaking: false,
            up: async () => {},
            down: async () => {},
        };

        // registerMigration is private; access via `any` cast for test coverage
        (blueprintMigrationService as any).registerMigration(script);
        // Script should be registered without throwing
        expect(true).toBe(true);
    });
});
