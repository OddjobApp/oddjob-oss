import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  queueHandoff,
  getUnreadCount,
  getUnreadCountsByWorkbench,
  markAsRead,
  getQueuedHandoffs,
  clearReadItems,
} from "../../server/blueprints/apps/sdlc-workbench/lib/handoff-queue";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("handoff-queue", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal("window", { location: { search: "?orgId=342" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps notifications isolated by organization", () => {
    const payload = { sourceStage: "QA", targetStage: "UAT", sourceMission: "QA Gate", targetMission: "UAT Review", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 };
    queueHandoff(payload, "2026-10-14T10:00:00Z", "342");
    expect(getQueuedHandoffs("342")).toHaveLength(1);
    expect(getQueuedHandoffs("473")).toHaveLength(0);
  });

  describe("queueHandoff", () => {
    it("should store a handoff event in the queue", () => {
      queueHandoff(
        {
          sourceStage: "Requirements",
          targetStage: "Development",
          sourceMission: "PRD Review",
          targetMission: "Sprint Planning",
          ticketKeys: ["PROJ-1"],
          triggeredBy: "PM Agent",
          runId: 100,
        },
        "2024-01-15T10:00:00Z"
      );

      const items = getQueuedHandoffs();
      expect(items).toHaveLength(1);
      expect(items[0].read).toBe(false);
      expect(items[0].event.payload.sourceStage).toBe("Requirements");
      expect(items[0].event.payload.targetStage).toBe("Development");
      expect(items[0].event.payload.ticketKeys).toEqual(["PROJ-1"]);
    });

    it("should deduplicate by runId + targetStage", () => {
      const payload = {
        sourceStage: "QA",
        targetStage: "UAT",
        sourceMission: "QA Gate",
        targetMission: "UAT Review",
        ticketKeys: ["PROJ-2"],
        triggeredBy: "QA Agent",
        runId: 200,
      };

      queueHandoff(payload, "2024-01-15T10:00:00Z");
      queueHandoff(payload, "2024-01-15T10:01:00Z"); // duplicate

      expect(getQueuedHandoffs()).toHaveLength(1);
    });

    it("should allow same runId with different targetStage", () => {
      const base = {
        sourceStage: "QA",
        sourceMission: "QA Gate",
        targetMission: "UAT Review",
        ticketKeys: ["PROJ-3"],
        triggeredBy: "QA Agent",
        runId: 300,
      };

      queueHandoff({ ...base, targetStage: "UAT" }, "2024-01-15T10:00:00Z");
      queueHandoff({ ...base, targetStage: "Deployment" }, "2024-01-15T10:01:00Z");

      expect(getQueuedHandoffs()).toHaveLength(2);
    });
  });

  describe("getUnreadCount", () => {
    beforeEach(() => {
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 },
        "2024-01-15T10:00:00Z"
      );
      queueHandoff(
        { sourceStage: "Development", targetStage: "QA", sourceMission: "M2", targetMission: "M3", ticketKeys: ["T-2"], triggeredBy: "Agent", runId: 2 },
        "2024-01-15T10:01:00Z"
      );
      queueHandoff(
        { sourceStage: "QA", targetStage: "UAT", sourceMission: "M3", targetMission: "M4", ticketKeys: ["T-3"], triggeredBy: "Agent", runId: 3 },
        "2024-01-15T10:02:00Z"
      );
    });

    it("should return total unread count when no filter", () => {
      expect(getUnreadCount()).toBe(3);
    });

    it("should filter by target stage name", () => {
      expect(getUnreadCount("QA")).toBe(1);
      expect(getUnreadCount("Development")).toBe(1);
      expect(getUnreadCount("UAT")).toBe(1);
    });

    it("should filter by workbench identifier", () => {
      expect(getUnreadCount("qa-workbench")).toBe(1);
      expect(getUnreadCount("scrum-master-workbench")).toBe(1);
      expect(getUnreadCount("stakeholder-workbench")).toBe(1);
    });
  });

  describe("getUnreadCountsByWorkbench", () => {
    it("should return grouped counts by workbench href", () => {
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 },
        "2024-01-15T10:00:00Z"
      );
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-2"], triggeredBy: "Agent", runId: 2 },
        "2024-01-15T10:01:00Z"
      );
      queueHandoff(
        { sourceStage: "Development", targetStage: "QA", sourceMission: "M2", targetMission: "M3", ticketKeys: ["T-3"], triggeredBy: "Agent", runId: 3 },
        "2024-01-15T10:02:00Z"
      );

      const counts = getUnreadCountsByWorkbench();
      expect(counts["/scrum-master-workbench"]).toBe(2);
      expect(counts["/qa-workbench"]).toBe(1);
    });

    it("should not include read items in counts", () => {
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 },
        "2024-01-15T10:00:00Z"
      );
      markAsRead("scrum-master-workbench");

      const counts = getUnreadCountsByWorkbench();
      expect(counts["/scrum-master-workbench"]).toBeUndefined();
    });
  });

  describe("markAsRead", () => {
    it("should mark items for a stage as read", () => {
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 },
        "2024-01-15T10:00:00Z"
      );
      queueHandoff(
        { sourceStage: "Development", targetStage: "QA", sourceMission: "M2", targetMission: "M3", ticketKeys: ["T-2"], triggeredBy: "Agent", runId: 2 },
        "2024-01-15T10:01:00Z"
      );

      markAsRead("scrum-master-workbench");

      expect(getUnreadCount("scrum-master-workbench")).toBe(0);
      expect(getUnreadCount("qa-workbench")).toBe(1);
    });

    it("should accept stage name directly", () => {
      queueHandoff(
        { sourceStage: "QA", targetStage: "UAT", sourceMission: "M3", targetMission: "M4", ticketKeys: ["T-3"], triggeredBy: "Agent", runId: 3 },
        "2024-01-15T10:02:00Z"
      );

      markAsRead("UAT");
      expect(getUnreadCount("UAT")).toBe(0);
    });
  });

  describe("clearReadItems", () => {
    it("should remove read items and keep unread ones", () => {
      queueHandoff(
        { sourceStage: "Requirements", targetStage: "Development", sourceMission: "M1", targetMission: "M2", ticketKeys: ["T-1"], triggeredBy: "Agent", runId: 1 },
        "2024-01-15T10:00:00Z"
      );
      queueHandoff(
        { sourceStage: "Development", targetStage: "QA", sourceMission: "M2", targetMission: "M3", ticketKeys: ["T-2"], triggeredBy: "Agent", runId: 2 },
        "2024-01-15T10:01:00Z"
      );

      markAsRead("scrum-master-workbench");
      clearReadItems();

      const remaining = getQueuedHandoffs();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].event.payload.targetStage).toBe("QA");
    });
  });
});
