/**
 * Unit tests for FallbackManager
 *
 * Tests backend selection and fallback chain behavior.
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5
 */

import { describe, it, expect } from "vitest";
import { FallbackManager } from "../fallback-manager.js";
import type { RerankBackendType } from "../types.js";

describe("FallbackManager", () => {
  const defaultPriority: RerankBackendType[] = ["cohere", "local", "llm"];

  describe("selectBackend", () => {
    it("returns the preferred backend when specified", () => {
      const manager = new FallbackManager(defaultPriority);
      expect(manager.selectBackend("llm")).toBe("llm");
      expect(manager.selectBackend("local")).toBe("local");
      expect(manager.selectBackend("cohere")).toBe("cohere");
    });

    it("returns the first in priority order when no preferred backend is given", () => {
      const manager = new FallbackManager(defaultPriority);
      expect(manager.selectBackend()).toBe("cohere");
    });

    it("returns the first in priority order when preferred is undefined", () => {
      const manager = new FallbackManager(defaultPriority);
      expect(manager.selectBackend(undefined)).toBe("cohere");
    });

    it("respects custom priority order for default selection", () => {
      const manager = new FallbackManager(["llm", "cohere", "local"]);
      expect(manager.selectBackend()).toBe("llm");
    });
  });

  describe("nextBackend", () => {
    it("returns the next backend in priority order", () => {
      const manager = new FallbackManager(defaultPriority);
      expect(manager.nextBackend("cohere")).toBe("local");
      expect(manager.nextBackend("local")).toBe("llm");
    });

    it("returns null when the current backend is last in the chain", () => {
      const manager = new FallbackManager(defaultPriority);
      expect(manager.nextBackend("llm")).toBeNull();
    });

    it("returns null when the current backend is not found in priority order", () => {
      const manager = new FallbackManager(["cohere", "local"]);
      expect(manager.nextBackend("llm")).toBeNull();
    });

    it("walks the full priority chain correctly", () => {
      const manager = new FallbackManager(defaultPriority);
      let current: RerankBackendType | null = manager.selectBackend();
      const visited: RerankBackendType[] = [current];

      while (current !== null) {
        current = manager.nextBackend(current);
        if (current !== null) {
          visited.push(current);
        }
      }

      expect(visited).toEqual(["cohere", "local", "llm"]);
    });

    it("handles single-backend priority order", () => {
      const manager = new FallbackManager(["local"]);
      expect(manager.selectBackend()).toBe("local");
      expect(manager.nextBackend("local")).toBeNull();
    });
  });
});
