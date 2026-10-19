import { describe, it, expect, vi, beforeEach } from "vitest";
import { SeleniumRunner } from "../../../mission/selenium/runner.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";

// Mock eventStream.publish
vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined)
    }
}));

// Mock Strategy to avoid launching a real browser
vi.mock("../../../mission/selenium/strategies/local.js", () => ({
    LocalBrowserStrategy: class {
        init = vi.fn().mockResolvedValue({
            page: {
                goto: vi.fn().mockResolvedValue(undefined),
                click: vi.fn().mockResolvedValue(undefined),
                fill: vi.fn().mockResolvedValue(undefined),
                screenshot: vi.fn().mockResolvedValue("mock-base64"),
                context: () => ({
                    addCookies: vi.fn(),
                    cookies: vi.fn().mockResolvedValue([])
                }),
                evaluate: vi.fn().mockResolvedValue("mock-domain")
            },
            cleanup: vi.fn().mockResolvedValue(undefined)
        });
    }
}));

describe("Selenium Runner Event Emission", () => {
    let runner: SeleniumRunner;

    beforeEach(() => {
        runner = new SeleniumRunner();
        vi.clearAllMocks();
    });

    it.skip("should emit selenium.step_completed events for each step", async () => {
        const config: any = {
            jobId: 42,
            steps: [
                { action: "goto", value: "https://example.com" },
                { action: "click", selector: "button#submit" }
            ],
            liveStreamScreenshots: true
        };

        const context: any = {};
        await runner.execute(config, context);

        // Check if events were published
        expect(eventStream.publish).toHaveBeenCalledTimes(2);
        
        // Check first event
        expect(eventStream.publish).toHaveBeenNthCalledWith(
            1,
            "selenium.step_completed",
            expect.objectContaining({
                action: "goto",
                success: true,
                screenshot: "mock-base64"
            }),
            expect.objectContaining({
                subject: "selenium-run:42"
            }),
            undefined // default origin not specified in publish call
        );
    });

    it.skip("should emit error events when a step fails", async () => {
        const config: any = {
            jobId: 43,
            steps: [
                { action: "click", selector: "invalid-selector" }
            ],
            screenshotOnError: true
        };

        // Mock failure
        const { LocalBrowserStrategy } = await import("../../../mission/selenium/strategies/local.js");
        const mockPage = (new LocalBrowserStrategy() as any).init().then((r: any) => r.page);
        (await mockPage).click.mockRejectedValue(new Error("Selector not found"));

        const context: any = {};
        await runner.execute(config, context);

        expect(eventStream.publish).toHaveBeenCalledWith(
            "selenium.step_completed",
            expect.objectContaining({
                action: "click",
                success: false,
                error: "Error: Selector not found"
            }),
            expect.objectContaining({
                subject: "selenium-run:43"
            }),
            undefined
        );
    });
});
