import { TaskMarketplaceService } from '../services/task-marketplace.service.js';
import type { SwarmTask, SwarmBid } from '@shared/schema/index.js';

export class SwarmService {
  /**
   * Creates a new task in the marketplace.
   */
  static async createTask(data: Omit<SwarmTask, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'winningBidId'>): Promise<SwarmTask> {
    return TaskMarketplaceService.createTask(data);
  }

  /**
   * Submits a bid for an open task.
   */
  static async submitBid(data: Omit<SwarmBid, 'id' | 'createdAt' | 'status'>): Promise<SwarmBid> {
    return TaskMarketplaceService.submitBid(data);
  }

  /**
   * Accepts a bid for a task.
   */
  static async acceptBid(bidId: number, taskId: number): Promise<SwarmTask> {
    return TaskMarketplaceService.acceptBid(bidId, taskId);
  }

  /**
   * Lists all open tasks.
   */
  static async listOpenTasks(): Promise<SwarmTask[]> {
    return TaskMarketplaceService.listOpenTasks();
  }

  /**
   * Lists all bids for a task.
   */
  static async listBidsForTask(taskId: number): Promise<SwarmBid[]> {
    return TaskMarketplaceService.listBidsForTask(taskId);
  }

  /**
   * Seeds a mock swarm task with bids.
   */
  static async seedSwarmTask(): Promise<{ taskId: number }> {
    return TaskMarketplaceService.seedSwarmTask();
  }
}
