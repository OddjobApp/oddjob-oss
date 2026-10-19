import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { seleniumAgentService } from "./core/selenium-agent.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentsRoute");
const router = Router();

// Active autopilot sessions
const activeAutopilotSessions = new Map<string, {
  steps: any[];
  startUrl: string;
  goal: string;
  context: any;
  startTime: Date;
}>();

/**
 * POST /api/agents/selenium/start
 * Start a new autopilot session
 */
router.post("/selenium/start", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      url: z.string().url(),
      goal: z.string().min(5).max(2000),
      datasetId: z.number().int().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
    }

    const { url, goal, datasetId } = validation.data;
    const sessionId = `autopilot-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Store session metadata
    activeAutopilotSessions.set(sessionId, {
      steps: [],
      startUrl: url,
      goal,
      context: {
        organizationId: (req as any).organizationId || null,
        userId: (req as any).user?.id,
        missionRunId: (req as any).missionRunId,
      },
      startTime: new Date(),
    });

    logger.info(`[Selenium Autopilot] Session started: ${sessionId}`);

    res.json({
      sessionId,
      status: "started",
      message: "Autopilot session initialized. Use /steps endpoint to execute steps.",
      startUrl: url,
      goal,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/selenium/:sessionId/execute
 * Execute the autopilot and record steps
 */
router.post("/selenium/:sessionId/execute", requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = activeAutopilotSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Autopilot session not found" });
    }

    // Set a higher timeout for this request
    req.setTimeout(300000); // 5 minutes

    const startTime = Date.now();

    try {
      // Run the autopilot
      const steps = await seleniumAgentService.runAutoPilot(
        session.startUrl,
        session.goal,
        session.context,
        req.body.datasetId
      );

      // Persist steps to database
      await seleniumAgentService.recordRunSteps(sessionId, steps);

      // Update session with completed steps
      session.steps = steps;

      const duration = Date.now() - startTime;

      logger.info(`[Selenium Autopilot] Session completed: ${sessionId}, ${steps.length} steps, ${duration}ms`);

      res.json({
        sessionId,
        status: "completed",
        steps,
        stepCount: steps.length,
        durationMs: duration,
      });
    } catch (error: any) {
      logger.error(`[Selenium Autopilot] Session failed: ${sessionId}`, error);

      // Persist error state
      await seleniumAgentService.recordErrorStep(sessionId, error.message);

      res.status(500).json({
        sessionId,
        status: "failed",
        error: error.message,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/selenium/:sessionId/steps
 * Get recorded steps for a session
 */
router.get("/selenium/:sessionId/steps", requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // An active session answers for itself, even with zero steps. The previous
    // condition required `steps.length > 0`, so a session that had been started
    // but not yet executed fell through to the database, found nothing, and
    // returned 404 — reporting a live session as non-existent. 404 must mean
    // "no such session", which is now only reachable when the id is unknown to
    // both the active map and the persisted steps.
    const session = activeAutopilotSessions.get(sessionId);
    if (session) {
      return res.json({
        sessionId,
        steps: session.steps,
        status: session.steps.length > 0 ? "running" : "started",
      });
    }

    // Not active — fall back to steps persisted by a completed session.
    const steps = await seleniumAgentService.getRunSteps(sessionId);

    if (steps.length === 0) {
      return res.status(404).json({ error: "No steps found for this session" });
    }

    res.json({
      sessionId,
      steps: steps.map(s => ({
        index: s.stepIndex,
        action: s.action,
        selector: s.selector,
        value: s.value,
        metadata: s.metadata,
      })),
      status: "completed",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/selenium/:sessionId/stop
 * Stop a session and persist final results
 */
router.post("/selenium/:sessionId/stop", requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = activeAutopilotSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Autopilot session not found" });
    }

    const { excludedStepIndices = [] } = req.body || {};

    // Filter out excluded steps
    const finalSteps = session.steps.filter((_, idx) => !excludedStepIndices.includes(idx));

    // Persist filtered steps
    await seleniumAgentService.recordRunSteps(sessionId, finalSteps, { final: true });

    // Calculate metrics
    const duration = Date.now() - session.startTime.getTime();

    // Remove from active sessions
    activeAutopilotSessions.delete(sessionId);

    logger.info(`[Selenium Autopilot] Session stopped: ${sessionId}, ${finalSteps.length} steps persisted`);

    res.json({
      sessionId,
      status: "stopped",
      steps: finalSteps,
      stepCount: finalSteps.length,
      durationMs: duration,
      startUrl: session.startUrl,
      goal: session.goal,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/selenium/replay/:sessionId
 * Replay a recorded session
 */
router.post("/selenium/replay/:sessionId", requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Get steps from database
    const steps = await seleniumAgentService.getRunSteps(sessionId);

    if (steps.length === 0) {
      return res.status(404).json({ error: "No recording found for this session" });
    }

    // Create a new replay session
    const replaySessionId = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const startUrl = steps.find(s => s.action === "goto")?.value || (steps[0]?.metadata as any)?.value;

    if (!startUrl) {
      return res.status(400).json({ error: "Cannot replay: no start URL found in recording" });
    }

    // Store replay session
    activeAutopilotSessions.set(replaySessionId, {
      steps: [],
      startUrl,
      goal: `Replay of session ${sessionId}`,
      context: {
        organizationId: (req as any).organizationId || null,
        userId: (req as any).user?.id,
        replayOf: sessionId,
      },
      startTime: new Date(),
    });

    logger.info(`[Selenium Autopilot] Replay session started: ${replaySessionId} (original: ${sessionId})`);

    res.json({
      replaySessionId,
      originalSessionId: sessionId,
      status: "replay_started",
      stepCount: steps.length,
      startUrl,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/selenium/sessions
 * List all active autopilot sessions
 */
router.get("/selenium/sessions", requireAuth, async (req, res, next) => {
  try {
    const sessions = Array.from(activeAutopilotSessions.entries()).map(([id, session]) => ({
      sessionId: id,
      startUrl: session.startUrl,
      goal: session.goal,
      startTime: session.startTime,
      stepCount: session.steps.length,
      status: session.steps.length > 0 ? "running" : "started",
    }));

    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

export default router;
