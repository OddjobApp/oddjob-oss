/**
 * Workgroup Pre-Creation Dependency Validation
 * Aligned with docs/specs/WORKGROUPS_SPEC.md section 6
 * Tests workgroupDependencyResolver and workgroupService (validation + create flow).
 * Uses service layer directly to avoid CSRF/auth in integration tests.
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { jobs, missions, missionMembers } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { missionDependencyResolver } from "@domain/mission/core/mission-dependency-resolver.service.js";
import { missionService } from "@domain/mission/core/mission.service.js";

describe("Mission Validate Integration", () => {
  let testJobId: number;

  beforeAll(async () => {
    const [job] = await db
      .insert(jobs)
      .values({
        name: "Test Mission Validate Job",
        type: "shell",
        config: { command: "echo ok" },
        organizationId: null,
        createdBy: "test_workgroup_validate",
        tool: "None",
      })
      .returning();
    testJobId = job!.id;
  });

  afterAll(async () => {
    if (testJobId) {
      await db.delete(jobs).where(eq(jobs.id, testJobId));
    }
  });

  describe("validateAndResolve (resolver service)", () => {
    it("should return valid when members reference existing jobs", async () => {
      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", entityId: testJobId, role: "member" }],
        null
      );

      expect(result).toHaveProperty("valid", true);
      expect(result.resolved.length).toBe(1);
      expect(result.resolved[0]).toMatchObject({
        entityType: "job",
        entityId: testJobId,
        entityName: "Test Mission Validate Job",
        exists: true,
      });
      expect(result.blockers).toEqual([]);
    });

    it("should return invalid when member has no entityId (Waitlist)", async () => {
      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", role: "member" }],
        null
      );

      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers.some((b) => b.includes("No agent selected"))).toBe(true);
    });

    it("should return invalid when member references non-existent job", async () => {
      const result = await missionDependencyResolver.validateAndResolve(
        [{ entityType: "job", entityId: 999999, role: "member" }],
        null
      );

      expect(result.valid).toBe(false);
      expect(result.blockers.some((b) => b.includes("not found"))).toBe(true);
    });

    it("should return empty resolved when members array is empty", async () => {
      const result = await missionDependencyResolver.validateAndResolve(
        [],
        null
      );

      expect(result.valid).toBe(true);
      expect(result.resolved).toEqual([]);
      expect(result.blockers).toEqual([]);
    });
  });

  describe("createMission with validation", () => {
    it("should create workgroup when validation passes", async () => {
      const result = await missionService.createMission(
        {
          name: "Test Mission Create",
          objective: "Created via integration test",
          organizationId: null,
          type: "collaborative",
          createdBy: "test_workgroup_validate",
          blackboard: {},
        },
        "test_workgroup_validate",
        [{ entityType: "job", entityId: testJobId, role: "member" }]
      );

      expect(result).toHaveProperty("id");
      expect(result.name).toBe("Test Mission Create");

      const wgId = result.id;
      await db.delete(missionMembers).where(eq(missionMembers.missionId, wgId));
      await db.delete(missions).where(eq(missions.id, wgId));
    });
  });
});
