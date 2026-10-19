// @vitest-environment node
/**
 * A test set may only name a job or mission its own org may use. Running a set
 * chats with its job, and agentService.chat adopts the JOB's organization, so a
 * foreign job id would run another tenant's agent and file the answers here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
    const selects: unknown[][] = [];
    const inserts: unknown[] = [];
    const chain = (result: unknown) => {
        const c: any = {};
        for (const m of ["from", "where", "limit", "orderBy", "leftJoin"]) c[m] = () => c;
        c.values = (v: unknown) => { inserts.push(v); return c; };
        c.returning = () => Promise.resolve([{ id: 42 }]);
        c.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
        return c;
    };
    const db = {
        select: () => chain(selects.shift() ?? []),
        insert: () => chain([]),
    };
    return { selects, inserts, db };
});

vi.mock("@server/database_service.js", () => ({ db: fake.db }));
const chat = vi.hoisted(() => vi.fn());
vi.mock("@domain/agents/agent.service.js", () => ({ agentService: { chat } }));
vi.mock("@domain/ai/core/ai-client.service.js", () => ({ AIClientFactory: {} }));
vi.mock("@domain/ai/core/system-ai.service.js", () => ({ systemAiService: {} }));
vi.mock("@domain/ai/core/fine-tuning.service.js", () => ({ fineTuningService: {} }));

import { evaluationStudioService, jobUsableByOrg } from "./evaluation-studio.service";
import { evaluationService } from "./evaluation.service";

beforeEach(() => {
    fake.selects.length = 0;
    fake.inserts.length = 0;
    chat.mockReset();
});

describe("jobUsableByOrg", () => {
    it.each([
        ["the caller's own job", [{ organizationId: 5 }], true],
        ["a shared job with no org", [{ organizationId: null }], true],
        ["another org's job", [{ organizationId: 9 }], false],
        ["a job that does not exist", [], false],
    ])("%s", async (_label, row, expected) => {
        fake.selects.push(row);
        expect(await jobUsableByOrg(1, 5)).toBe(expected);
    });
});

describe("createTestSet", () => {
    it("refuses another org's job and writes nothing", async () => {
        fake.selects.push([{ organizationId: 9 }]);
        const result = await evaluationStudioService.createTestSet(5, { jobId: 7 });
        expect(result).toEqual({ ok: false, failure: "job-not-found" });
        expect(fake.inserts).toEqual([]);
    });

    it("refuses another org's mission and writes nothing", async () => {
        fake.selects.push([{ organizationId: 9 }]);
        const result = await evaluationStudioService.createTestSet(5, { missionId: 3 });
        expect(result).toEqual({ ok: false, failure: "mission-not-found" });
        expect(fake.inserts).toEqual([]);
    });

    it("stores a set naming the caller's own job, stamped with the caller's org", async () => {
        fake.selects.push([{ organizationId: 5 }]);
        const result = await evaluationStudioService.createTestSet(5, { name: "n", jobId: 7 });
        expect(result.ok).toBe(true);
        expect(fake.inserts).toEqual([expect.objectContaining({ organizationId: 5, jobId: 7 })]);
    });
});

describe("evaluationService.runTestSet", () => {
    it("refuses a set saved before the create-time check that names another org's job", async () => {
        fake.selects.push([{ id: 1, organizationId: 5, jobId: 7 }], [{ organizationId: 9 }]);
        await expect(evaluationService.runTestSet(1, 5)).rejects.toThrow(/not available in this organization/);
        expect(fake.inserts).toEqual([]); // no evaluation run row
        expect(chat).not.toHaveBeenCalled();
    });
});
