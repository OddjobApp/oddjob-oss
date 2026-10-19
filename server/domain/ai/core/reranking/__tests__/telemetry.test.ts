import { describe, it, expect, beforeEach } from "vitest";
import {
  emitRerankTelemetry,
  emitFallbackWarning,
  getMetrics,
  resetMetrics,
} from "../telemetry.js";

describe("RerankingTelemetry", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("emitRerankTelemetry", () => {
    it("increments totalRequests on each call", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 10,
        latencyMs: 50,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 10,
      });

      const metrics = getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.failedRequests).toBe(0);
    });

    it("tracks documents reranked per backend", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 15,
        latencyMs: 100,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 10,
      });
      emitRerankTelemetry({
        backend: "local",
        documentCount: 20,
        latencyMs: 200,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 20,
      });
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 5,
        latencyMs: 30,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 5,
      });

      const metrics = getMetrics();
      expect(metrics.documentsPerBackend.cohere).toBe(20);
      expect(metrics.documentsPerBackend.local).toBe(20);
      expect(metrics.documentsPerBackend.llm).toBe(0);
      expect(metrics.requestsPerBackend.cohere).toBe(2);
      expect(metrics.requestsPerBackend.local).toBe(1);
    });

    it("records latency metrics correctly", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 10,
        latencyMs: 100,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 10,
      });
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 5,
        latencyMs: 300,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 5,
      });

      const metrics = getMetrics();
      expect(metrics.latency.lastMs).toBe(300);
      expect(metrics.latency.avgMs).toBe(200);
      expect(metrics.latency.maxMs).toBe(300);
    });

    it("counts failed requests", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 10,
        latencyMs: 50,
        success: false,
        fallbackTriggered: true,
        resultsReturned: 10,
      });

      const metrics = getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(1);
    });
  });

  describe("emitFallbackWarning", () => {
    it("increments totalFallbacks counter", () => {
      emitFallbackWarning({
        failedBackend: "cohere",
        failureReason: "HTTP 429 rate limit",
        fallbackTarget: "local",
      });

      const metrics = getMetrics();
      expect(metrics.totalFallbacks).toBe(1);
    });

    it("tracks multiple fallback events", () => {
      emitFallbackWarning({
        failedBackend: "cohere",
        failureReason: "HTTP 429",
        fallbackTarget: "local",
      });
      emitFallbackWarning({
        failedBackend: "local",
        failureReason: "ECONNREFUSED",
        fallbackTarget: "llm",
      });

      const metrics = getMetrics();
      expect(metrics.totalFallbacks).toBe(2);
    });

    it("handles null fallback target (all exhausted)", () => {
      emitFallbackWarning({
        failedBackend: "llm",
        failureReason: "Parse error",
        fallbackTarget: null,
      });

      const metrics = getMetrics();
      expect(metrics.totalFallbacks).toBe(1);
    });
  });

  describe("getMetrics", () => {
    it("returns a fresh snapshot (not a reference)", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 10,
        latencyMs: 100,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 10,
      });

      const metrics1 = getMetrics();
      emitRerankTelemetry({
        backend: "local",
        documentCount: 5,
        latencyMs: 50,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 5,
      });

      const metrics2 = getMetrics();
      // metrics1 should not be affected by the second emit
      expect(metrics1.totalRequests).toBe(1);
      expect(metrics2.totalRequests).toBe(2);
    });

    it("returns zero state after reset", () => {
      emitRerankTelemetry({
        backend: "cohere",
        documentCount: 10,
        latencyMs: 100,
        success: true,
        fallbackTriggered: false,
        resultsReturned: 10,
      });

      resetMetrics();
      const metrics = getMetrics();

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.totalFallbacks).toBe(0);
      expect(metrics.documentsPerBackend.cohere).toBe(0);
      expect(metrics.latency.lastMs).toBe(0);
      expect(metrics.latency.avgMs).toBe(0);
      expect(metrics.latency.maxMs).toBe(0);
    });
  });
});
