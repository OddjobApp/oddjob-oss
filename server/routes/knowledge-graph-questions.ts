import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { knowledgeBaseQuestionEngineService } from "../domain/agents/core/knowledge-base-question-engine.service.js";
import { KNOWLEDGE_NODE_LABELS } from "../domain/knowledge/core/node-labels.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("KnowledgeGraphQuestionsRouter");
const router = Router();

router.use(requireAuth);

/**
 * GET /api/knowledge-graph/questions
 * Returns active pending questions for a repository.
 */
router.get("/questions", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  if (!orgContext.organizationId) {
    return res.status(401).json({ error: "Organization context missing" });
  }

  const { repoId } = req.query;
  if (!repoId || typeof repoId !== "string") {
    return res.status(400).json({ error: "Missing or invalid repoId query parameter" });
  }

  const questions = await knowledgeBaseQuestionEngineService.listQuestions(
    orgContext.organizationId,
    repoId
  );

  res.json(questions);
}));

/**
 * POST /api/knowledge-graph/questions/:id/resolve
 * Resolves a question with an action (approve, edit, ignore).
 */
router.post("/questions/:id/resolve", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  if (!orgContext.organizationId) {
    return res.status(401).json({ error: "Organization context missing" });
  }

  const questionId = parseInt(req.params.id, 10);
  if (isNaN(questionId)) {
    return res.status(400).json({ error: "Invalid question ID" });
  }

  const { answerText, action } = req.body;
  if (!action || !["approve", "edit", "ignore"].includes(action)) {
    return res.status(400).json({ error: "Missing or invalid action parameter" });
  }

  if (action === "edit" && (!answerText || typeof answerText !== "string")) {
    return res.status(400).json({ error: "answerText is required for edit action" });
  }

  const username = (req as any).user?.username || (req as any).user?.email || "developer";

  await knowledgeBaseQuestionEngineService.resolveQuestion(
    orgContext.organizationId,
    questionId,
    answerText || "",
    username,
    action
  );

  res.json({ success: true });
}));

/**
 * GET /api/knowledge-graph/questions/forge/:blueprintSlug
 * Convenience route for App Forge blueprint question queues.
 * Equivalent to GET /questions?repoId=forge:<blueprintSlug> but with a
 * cleaner URL that the Forge UI and Slack notifications can link directly.
 */
router.get("/questions/forge/:blueprintSlug", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  if (!orgContext.organizationId) {
    return res.status(401).json({ error: "Organization context missing" });
  }

  const { blueprintSlug } = req.params;
  if (!blueprintSlug) {
    return res.status(400).json({ error: "Missing blueprintSlug" });
  }

  const questions = await knowledgeBaseQuestionEngineService.listQuestions(
    orgContext.organizationId,
    `forge:${blueprintSlug}`
  );

  res.json(questions);
}));

/**
 * GET /api/knowledge-graph/node-labels
 * Returns the canonical set of node labels so the client filter UI
 * never needs to hard-code them.
 */
router.get("/node-labels", asyncHandler(async (_req: Request, res: Response) => {
  res.json(KNOWLEDGE_NODE_LABELS);
}));

export default router;
