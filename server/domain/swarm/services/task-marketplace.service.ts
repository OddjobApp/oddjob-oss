import { db } from '@server/database_service.js';
import { swarmTasks, swarmBids, missions, appDeployments, type SwarmTask, type SwarmBid } from '@shared/schema/index.js';
import { eq, and, ne, desc } from 'drizzle-orm';
import { createLogger } from '@server/utils/logger.js';
import { decisionRouter } from '@server/domain/governor/core/decision-router.js';

const logger = createLogger('TaskMarketplaceService');

export class TaskMarketplaceService {

  /**
   * Creates a new task in the marketplace with W3C distributed tracing context.
   */
  static async createTask(
    data: Omit<SwarmTask, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'winningBidId'> & { metadata?: Record<string, any> },
    parentTraceparent?: string
  ): Promise<SwarmTask> {
    const { createRootTrace, createChildSpan, parseTraceparent, generateTraceparent } = await import('@domain/core/infrastructure/trace-context.service.js');
    const parentCtx = parentTraceparent ? parseTraceparent(parentTraceparent) : null;
    const traceCtx = parentCtx ? createChildSpan(parentCtx) : createRootTrace();
    const traceparent = generateTraceparent(traceCtx);

    const metadata = {
      ...(data.metadata || {}),
      traceparent,
      traceId: traceCtx.traceId,
      spanId: traceCtx.spanId
    };

    logger.info(`Creating new swarm task for mission ${data.missionId} [traceId: ${traceCtx.traceId}]`);
    const [newTask] = await db.insert(swarmTasks).values({ ...data, metadata } as any).returning();
    
    // Fast-track auto-matching for immediate execution
    this.autoMatchTask(newTask.id).catch(() => {});

    return newTask;
  }

  /**
   * Spawns a lightweight, ephemeral sub-agent task attached to a parent task.
   * Auto-links parent W3C trace context and fast-tracks execution.
   */
  static async spawnSubAgentTask(
    parentTaskId: number,
    data: {
      missionId: number;
      description: string;
      requestingAgentId?: number;
      metadata?: Record<string, any>;
    },
    parentTraceparent?: string
  ): Promise<SwarmTask> {
    logger.info(`Spawning ephemeral sub-agent task for parent task ${parentTaskId}`);
    const ephemeralTask = await this.createTask({
      missionId: data.missionId,
      requestingAgentId: data.requestingAgentId ?? null,
      description: `[Sub-Agent] ${data.description}`,
      metadata: {
        ...(data.metadata || {}),
        parentTaskId,
        isEphemeralSubAgent: true,
        spawnedAt: new Date().toISOString()
      }
    }, parentTraceparent);

    await this.autoMatchTask(ephemeralTask.id);
    return ephemeralTask;
  }

  /**
   * Submits a bid for an open task with W3C trace context propagation.
   */
  static async submitBid(
    data: Omit<SwarmBid, 'id' | 'createdAt' | 'status'>,
    parentTraceparent?: string
  ): Promise<SwarmBid> {
    const { createRootTrace, createChildSpan, parseTraceparent, generateTraceparent } = await import('@domain/core/infrastructure/trace-context.service.js');
    const parentCtx = parentTraceparent ? parseTraceparent(parentTraceparent) : null;
    const traceCtx = parentCtx ? createChildSpan(parentCtx) : createRootTrace();
    const traceparent = generateTraceparent(traceCtx);

    const bidDetails = {
      ...(data.bidDetails as Record<string, any> || {}),
      traceparent,
      traceId: traceCtx.traceId,
      spanId: traceCtx.spanId
    };

    logger.info(`Agent ${data.biddingAgentId} is submitting a bid for task ${data.taskId} [traceId: ${traceCtx.traceId}]`);
    const [newBid] = await db.insert(swarmBids).values({ ...data, bidDetails } as any).returning();
    return newBid;
  }

  /**
   * Accepts a bid, assigning the task to the bidding agent with optimistic concurrency control.
   */
  static async acceptBid(bidId: number, taskId: number): Promise<SwarmTask> {
    logger.info(`Accepting bid ${bidId} for task ${taskId}`);
    return await db.transaction(async (tx) => {
      // Optimistic concurrency check: ensure task is open
      const [existingTask] = await tx.select({ status: swarmTasks.status }).from(swarmTasks).where(eq(swarmTasks.id, taskId)).limit(1);
      if (!existingTask || existingTask.status !== 'open') {
        throw new Error(`Task ${taskId} is no longer open for bid acceptance (current status: ${existingTask?.status ?? 'nonexistent'})`);
      }

      // Mark the winning bid as 'accepted'
      await tx.update(swarmBids).set({ status: 'accepted' }).where(eq(swarmBids.id, bidId));
      
      // Mark all other bids for this task as 'rejected'
      await tx.update(swarmBids).set({ status: 'rejected' })
        .where(and(
          eq(swarmBids.taskId, taskId),
          ne(swarmBids.id, bidId)
        ));

      // Atomic update with conditional guard
      const [updatedTask] = await tx.update(swarmTasks).set({
        status: 'assigned',
        winningBidId: bidId,
        updatedAt: new Date(),
      }).where(and(eq(swarmTasks.id, taskId), eq(swarmTasks.status, 'open'))).returning();

      if (!updatedTask) {
        throw new Error(`Optimistic concurrency clash: task ${taskId} status changed concurrently.`);
      }

      return updatedTask;
    });
  }

  /**
   * Fast-track auto-matching for high-priority or self-healing tasks.
   * Auto-submits a bid on behalf of an available agent and accepts it immediately.
   */
  static async autoMatchTask(taskId: number): Promise<SwarmTask | null> {
    try {
      const [task] = await db.select().from(swarmTasks).where(eq(swarmTasks.id, taskId)).limit(1);
      if (!task || task.status !== "open") return null;

      const targetAgentId = task.requestingAgentId ?? 1;
      const bid = await this.submitBid({
        taskId: task.id,
        biddingAgentId: targetAgentId,
        bidDetails: {
          autoMatched: true,
          confidence: 0.95,
          timestamp: new Date().toISOString()
        }
      });

      logger.info(`Auto-matching task ${taskId} with bid ${bid.id} for agent ${targetAgentId}`);
      return await this.acceptBid(bid.id, taskId);
    } catch (err: any) {
      logger.warn(`Auto-match task ${taskId} failed:`, { error: err.message });
      return null;
    }
  }

  /**
   * Lists all tasks that are currently open for bidding.
   */
  static async listOpenTasks(): Promise<SwarmTask[]> {
    return db.select().from(swarmTasks).where(eq(swarmTasks.status, 'open'));
  }

  /**
   * Lists all bids for a given task ID.
   */
  static async listBidsForTask(taskId: number): Promise<SwarmBid[]> {
    return db.select().from(swarmBids).where(eq(swarmBids.taskId, taskId));
  }

  /**
   * Seeds a mock swarm task with bids for testing/demo.
   */
  static async seedSwarmTask(): Promise<{ taskId: number }> {
    const [latestMission] = await db
      .select({ id: missions.id })
      .from(missions)
      .orderBy(desc(missions.id))
      .limit(1);

    if (!latestMission) {
      throw new Error('No missions found. Please create a mission before seeding swarm tasks.');
    }

    const agents = await db
      .select({ id: appDeployments.id })
      .from(appDeployments)
      .orderBy(desc(appDeployments.id))
      .limit(3);

    const agentIds = agents.map(a => a.id);

    const [task] = await db.insert(swarmTasks).values({
      missionId: latestMission.id,
      requestingAgentId: agentIds[0] ?? null,
      description: "Execute competitive analysis on competitor pricing models.",
      status: "open",
    }).returning();

    if (agentIds.length >= 2) {
      await db.insert(swarmBids).values([
        {
          taskId: task.id,
          biddingAgentId: agentIds[1],
          bidDetails: { plan: "I can extract data from public APIs and generate a comparison matrix." },
          status: "pending",
        },
        ...(agentIds.length >= 3 ? [{
          taskId: task.id,
          biddingAgentId: agentIds[2],
          bidDetails: { plan: "I will perform a deep web search and synthesize an executive summary." },
          status: "pending",
        }] : []),
      ]);

      setTimeout(() => {
        TaskMarketplaceService.requestTaskApproval(task.id).catch(err => {
          logger.error("Failed to request HIL approval for seeded task", err);
        });
      }, 1000);
    }

    return { taskId: task.id };
  }

  /**
   * Triggers a HIL decision request for the user to review and accept a bid for a task.
   */
  static async requestTaskApproval(taskId: number): Promise<SwarmTask | null> {
    logger.info(`Requesting HIL approval for task ${taskId}`);
    
    // Fetch the task and its bids
    const [task] = await db.select().from(swarmTasks).where(eq(swarmTasks.id, taskId));
    if (!task) throw new Error(`Task ${taskId} not found`);

    const bids = await db.select().from(swarmBids).where(eq(swarmBids.taskId, taskId));
    if (bids.length === 0) {
      logger.warn(`No bids found for task ${taskId}, cannot request approval.`);
      return null;
    }

    // Prepare dropdown options for the form
    const bidOptions = bids.map(b => 
      `Bid #${b.id} from Agent #${b.biddingAgentId}`
    );

    const taskContextMarkdown = `
### Swarm Task Request
**Mission ID:** ${task.missionId}
**Requesting Agent:** ${task.requestingAgentId || 'System'}

**Description:**
${task.description}

---

### Available Bids
${bids.map(b => `
#### Bid #${b.id} (Agent #${b.biddingAgentId})
${(b.bidDetails as any)?.plan || 'No plan details provided.'}
`).join('\n')}
    `.trim();

    // Ask the user to select a bid
    const decision = await decisionRouter.requestDecision({
      sessionId: `swarm_approval_${taskId}_${Date.now()}`,
      tool: 'swarm_bid_approval',
      goal: `Select a winning bid for the swarm task: ${task.description}`,
      riskLevel: 'medium',
      description: `Review proposals from agents for task #${taskId} and select the winner.`,
      approverType: 'internal',
      channels: ['inbox', 'copilot'],
      noWait: false,
      params: {
        type: 'input_request',
        pipelineName: 'Swarm Task Bids',
        fields: [
          {
            name: 'taskContext',
            label: 'Task & Bid Details',
            type: 'markdown',
            readOnly: true,
            defaultValue: taskContextMarkdown
          },
          {
            name: 'selectedBid',
            label: 'Select Winning Bid',
            type: 'select',
            required: true,
            options: bidOptions
          }
        ]
      }
    });

    if (decision.approved && decision.modifiedOutput?.selectedBid) {
      // The user selected a string like "Bid #123 from Agent..."
      // Extract the bid ID from the string (e.g. using regex)
      const match = decision.modifiedOutput.selectedBid.match(/Bid #(\d+)/);
      if (match && match[1]) {
        const selectedBidId = parseInt(match[1], 10);
        logger.info(`User approved bid ${selectedBidId} for task ${taskId}`);
        return await this.acceptBid(selectedBidId, taskId);
      }
    }
    
    logger.info(`User rejected or did not select a valid bid for task ${taskId}`);
    return null;
  }
}
