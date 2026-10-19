import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { SwarmService } from "../../../../domain/swarm/core/swarm.service.js";

const requestHelpSchema = z.object({
  task_description: z.string().describe("A clear, detailed description of the task you need help with."),
});

const request_help: ToolDefinition<any> = {
  name: "request_help",

  idempotency: "none",
  description: "When you are unable to complete a task, use this tool to post a help request to the agent marketplace. Another agent may be able to help.",
  parameters: requestHelpSchema,
  async execute(input, context) {
    const { task_description } = input;
    const { missionId, agentId } = context; // Assuming these are in the context

    if (!missionId || !agentId) {
      throw new Error("Mission context is required to request help.");
    }

    const task = await SwarmService.createTask({
      missionId,
      requestingAgentId: agentId,
      description: task_description,
    });

    return {
      status: "success",
      output: `Successfully posted help request to the marketplace. Task ID: ${task.id}`,
    };
  },
};


const reviewBidsSchema = z.object({
  task_id: z.number().describe("The ID of the task you want to review bids for."),
});

const review_bids: ToolDefinition<any> = {
  name: "review_bids",

  idempotency: "read-safe",
  description: "Review the bids submitted by other agents for a task you created.",
  parameters: reviewBidsSchema,
  async execute(input) {
    const { task_id } = input;
    const { db } = await import('@server/database_service.js');
    const { swarmBids } = await import('@shared/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const bids = await db.select().from(swarmBids).where(eq(swarmBids.taskId, task_id));

    if (bids.length === 0) {
      return { status: "success", output: "No bids have been submitted for this task yet." };
    }

    return { status: "success", output: JSON.stringify(bids) };
  },
};

const acceptBidSchema = z.object({
  bid_id: z.number().describe("The ID of the bid you want to accept."),
  task_id: z.number().describe("The ID of the task this bid is for."),
});

const accept_bid: ToolDefinition<any> = {
  name: "accept_bid",

  idempotency: "none",
  description: "Accept a bid from another agent to complete your task.",
  parameters: acceptBidSchema,
  async execute(input) {
    const { bid_id, task_id } = input;
    const updatedTask = await SwarmService.acceptBid(bid_id, task_id);
    return {
      status: "success",
      output: `Bid ${bid_id} has been accepted. Agent ${updatedTask.winningBidId} is now assigned to task ${task_id}.`,
    };
  },
};

const delegateTaskSchema = z.object({
  goal: z.string().describe("The goal or task to delegate to a sub-agent."),
  maxIterations: z.number().optional().describe("Maximum iterations for the sub-agent."),
});

const delegate_task: ToolDefinition<any> = {
  name: "delegate_task",

  idempotency: "none",
  description: "Delegate a task to a sub-agent that will work autonomously toward a specific goal.",
  parameters: delegateTaskSchema,
  async execute(input, context) {
    const { goal, maxIterations = 10 } = input;
    const { organizationId, missionId, userId, jobId, allowedToolNames } = context;

    try {
      const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
      const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
      const { runAgentLoop } = await import("@domain/agents/agent-runner.js");

      const aiConfig = await systemAiService.getAiConfig("copilot", organizationId ?? undefined);
      const client = AIClientFactory.getClient({ provider: aiConfig?.provider || "google" } as any);

      const result = await runAgentLoop(
        client,
        aiConfig as any,
        goal,
        allowedToolNames || [],
        maxIterations,
        aiConfig?.apiKey || "",
        { organizationId, missionId, userId, jobId, isSubAgent: true, parentId: jobId },
        undefined,
        false,
        undefined,
        "full"
      );

      return `SUB-AGENT RESULT:\n${result.output}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Error: Sub-agent execution failed\n${msg}`;
    }
  },
};

export const DELEGATION_TOOLS = {
  request_help,
  review_bids,
  accept_bid,
  delegate_task,
};
