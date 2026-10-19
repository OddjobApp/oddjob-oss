/**
 * SovereignWatchdog tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPublish, mockWatcher, mockWatch } = vi.hoisted(() => {
    const w = { on: vi.fn().mockReturnThis(), close: vi.fn() };
    return {
        mockPublish: vi.fn().mockResolvedValue("obs-1"),
        mockWatcher: w,
        mockWatch: vi.fn(() => w),
    };
});

vi.mock("chokidar", () => ({
    watch: mockWatch,
}));

vi.mock("@domain/governor/core/molt-producer.js", () => ({
    MoltProducer: vi.fn().mockImplementation(function (this: unknown) {
        return { publish: mockPublish };
    }),
}));

import { SovereignWatchdog } from "@domain/governor/core/watchdog.js";
import { MoltProducer } from "@domain/governor/core/molt-producer.js";

describe("SovereignWatchdog", () => {
    let watchdog: SovereignWatchdog;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPublish.mockResolvedValue("obs-1");
        watchdog = new SovereignWatchdog(new MoltProducer("s1") as any, "/tmp");
    });

    it("start creates watcher and registers handlers", () => {
        watchdog.start(["."]);
        expect(mockWatch).toHaveBeenCalledWith(["."], expect.objectContaining({ cwd: "/tmp", ignoreInitial: true }));
        expect(mockWatcher.on).toHaveBeenCalledWith("add", expect.any(Function));
        expect(mockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
        expect(mockWatcher.on).toHaveBeenCalledWith("unlink", expect.any(Function));
    });

    it("start is no-op when already monitoring", () => {
        watchdog.start(["."]);
        watchdog.start(["."]);
        expect(mockWatch).toHaveBeenCalledTimes(1);
    });

    it("stop closes watcher", () => {
        watchdog.start(["."]);
        watchdog.stop();
        expect(mockWatcher.close).toHaveBeenCalled();
    });
});
