import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crossAppEventBus, CrossAppEventType } from "@server/domain/org/core/event-bus.service.js";

describe("Cross-App Event Bus", () => {
    beforeEach(() => {
        // Clear event history before each test
        crossAppEventBus.clearEventHistory(1);
    });

    afterEach(() => {
        // Clean up after each test
        crossAppEventBus.clearEventHistory(1);
    });

    it("should publish and receive events", async () => {
        let receivedEvent: any = null;

        crossAppEventBus.subscribe(CrossAppEventType.TEST_FAILED, (event) => {
            receivedEvent = event;
        });

        await crossAppEventBus.publish({
            type: CrossAppEventType.TEST_FAILED,
            organizationId: 1,
            sourceApp: "qa_workbench",
            payload: {
                testName: "test_case_1",
                failureReason: "Assertion failed",
            },
        });

        expect(receivedEvent).toBeTruthy();
        expect(receivedEvent.type).toBe(CrossAppEventType.TEST_FAILED);
        expect(receivedEvent.payload.testName).toBe("test_case_1");
    });

    it("should register and call event handlers", async () => {
        let handlerCalled = false;

        crossAppEventBus.registerHandler({
            eventType: CrossAppEventType.STORY_BLOCKED,
            handler: async (event) => {
                handlerCalled = true;
                expect(event.payload.storyId).toBe("story_1");
            },
        });

        await crossAppEventBus.publish({
            type: CrossAppEventType.STORY_BLOCKED,
            organizationId: 1,
            sourceApp: "scrum_master_workbench",
            payload: {
                storyId: "story_1",
                blockerReason: "Waiting for approval",
            },
        });

        expect(handlerCalled).toBe(true);
    });

    it("should filter events based on handler filter", async () => {
        let handlerCalled = false;

        crossAppEventBus.registerHandler({
            eventType: CrossAppEventType.DEPLOYMENT_FAILED,
            handler: async (event) => {
                handlerCalled = true;
            },
            filter: (event) => {
                return event.metadata?.priority === "critical";
            },
        });

        await crossAppEventBus.publish({
            type: CrossAppEventType.DEPLOYMENT_FAILED,
            organizationId: 1,
            sourceApp: "deployment_service",
            payload: {
                deploymentId: "deploy_1",
                failureReason: "Build failed",
            },
            metadata: {
                priority: "low",
            },
        });

        expect(handlerCalled).toBe(false);
    });

    it("should maintain event history", async () => {
        await crossAppEventBus.publish({
            type: CrossAppEventType.REQUIREMENT_CREATED,
            organizationId: 1,
            sourceApp: "pm_workbench",
            payload: {
                requirementId: "req_1",
                requirementTitle: "Test Requirement",
            },
        });

        const history = crossAppEventBus.getEventHistory(1, 10);

        expect(history.length).toBeGreaterThan(0);
        expect(history[0].type).toBe(CrossAppEventType.REQUIREMENT_CREATED);
    });

    it("should get events by type", async () => {
        await crossAppEventBus.publish({
            type: CrossAppEventType.TEST_FAILED,
            organizationId: 1,
            sourceApp: "qa_workbench",
            payload: { testName: "test_1" },
        });

        await crossAppEventBus.publish({
            type: CrossAppEventType.TEST_PASSED,
            organizationId: 1,
            sourceApp: "qa_workbench",
            payload: { testName: "test_2" },
        });

        const testFailedEvents = crossAppEventBus.getEventsByType(1, CrossAppEventType.TEST_FAILED, 10);

        expect(testFailedEvents.length).toBe(1);
        expect(testFailedEvents[0].type).toBe(CrossAppEventType.TEST_FAILED);
    });

    it("should clear event history", async () => {
        await crossAppEventBus.publish({
            type: CrossAppEventType.SPRINT_STARTED,
            organizationId: 1,
            sourceApp: "scrum_master_workbench",
            payload: { sprintId: "sprint_1" },
        });

        crossAppEventBus.clearEventHistory(1);

        const history = crossAppEventBus.getEventHistory(1, 10);

        expect(history.length).toBe(0);
    });
});
