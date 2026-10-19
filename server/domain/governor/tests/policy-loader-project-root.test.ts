import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures the rule rows the loader writes, so the test reads what would reach
// the database rather than the YAML on disk.
const insertedRules: any[] = [];

vi.mock("@server/database_service.js", () => {
    const tx = {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
        insert: () => ({
            values: (rows: any) => {
                if (Array.isArray(rows)) insertedRules.push(...rows);
                return { returning: async () => [{ id: 1 }] };
            },
        }),
        delete: () => ({ where: async () => undefined }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 1 }] }) }) }),
    };
    return { db: { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) } };
});

import { PolicyLoaderService } from "../core/policy-loader.service";

describe("PolicyLoaderService ${PROJECT_ROOT}", () => {
    beforeEach(() => {
        insertedRules.length = 0;
    });

    it("expands ${PROJECT_ROOT} in the shipped policy to this checkout", async () => {
        await new PolicyLoaderService().syncAllPolicies();

        const fileRule = insertedRules.find((r) => r.type === "file_path_restriction");
        expect(fileRule).toBeDefined();
        const root = process.cwd().replace(/\\/g, "/");
        expect(fileRule.configuration.allowedPaths).toContain(`${root}/**`);
        expect(JSON.stringify(insertedRules)).not.toContain("${PROJECT_ROOT}");
    });
});
