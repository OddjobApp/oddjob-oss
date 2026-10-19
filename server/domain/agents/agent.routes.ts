/**
 * Multi-Agent API Routes
 * 
 * Endpoints for managing AI agents and workflows.
 */
import { Router } from "express";
import { agentCoordinator } from "./core/agent-coordinator.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("AgentRoutes");

/**
 * GET /api/agents/status
 * Get system status including all agents and queue
 */
router.get("/status", (_req, res) => {
  try {
    const status = agentCoordinator.getStatus();
    res.json(status);
  } catch (error) {
    logger.error("[AgentAPI] Error getting status:", error);
    res.status(500).json({
      error: "Failed to get status",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/agents/register
 * Register a new agent
 */
router.post("/register", async (req, res) => {
  try {
    const { name, role, capabilities } = req.body;
    
    if (!name || !role) {
      return res.status(400).json({ error: "name and role required" });
    }

    const agent = await agentCoordinator.registerAgent(
      name,
      role,
      capabilities || []
    );

    res.status(201).json(agent);
  } catch (error) {
    logger.error("[AgentAPI] Error registering agent:", error);
    res.status(500).json({
      error: "Failed to register agent",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/agents/:agentId
 * Get agent details
 */
router.get("/:agentId", (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = agentCoordinator.getAgent(agentId);
    
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.json(agent);
  } catch (error) {
    logger.error("[AgentAPI] Error getting agent:", error);
    res.status(500).json({
      error: "Failed to get agent",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/agents/:agentId/heartbeat
 * Update agent heartbeat
 */
router.post("/:agentId/heartbeat", async (req, res) => {
  try {
    const { agentId } = req.params;
    await agentCoordinator.heartbeat(agentId);
    res.json({ success: true });
  } catch (error) {
    logger.error("[AgentAPI] Error updating heartbeat:", error);
    res.status(500).json({
      error: "Failed to update heartbeat",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/agents/tasks
 * Submit a new task
 */
router.post("/tasks", async (req, res) => {
  try {
    const { type, payload, priority, dependencies } = req.body;
    
    if (!type) {
      return res.status(400).json({ error: "type required" });
    }

    const task = await agentCoordinator.submitTask(
      type,
      payload || {},
      priority || "medium",
      dependencies
    );

    res.status(201).json(task);
  } catch (error) {
    logger.error("[AgentAPI] Error submitting task:", error);
    res.status(500).json({
      error: "Failed to submit task",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/agents/tasks/:taskId
 * Get task details
 */
router.get("/tasks/:taskId", (req, res) => {
  try {
    const { taskId } = req.params;
    const task = agentCoordinator.getTask(taskId);
    
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    logger.error("[AgentAPI] Error getting task:", error);
    res.status(500).json({
      error: "Failed to get task",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/agents/workflows
 * Create a new workflow
 */
router.post("/workflows", async (req, res) => {
  try {
    const { name, tasks, parallel } = req.body;
    
    if (!name || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: "name and tasks array required" });
    }

    const workflow = await agentCoordinator.createWorkflow(
      name,
      tasks,
      parallel || false
    );

    res.status(201).json(workflow);
  } catch (error) {
    logger.error("[AgentAPI] Error creating workflow:", error);
    res.status(500).json({
      error: "Failed to create workflow",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/agents/workflows/:workflowId
 * Get workflow details
 */
router.get("/workflows/:workflowId", (req, res) => {
  try {
    const { workflowId } = req.params;
    const workflow = agentCoordinator.getWorkflow(workflowId);
    
    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    res.json(workflow);
  } catch (error) {
    logger.error("[AgentAPI] Error getting workflow:", error);
    res.status(500).json({
      error: "Failed to get workflow",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
