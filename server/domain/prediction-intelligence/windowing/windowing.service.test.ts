import { describe, it, expect } from "vitest";
import { windowingService } from "./windowing.service.js";
import type { WindowConfig } from "./types.js";

describe("WindowingService", () => {
    it("should create a window", async () => {
        const config: WindowConfig = {
            type: "rolling",
            maxEvents: 10
        };

        const window = await windowingService.createWindow("context-123", config);
        
        expect(window).toBeDefined();
        expect(window.id).toBeDefined();
        expect(window.type).toBe("rolling");
        expect(window.contextId).toBe("context-123");
    });

    it("should get active windows for a context", async () => {
        await windowingService.createWindow("context-abc", { type: "session" });
        
        const active = await windowingService.getActiveWindows("context-abc");
        
        expect(active.length).toBeGreaterThan(0);
        expect(active[0].contextId).toBe("context-abc");
    });

    it("should add event to active windows", async () => {
        const window = await windowingService.createWindow("context-xyz", { type: "episode" });
        
        const windowIds = await windowingService.addEvent("event-123", "context-xyz", new Date().toISOString());
        
        expect(windowIds).toContain(window.id);
    });

    it("should close window when max events reached", async () => {
        const window = await windowingService.createWindow("context-limit", { type: "rolling", maxEvents: 1 });
        
        await windowingService.addEvent("event-1", "context-limit", new Date().toISOString());
        
        const active = await windowingService.getActiveWindows("context-limit");
        expect(active.find(w => w.id === window.id)).toBeUndefined(); // Should be closed
    });
});
