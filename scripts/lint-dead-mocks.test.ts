import { describe, expect, it } from "vitest";
import { auditSourceFile, targetBase } from "./lint-dead-mocks.js";

/**
 * The linter's own tests — a gate that reads green while checking nothing is
 * this repo's most repeated defect, so every form it claims to resolve is
 * pinned here, along with what it must leave alone.
 */
const repo = new Set([
    "server/domain/core/infrastructure/redis/redis-client.ts",
    "server/utils/logger.ts",
    "client/src/lib/api/index.ts",
    "server/domain/jobs/core/job.service.ts",
]);
const exists = (rel: string) => repo.has(rel);
const dead = (file: string, code: string) => auditSourceFile(file, code, exists).map((f) => f.specifier);

describe("lint:dead-mocks", () => {
    it("resolves aliases with a .js suffix to the .ts file, and directories to index", () => {
        expect(dead("server/x.test.ts", `vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({}));`)).toEqual([]);
        expect(dead("server/x.test.ts", `vi.mock("@/lib/api");`)).toEqual([]);
    });

    it("resolves relative paths from the test file's own directory", () => {
        expect(dead("server/domain/jobs/tests/job.test.ts", `vi.mock("../core/job.service.js");`)).toEqual([]);
        expect(dead("server/domain/jobs/tests/services/job.test.ts", `vi.mock("../../server/utils/logger.js");`))
            .toEqual(["../../server/utils/logger.js"]);
    });

    it("reports a renamed module, for vi.mock and vi.doMock", () => {
        expect(dead("server/x.test.ts", `vi.mock("@domain/core/infrastructure/redis.service.js", () => ({}));`))
            .toEqual(["@domain/core/infrastructure/redis.service.js"]);
        expect(dead("server/x.test.ts", `vi.doMock("@server/gone.js");`)).toEqual(["@server/gone.js"]);
    });

    it("leaves packages alone", () => {
        expect(dead("server/x.test.ts", `vi.mock("ioredis"); vi.mock("node:fs/promises"); vi.mock("@qdrant/js-client-rest");`))
            .toEqual([]);
        expect(targetBase("server/x.test.ts", "@qdrant/js-client-rest")).toBeNull();
    });
});
