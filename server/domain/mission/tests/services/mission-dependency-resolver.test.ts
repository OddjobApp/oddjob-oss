/**
 * Mission Dependency Resolver Unit Tests
 * Aligned with docs/specs/WORKGROUPS_SPEC.md section 6
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
  const query = {
    returning: vi.fn().mockResolvedValue(result),
    then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
    limit: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    and: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
  };
  return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(() => createMockQuery([])),
    },
  };
});

import { missionDependencyResolver } from "@domain/mission/core/mission-dependency-resolver.service.js";
import { db } from "@server/database_service.js";

describe("MissionDependencyResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default select mock
    (db.select as Mock).mockReturnValue(createMockQuery([]));
  });

  describe("validateAndResolve", () => {
    it("should return valid with empty resolved when members is empty", async () => {
      const result = await missionDependencyResolver.validateAndResolve([], null);

      expect(result).toMatchObject({
        valid: true,
        resolved: [],
        missing: [],
      });
    });

    it("should return invalid when member has no entityId", async () => {
      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", role: "member" }],
        null
      );

      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.resolved[0].missing).toContain("entityId missing");
    });

    it("should return invalid when member references non-existent job", async () => {
      (db.select as Mock).mockReturnValue(createMockQuery([])); // No job found

      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", entityId: 9991, role: "member" }],
        null
      );

      expect(result.valid).toBe(false);
      expect(result.blockers.some(b => b.includes("not found"))).toBe(true);
    });

    it("should return valid when job exists", async () => {
      const mockJob = {
        id: 1,
        name: "Test Job",
        type: "shell",
        config: { command: "echo ok" },
        organizationId: null,
      };

      // Call sequence: 
      // 1. validateAndResolve -> main job lookup
      // 2. resolveJobDependencies -> job lookup
      // 3. checkSupervisorPipelineExists -> innerJoin lookup
      (db.select as Mock)
        .mockReturnValueOnce(createMockQuery([mockJob])) // Main job
        .mockReturnValueOnce(createMockQuery([mockJob])) // resolveJobDependencies
        .mockReturnValueOnce(createMockQuery([{ pipelineId: 1 }])); // checkSupervisorPipelineExists

      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", entityId: 1, role: "member" }],
        null
      );

      expect(result.valid).toBe(true);
      expect(result.resolved[0].entityName).toBe("Test Job");
    });
  });
});
