import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wiring test for the capability-gap guard.
 *
 * The emitter's own behaviour is unit-tested next to it. What is NOT covered
 * there is the part most likely to rot: that the guard in `ToolExecutor.execute`
 * actually calls it, with the two booleans derived correctly. That wiring is a
 * single unawaited call inside an early return — the easiest thing in the file
 * to delete by accident, and its absence looks exactly like normal operation.
 *
 * Both branches matter, and they are different findings:
 *   - tool absent from the registry    -> registryHit false -> "missing"
 *   - tool present but not in allotment -> registryHit true  -> "unavailable"
 */

const recordCapabilityGap = vi.fn(async (_input: Record<string, unknown>) => {});

vi.mock("@domain/capabilities/core/capability-gap-event.service.js", () => ({
    recordCapabilityGap,
}));

const getAgentTools = vi.fn(() => ({} as Record<string, any>));

vi.mock("./tool-registry.service.js", () => ({
    getAgentTools: () => getAgentTools(),
    normalizeToolName: (n: string) => n,
    normalizeToolArguments: (_n: string, a: any) => a,
}));

vi.mock("@domain/core/infrastructure/tracing/trace-logger.service.js", () => ({
    logForensicEvent: vi.fn(),
    getMonotonicTimeNs: () => 0n,
}));

const { ToolExecutor } = await import("./tool-executor.service.js");

const context = { organizationId: 42, userId: "u-1", missionId: 7, executionId: 99 } as any;

/** Waits for the unawaited fire-and-forget emit to settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    recordCapabilityGap.mockClear();
    getAgentTools.mockReset();
});

describe("capability-gap emission from the tool guard", () => {
    it("records a 'missing' gap when the tool is not in the registry", async () => {
        getAgentTools.mockReturnValue({});

        const out = await ToolExecutor.execute("jira_create_issue", {}, context, [], false, "none" as any);
        await settle();

        expect(recordCapabilityGap).toHaveBeenCalledTimes(1);
        expect(recordCapabilityGap.mock.calls[0][0]).toMatchObject({
            organizationId: 42,
            requestedToolName: "jira_create_issue",
            canonicalToolName: null,
            registryHit: false,
            allotmentHit: false,
        });
        expect(out).toMatch(/not found or not allowed/);
    });

    it("records an 'unavailable' gap when the tool exists but is outside the allotment", async () => {
        getAgentTools.mockReturnValue({ file_write: { name: "file_write" } });

        // Registry has it; the run's permitted list does not.
        await ToolExecutor.execute("file_write", {}, context, [], false, "none" as any);
        await settle();

        expect(recordCapabilityGap.mock.calls[0][0]).toMatchObject({
            requestedToolName: "file_write",
            canonicalToolName: "file_write",
            registryHit: true,
            allotmentHit: false,
        });
    });

    it("carries run identity for per-run deduplication", async () => {
        getAgentTools.mockReturnValue({});
        await ToolExecutor.execute("nope", {}, context, [], false, "none" as any);
        await settle();

        expect(recordCapabilityGap.mock.calls[0][0]).toMatchObject({ missionId: 7, executionId: 99 });
    });

    // §6.3's user_impact_score counts DISTINCT affected users; the id is hashed
    // at the emitter so the count is possible without recording who they were.
    it("passes the acting user through for the distinct-user count", async () => {
        getAgentTools.mockReturnValue({});
        await ToolExecutor.execute("nope", {}, context, [], false, "none" as any);
        await settle();

        expect(recordCapabilityGap.mock.calls[0][0]).toMatchObject({ userId: "u-1" });
    });

    it("emits nothing when the tool is present and permitted", async () => {
        const tool = { name: "file_read", execute: vi.fn(async () => "ok") };
        getAgentTools.mockReturnValue({ file_read: tool });

        await ToolExecutor.execute("file_read", {}, context, [tool], true, "none" as any).catch(() => {});
        await settle();

        expect(recordCapabilityGap).not.toHaveBeenCalled();
    });

    // A capability gap is an observation about a failure, not a new one.
    it("still returns the guard string when the emitter throws", async () => {
        getAgentTools.mockReturnValue({});
        recordCapabilityGap.mockImplementationOnce(async () => {
            throw new Error("db down");
        });

        const out = await ToolExecutor.execute("nope", {}, context, [], false, "none" as any);
        await settle();

        expect(out).toMatch(/not found or not allowed/);
    });

    it("does not block the guard's return on the write", async () => {
        getAgentTools.mockReturnValue({});
        let resolveWrite: () => void = () => {};
        recordCapabilityGap.mockImplementationOnce(
            () => new Promise<void>(r => { resolveWrite = () => r(); }) as any,
        );

        // Returns while the write is still pending.
        const out = await ToolExecutor.execute("nope", {}, context, [], false, "none" as any);
        expect(out).toMatch(/not found or not allowed/);
        resolveWrite();
    });
});
