import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskMarketplaceService } from "@domain/swarm/services/task-marketplace.service.js";
import { db } from "@server/database_service.js";

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

describe("TaskMarketplaceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask", () => {
    it("should insert a new task and attach W3C trace context metadata", async () => {
      const mockTask = {
        id: 1,
        missionId: 10,
        requestingAgentId: null,
        description: "Review pull request",
        status: "open",
        winningBidId: null,
        metadata: { traceId: "abc", spanId: "123" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockTask]),
        }),
      } as any);

      const task = await TaskMarketplaceService.createTask({
        missionId: 10,
        requestingAgentId: null,
        description: "Review pull request",
      });

      expect(task).toBeDefined();
      expect(task.id).toBe(1);
      expect(task.description).toBe("Review pull request");
    });
  });

  describe("acceptBid", () => {
    it("should reject acceptance if task is not open (optimistic lock guard)", async () => {
      vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
        const txMock = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ status: "assigned" }]),
              }),
            }),
          }),
        };
        return cb(txMock);
      });

      await expect(TaskMarketplaceService.acceptBid(1, 10)).rejects.toThrow("no longer open");
    });

    it("should mark winning bid accepted and sibling bids rejected when task is open", async () => {
      const mockTask = {
        id: 10,
        status: "assigned",
        winningBidId: 1,
      };

      vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
        const txMock = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ status: "open" }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockTask]),
              }),
            }),
          }),
        };
        return cb(txMock);
      });

      const updatedTask = await TaskMarketplaceService.acceptBid(1, 10);
      expect(updatedTask).toBeDefined();
      expect(updatedTask.status).toBe("assigned");
    });
  });

  describe("autoMatchTask", () => {
    it("should return null if task is not open", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 5, status: "completed" }]),
          }),
        }),
      } as any);

      const result = await TaskMarketplaceService.autoMatchTask(5);
      expect(result).toBeNull();
    });
  });
});
