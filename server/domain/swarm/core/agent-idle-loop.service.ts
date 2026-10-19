import { SwarmService } from './swarm.service.js';
import { agentService } from '../../agents/agent.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('AgentIdleLoop');
const IDLE_CHECK_INTERVAL = 30000; // 30 seconds

export class AgentIdleLoopService {
  private static intervalId: NodeJS.Timeout | null = null;

  static start() {
    if (this.intervalId) {
      logger.warn('AgentIdleLoop is already running.');
      return;
    }

    logger.info('Starting AgentIdleLoop...');
    this.intervalId = setInterval(this.runIdleCheck, IDLE_CHECK_INTERVAL);
  }

  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped AgentIdleLoop.');
    }
  }

  private static async runIdleCheck() {
    logger.info('Running idle agent check...');
    try {
      const idleAgents = await agentService.getIdleAgents(); // This method needs to be created
      const openTasks = await SwarmService.listOpenTasks();

      if (openTasks.length === 0) {
        logger.info('No open tasks in the marketplace.');
        return;
      }

      for (const agent of idleAgents) {
        for (const task of openTasks) {
          // In a real implementation, we would check if the agent has already bid on this task.
          // We would also have a more sophisticated skill matching system.

          logger.info(`Agent ${agent.id} is considering task ${task.id}`);

          // For now, every idle agent bids on every open task.
          await SwarmService.submitBid({
            taskId: task.id,
            biddingAgentId: agent.id,
            bidDetails: { plan: 'I will use my advanced skills to complete this task.' },
          });

          logger.info(`Agent ${agent.id} submitted a bid for task ${task.id}`);
        }
      }
    } catch (error) {
      logger.error('Error in AgentIdleLoop', { error });
    }
  }
}
