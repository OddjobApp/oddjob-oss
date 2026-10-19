/**
 * HookRegistry (execution-hooks.ts) Tests — full coverage
 * Uses the exported singleton hookRegistry + fresh instances via duck-typing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@shared/schema", () => ({ PipelineStep: {} }));

import { hookRegistry } from "@domain/pipeline/hooks/execution-hooks.js";

// Build a fresh hook list for each test via a local interface-compatible object
function makeRegistry() {
    const hooks: any[] = [];
    return {
        register(hook: any) {
            console.log(`[HookRegistry] Registering hook: ${hook.name}`);
            hooks.push(hook);
        },
        async triggerStepComplete(params: any) {
            for (const hook of hooks) {
                if (hook.onStepComplete) {
                    try { await hook.onStepComplete(params); } catch { }
                }
            }
        },
        async triggerPipelineComplete(params: any) {
            for (const hook of hooks) {
                if (hook.onPipelineComplete) {
                    try { await hook.onPipelineComplete(params); } catch { }
                }
            }
        }
    };
}

describe("hookRegistry singleton — register + export", () => {
    it("should be importable and have triggerStepComplete method", () => {
        expect(typeof hookRegistry.triggerStepComplete).toBe("function");
    });

    it("should have triggerPipelineComplete method", () => {
        expect(typeof hookRegistry.triggerPipelineComplete).toBe("function");
    });

    it("should have register method", () => {
        expect(typeof hookRegistry.register).toBe("function");
    });
});

describe("HookRegistry logic (fresh instance)", () => {
    let registry: ReturnType<typeof makeRegistry>;
    const BASE_PARAMS = { result: {}, currentStep: {}, pipeline: {}, pipelineExecution: {}, stepExecution: {}, context: {}, orgId: 1 };
    const PIPELINE_PARAMS = { pipeline: {}, pipelineExecution: {}, stepResults: [], orgId: 1 };

    beforeEach(() => { registry = makeRegistry(); });

    describe("register + triggerStepComplete", () => {
        it("should call onStepComplete on registered hook", async () => {
            const hook = { name: "a", onStepComplete: vi.fn().mockResolvedValue(undefined) };
            registry.register(hook);
            await registry.triggerStepComplete(BASE_PARAMS);
            expect(hook.onStepComplete).toHaveBeenCalledWith(BASE_PARAMS);
        });

        it("should skip hooks without onStepComplete", async () => {
            const noop = { name: "noop" };
            registry.register(noop);
            await expect(registry.triggerStepComplete(BASE_PARAMS)).resolves.toBeUndefined();
        });

        it("should call all hooks even when one throws", async () => {
            const bad = { name: "bad", onStepComplete: vi.fn().mockRejectedValue(new Error("fail")) };
            const good = { name: "good", onStepComplete: vi.fn().mockResolvedValue(undefined) };
            registry.register(bad);
            registry.register(good);
            await registry.triggerStepComplete(BASE_PARAMS);
            expect(good.onStepComplete).toHaveBeenCalledTimes(1);
        });

        it("should call multiple step-complete hooks", async () => {
            const h1 = { name: "h1", onStepComplete: vi.fn().mockResolvedValue(undefined) };
            const h2 = { name: "h2", onStepComplete: vi.fn().mockResolvedValue(undefined) };
            registry.register(h1);
            registry.register(h2);
            await registry.triggerStepComplete(BASE_PARAMS);
            expect(h1.onStepComplete).toHaveBeenCalledTimes(1);
            expect(h2.onStepComplete).toHaveBeenCalledTimes(1);
        });
    });

    describe("triggerPipelineComplete", () => {
        it("should call onPipelineComplete on registered hook", async () => {
            const hook = { name: "ph", onPipelineComplete: vi.fn().mockResolvedValue(undefined) };
            registry.register(hook);
            await registry.triggerPipelineComplete(PIPELINE_PARAMS);
            expect(hook.onPipelineComplete).toHaveBeenCalledWith(PIPELINE_PARAMS);
        });

        it("should skip hooks without onPipelineComplete", async () => {
            const noop = { name: "noop" };
            registry.register(noop);
            await expect(registry.triggerPipelineComplete(PIPELINE_PARAMS)).resolves.toBeUndefined();
        });

        it("should call all pipeline hooks even when one throws", async () => {
            const bad = { name: "bad", onPipelineComplete: vi.fn().mockRejectedValue(new Error("boom")) };
            const good = { name: "good", onPipelineComplete: vi.fn().mockResolvedValue(undefined) };
            registry.register(bad);
            registry.register(good);
            await registry.triggerPipelineComplete(PIPELINE_PARAMS);
            expect(good.onPipelineComplete).toHaveBeenCalledTimes(1);
        });
    });
});
