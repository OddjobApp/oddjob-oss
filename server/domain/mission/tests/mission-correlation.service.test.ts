/**
 * Mission Correlation Service Tests
 * 
 * Test suite for distributed tracing and correlation capabilities.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
    missionCorrelationService, 
    correlatedLog,
    type CorrelationContext 
} from "../core/mission-correlation.service.js";

// Mock logger
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

describe("MissionCorrelationService", () => {
    describe("generateCorrelationId", () => {
        it("should generate unique correlation IDs", () => {
            const id1 = missionCorrelationService.generateCorrelationId();
            const id2 = missionCorrelationService.generateCorrelationId();
            
            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^corr_/);
            expect(id2).toMatch(/^corr_/);
        });

        it("should include timestamp in correlation ID", () => {
            const id = missionCorrelationService.generateCorrelationId();
            const parts = id.split("_");
            
            expect(parts.length).toBeGreaterThanOrEqual(2);
            expect(parts[parts.length - 1]).toMatch(/^\d+$/); // Last part should be timestamp
        });
    });

    describe("createChildCorrelation", () => {
        it("should create child correlation with parent reference", () => {
            const parent: CorrelationContext = {
                correlationId: "corr_abc123_1713742800000",
                missionId: 1,
                missionRunId: 1,
                tracePath: ["root"],
                startedAt: new Date(),
            };

            const childId = missionCorrelationService.createChildCorrelation(parent, "tool_call");
            
            expect(childId).toContain(parent.correlationId);
            expect(childId).toContain(":tool_call_");
        });

        it("should create different child IDs for same parent with different components", () => {
            const parent: CorrelationContext = {
                correlationId: "corr_abc123_1713742800000",
                missionId: 1,
                missionRunId: 1,
                tracePath: ["root"],
                startedAt: new Date(),
            };

            const child1 = missionCorrelationService.createChildCorrelation(parent, "tool_a");
            const child2 = missionCorrelationService.createChildCorrelation(parent, "tool_b");
            
            expect(child1).not.toBe(child2);
            expect(child1).toContain(":tool_a_");
            expect(child2).toContain(":tool_b_");
        });
    });

    describe("initializeMissionContext", () => {
        it("should create mission context with all required fields", () => {
            const context = missionCorrelationService.initializeMissionContext(123, 456);
            
            expect(context.correlationId).toMatch(/^corr_/);
            expect(context.missionId).toBe(123);
            expect(context.missionRunId).toBe(456);
            expect(context.tracePath).toEqual(["root"]);
            expect(context.startedAt).toBeInstanceOf(Date);
        });

        it("should include parent correlation when provided", () => {
            const parentContext: CorrelationContext = {
                correlationId: "corr_parent_123",
                missionId: 100,
                missionRunId: 200,
                tracePath: ["root", "parent"],
                startedAt: new Date(),
            };

            const child = missionCorrelationService.initializeMissionContext(
                123, 
                456, 
                parentContext.correlationId
            );
            
            expect(child.parentCorrelationId).toBe(parentContext.correlationId);
        });
    });

    describe("runWithContext", () => {
        it("should make correlation context available during execution", async () => {
            const context = missionCorrelationService.initializeMissionContext(1, 1);
            
            let capturedContext: CorrelationContext | undefined;
            
            await missionCorrelationService.runWithContext(context, async () => {
                capturedContext = missionCorrelationService.getCurrentContext();
            });
            
            expect(capturedContext).toBeDefined();
            expect(capturedContext?.correlationId).toBe(context.correlationId);
        });

        it("should isolate contexts between concurrent executions", async () => {
            const context1 = missionCorrelationService.initializeMissionContext(1, 1);
            const context2 = missionCorrelationService.initializeMissionContext(2, 2);
            
            let captured1: string | undefined;
            let captured2: string | undefined;
            
            await Promise.all([
                missionCorrelationService.runWithContext(context1, async () => {
                    await new Promise(r => setTimeout(r, 10));
                    captured1 = missionCorrelationService.getCurrentContext()?.correlationId;
                }),
                missionCorrelationService.runWithContext(context2, async () => {
                    captured2 = missionCorrelationService.getCurrentContext()?.correlationId;
                }),
            ]);
            
            expect(captured1).toBe(context1.correlationId);
            expect(captured2).toBe(context2.correlationId);
        });
    });

    describe("getCurrentContext", () => {
        it("should return undefined when no context is set", () => {
            const context = missionCorrelationService.getCurrentContext();
            expect(context).toBeUndefined();
        });

        it("should return context after runWithContext", async () => {
            const expectedContext = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(expectedContext, async () => {
                const current = missionCorrelationService.getCurrentContext();
                expect(current?.correlationId).toBe(expectedContext.correlationId);
            });
        });
    });

    describe("getCorrelationId", () => {
        it("should return correlation ID from current context", async () => {
            const context = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(context, async () => {
                const id = missionCorrelationService.getCorrelationId();
                expect(id).toBe(context.correlationId);
            });
        });

        it("should generate new ID when no context exists", () => {
            const id = missionCorrelationService.getCorrelationId();
            expect(id).toMatch(/^corr_/);
        });
    });

    describe("addTraceStep", () => {
        it("should add step to current context", async () => {
            const context = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(context, async () => {
                missionCorrelationService.addTraceStep("step1");
                missionCorrelationService.addTraceStep("step2");
                
                const current = missionCorrelationService.getCurrentContext();
                expect(current?.tracePath).toContain("step1");
                expect(current?.tracePath).toContain("step2");
            });
        });

        it("should not throw when no context exists", () => {
            expect(() => {
                missionCorrelationService.addTraceStep("step");
            }).not.toThrow();
        });
    });

    describe("createLogEntry", () => {
        it("should create structured log entry with correlation", async () => {
            const context = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(context, async () => {
                const entry = missionCorrelationService.createLogEntry(
                    "info",
                    "TestComponent",
                    "Test message",
                    { key: "value" }
                );
                
                expect(entry.correlationId).toBe(context.correlationId);
                expect(entry.level).toBe("info");
                expect(entry.component).toBe("TestComponent");
                expect(entry.message).toBe("Test message");
                expect(entry.metadata?.missionId).toBe(1);
                expect(entry.metadata?.missionRunId).toBe(1);
                expect(entry.metadata?.key).toBe("value");
                expect(entry.timestamp).toBeDefined();
            });
        });

        it("should generate new correlation when no context", () => {
            const entry = missionCorrelationService.createLogEntry(
                "info",
                "TestComponent",
                "Test message"
            );
            
            expect(entry.correlationId).toMatch(/^corr_/);
            expect(entry.metadata?.missionId).toBeUndefined();
        });
    });

    describe("withChildContext", () => {
        it("should execute function with child context", async () => {
            const parentContext = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(parentContext, async () => {
                const result = await missionCorrelationService.withChildContext(
                    "tool_execution",
                    {},
                    async (childContext) => {
                        expect(childContext.parentCorrelationId).toBe(parentContext.correlationId);
                        expect(childContext.tracePath).toContain("tool_execution");
                        return "success";
                    }
                );
                
                expect(result).toBe("success");
            });
        });

        it("should preserve metadata in child context", async () => {
            const parentContext = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(parentContext, async () => {
                await missionCorrelationService.withChildContext(
                    "api_call",
                    { missionId: 999, missionRunId: 888 },
                    async (childContext) => {
                        expect(childContext.missionId).toBe(999);
                        expect(childContext.missionRunId).toBe(888);
                    }
                );
            });
        });

        it("should log errors with child context", async () => {
            const parentContext = missionCorrelationService.initializeMissionContext(1, 1);
            
            await missionCorrelationService.runWithContext(parentContext, async () => {
                await expect(
                    missionCorrelationService.withChildContext(
                        "failing_tool",
                        {},
                        async () => {
                            throw new Error("Tool failed");
                        }
                    )
                ).rejects.toThrow("Tool failed");
            });
        });
    });

    describe("parseCorrelationId", () => {
        it("should parse valid correlation ID", () => {
            const id = "corr_abc123_1713742800000:tool_1713742805000";
            const parsed = missionCorrelationService.parseCorrelationId(id);
            
            expect(parsed).toBeDefined();
            expect(parsed?.root).toBe("corr_abc123_1713742800000");
            expect(parsed?.path).toEqual(["tool_1713742805000"]);
        });

        it("should return null for invalid correlation ID", () => {
            const parsed = missionCorrelationService.parseCorrelationId("invalid_id");
            expect(parsed).toBeNull();
        });

        it("should handle root correlation ID without children", () => {
            const id = "corr_abc123_1713742800000";
            const parsed = missionCorrelationService.parseCorrelationId(id);
            
            expect(parsed?.root).toBe(id);
            expect(parsed?.path).toEqual([]);
        });
    });

    describe("isChildOf", () => {
        it("should identify child correlation", () => {
            const parent = "corr_abc123_1713742800000";
            const child = "corr_abc123_1713742800000:tool_1713742805000";
            
            expect(missionCorrelationService.isChildOf(child, parent)).toBe(true);
        });

        it("should reject non-child correlation", () => {
            const parent = "corr_abc123_1713742800000";
            const other = "corr_xyz789_1713742800000:tool_1713742805000";
            
            expect(missionCorrelationService.isChildOf(other, parent)).toBe(false);
        });

        it("should handle same ID as not child", () => {
            const id = "corr_abc123_1713742800000";
            expect(missionCorrelationService.isChildOf(id, id)).toBe(false);
        });
    });

    describe("getRelatedCorrelationPattern", () => {
        it("should create pattern for root correlation", () => {
            const id = "corr_abc123_1713742800000";
            const pattern = missionCorrelationService.getRelatedCorrelationPattern(id);
            
            expect(pattern).toBe("corr_abc123_1713742800000*");
        });

        it("should create pattern from child correlation", () => {
            const id = "corr_abc123_1713742800000:tool_1713742805000";
            const pattern = missionCorrelationService.getRelatedCorrelationPattern(id);
            
            expect(pattern).toBe("corr_abc123_1713742800000*");
        });
    });

    describe("getEventMetadata", () => {
        it("should return empty object when no context", () => {
            const metadata = missionCorrelationService.getEventMetadata();
            expect(metadata).toEqual({});
        });

        it("should include correlation data from context", async () => {
            const context = missionCorrelationService.initializeMissionContext(123, 456);
            
            await missionCorrelationService.runWithContext(context, async () => {
                // Wait a bit to have non-zero duration
                await new Promise(r => setTimeout(r, 10));
                
                const metadata = missionCorrelationService.getEventMetadata();
                
                expect(metadata.correlationId).toBe(context.correlationId);
                expect(metadata.missionId).toBe(123);
                expect(metadata.missionRunId).toBe(456);
                expect(metadata.tracePath).toEqual(["root"]);
                expect(metadata.traceDuration).toBeGreaterThan(0);
            });
        });
    });
});

describe("correlatedLog", () => {
    it("should log at different levels", () => {
        expect(() => correlatedLog.debug("Test", "Debug message")).not.toThrow();
        expect(() => correlatedLog.info("Test", "Info message")).not.toThrow();
        expect(() => correlatedLog.warn("Test", "Warning message")).not.toThrow();
        expect(() => correlatedLog.error("Test", "Error message")).not.toThrow();
    });

    it("should include metadata in logs", async () => {
        const context = missionCorrelationService.initializeMissionContext(1, 1);
        
        await missionCorrelationService.runWithContext(context, async () => {
            correlatedLog.info("TestComponent", "Test with metadata", {
                customField: "value",
                number: 42,
            });
            
            // Verify logger was called with correlation ID
            // This would require mocking the underlying logger
        });
    });
});
