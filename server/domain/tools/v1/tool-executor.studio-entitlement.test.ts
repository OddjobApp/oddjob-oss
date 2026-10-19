/** @vitest-environment node */

/**
 * Wiring test for the Studio Marketplace entitlement gate in ToolExecutor.
 *
 * The gate lives in ToolExecutor so individual mount-tool unit tests do not
 * need a database, but that means the wiring itself needs coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const isEnabled = vi.fn();

vi.mock("@server/domain/studio-marketplace/core/studio-entitlement.service.js", () => ({
    studioEntitlementService: { isEnabled },
    getGatedStudioKindForTool: (toolName: string) => {
        const map: Record<string, string> = {
            mount_media_studio: "media",
            mount_prediction_studio: "prediction",
            mount_computer_studio: "computer",
            mount_signal_studio: "signal",
        };
        return map[toolName];
    },
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

vi.mock("@domain/capabilities/core/capability-gap-event.service.js", () => ({
    recordCapabilityGap: vi.fn(),
}));

const { ToolExecutor } = await import("./tool-executor.service.js");

const context = { organizationId: 42, userId: "u-1", missionId: 7, executionId: 99 } as any;

beforeEach(() => {
    isEnabled.mockReset();
    getAgentTools.mockReset();
});

describe("Studio Marketplace entitlement gate", () => {
    it("blocks a gated mount tool when the org has not enabled the studio", async () => {
        const tool = { name: "mount_prediction_studio", execute: vi.fn(async () => "ok") };
        getAgentTools.mockReturnValue({ mount_prediction_studio: tool });
        isEnabled.mockResolvedValue(false);

        const out = await ToolExecutor.execute(
            "mount_prediction_studio",
            {},
            context,
            [tool],
            false,
            "none" as any,
        );

        expect(isEnabled).toHaveBeenCalledWith(42, "prediction");
        expect(tool.execute).not.toHaveBeenCalled();
        expect(out).toMatch(/Prediction Studio is not enabled/);
        expect(out).toMatch(/Studio Marketplace/);
    });

    it("allows a gated mount tool when the org has enabled the studio", async () => {
        const tool = { name: "mount_media_studio", execute: vi.fn(async () => "ok") };
        getAgentTools.mockReturnValue({ mount_media_studio: tool });
        isEnabled.mockResolvedValue(true);

        await ToolExecutor.execute("mount_media_studio", {}, context, [tool], true, "none" as any).catch(() => {});

        expect(isEnabled).toHaveBeenCalledWith(42, "media");
        expect(tool.execute).toHaveBeenCalled();
    });

    it("does not query entitlements for non-studio tools", async () => {
        const tool = { name: "file_read", execute: vi.fn(async () => "ok") };
        getAgentTools.mockReturnValue({ file_read: tool });

        await ToolExecutor.execute("file_read", {}, context, [tool], true, "none" as any).catch(() => {});

        expect(isEnabled).not.toHaveBeenCalled();
    });
});
