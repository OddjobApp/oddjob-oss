import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { performanceOptimizationService } from "@server/domain/org/core/performance-optimization.service.js";

describe("PerformanceOptimizationService", () => {
    beforeEach(() => {
        performanceOptimizationService.clear();
    });

    afterEach(() => {
        performanceOptimizationService.clear();
    });

    it("should set and get value from cache", () => {
        performanceOptimizationService.set("test_key", "test_value", 60);
        const value = performanceOptimizationService.get("test_key");
        expect(value).toBe("test_value");
    });

    it("should return null for non-existent cache key", () => {
        const value = performanceOptimizationService.get("non_existent");
        expect(value).toBeNull();
    });

    it("should use getOrSet pattern", async () => {
        let callCount = 0;
        const factory = async () => {
            callCount++;
            return "factory_value";
        };

        const value1 = await performanceOptimizationService.getOrSet("factory_key", factory);
        expect(value1).toBe("factory_value");
        expect(callCount).toBe(1);

        const value2 = await performanceOptimizationService.getOrSet("factory_key", factory);
        expect(value2).toBe("factory_value");
        expect(callCount).toBe(1); // Should not call factory again
    });

    it("should delete cache entry", () => {
        performanceOptimizationService.set("delete_key", "value", 60);
        performanceOptimizationService.delete("delete_key");
        const value = performanceOptimizationService.get("delete_key");
        expect(value).toBeNull();
    });

    it("should clear all cache", () => {
        performanceOptimizationService.set("key1", "value1", 60);
        performanceOptimizationService.set("key2", "value2", 60);
        performanceOptimizationService.clear();
        expect(performanceOptimizationService.get("key1")).toBeNull();
        expect(performanceOptimizationService.get("key2")).toBeNull();
    });

    it("should get cache statistics", () => {
        performanceOptimizationService.set("key1", "value1", 60);
        performanceOptimizationService.get("key1");
        performanceOptimizationService.get("key1");
        performanceOptimizationService.get("non_existent");

        const stats = performanceOptimizationService.getCacheStats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe(2 / 3);
        expect(stats.size).toBe(1);
    });

    it("should invalidate cache by pattern", () => {
        performanceOptimizationService.set("user_1_data", "value1", 60);
        performanceOptimizationService.set("user_2_data", "value2", 60);
        performanceOptimizationService.set("other_key", "value3", 60);

        performanceOptimizationService.invalidatePattern("user_.*");

        expect(performanceOptimizationService.get("user_1_data")).toBeNull();
        expect(performanceOptimizationService.get("user_2_data")).toBeNull();
        expect(performanceOptimizationService.get("other_key")).toBe("value3");
    });

    it("should generate performance report with recommendations", () => {
        const report = performanceOptimizationService.generatePerformanceReport();
        expect(report.cache).toBeDefined();
        expect(report.config).toBeDefined();
        expect(report.recommendations).toBeInstanceOf(Array);
    });
});
