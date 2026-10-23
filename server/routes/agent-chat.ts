
import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { assertOrgId, getUserOrgContext } from "../utils/auth-context.js";
import { withProjectScope } from "../middleware/project-scope.js";
import multer from "multer";
import { agentService } from "../domain/agents/agent.service.js";
import { dailyBriefService } from "../domain/admin/core/daily-brief.service.js";
import { toolAnalyticsService } from "../domain/agents/core/tool-analytics.service.js";
import { AGENT_TOOLS } from "../domain/tools/v1/tool-registry.service.js";
import { mapAgentError } from "./agent-error-map.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

export function registerAgentChatRoutes(app: any) {
    const router = Router();

    // GET /api/agent/tools - List available tools for agent configuration
    router.get("/tools", requireAuth, (req: Request, res: Response) => {
        // AGENT_TOOLS is now imported statically

        const tools = Object.values(AGENT_TOOLS).map((t: any) => ({
            id: t.name,
            label: t.label || t.name,
            description: t.description,
            group: t.group || "Other",
            adminOnly: t.adminOnly
        }));

        // Sort by group then label
        tools.sort((a: any, b: any) => {
            if (a.group !== b.group) return a.group.localeCompare(b.group);
            return a.label.localeCompare(b.label);
        });

        res.json(tools);
    });

    // GET /api/agent/tool-recommendations - Recommend tools for a goal (AI_AGENT_ENHANCEMENTS_SPEC)
    router.get("/tool-recommendations", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const goal = req.query.goal as string;
        const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;

        if (!goal || goal.trim().length < 3) {
            return res.json([]);
        }

        const orgContext = await getUserOrgContext(req);
        const organizationId = orgId ?? assertOrgId(orgContext.organizationId);

        const recommendations = await toolAnalyticsService.getRecommendedTools(goal, organizationId, Math.min(limit, 20));
        res.json(recommendations);
    }));

    // GET /api/agent/trajectories - Export conversational trajectories as fine-tuning/eval JSONL
    router.get("/trajectories", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const overrideOrgId = orgContext.isSuperAdmin && req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
        const organizationId = overrideOrgId && !Number.isNaN(overrideOrgId) ? overrideOrgId : assertOrgId(orgContext.organizationId);
        const format = (["openai", "anthropic", "gemini"].includes(req.query.format as string) ? req.query.format : "openai") as any;
        const userId = req.query.userId as string | undefined;
        const sinceDays = req.query.sinceDays ? parseInt(req.query.sinceDays as string, 10) : undefined;
        const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 20000) : undefined;

        const { conversationTrajectoryService } = await import("@domain/agents/core/conversation-trajectory.service.js");
        const { jsonl, trajectories, turns } = await conversationTrajectoryService.exportAsJsonl(organizationId, format, { userId, sinceDays, limit });

        res.setHeader("Content-Type", "application/jsonl");
        res.setHeader("Content-Disposition", `attachment; filename="assistant-trajectories-${format}.jsonl"`);
        res.setHeader("X-Trajectory-Count", String(trajectories));
        res.setHeader("X-Turn-Count", String(turns));
        res.send(jsonl);
    }));

    // POST /api/agent/upload - Upload files for AI analysis
    router.post("/upload", requireAuth, upload.array("files", 5), asyncHandler(async (req: Request, res: Response) => {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({ error: "No files provided" });
        }

        const uploadedFiles = await agentService.processUploadedFiles(files);
        res.json({ files: uploadedFiles });
    }));

    // POST /api/agent/chat - Send a message to the system agent
    // withProjectScope resolves the active Project Space so the copilot inherits it —
    // an explicit, user-changeable selection replacing the old "last cycle touched"
    // guess. It reaches tools through ToolContext (PROJECT_SPACES_DESIGN §6.4).
    router.post("/chat", requireAuth, withProjectScope(), asyncHandler(async (req: Request, res: Response) => {
        const { message, context: clientContext, attachments } = req.body;
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId || "system";
        // Super-admins may scope the chat to a specific org via ?orgId (consistent
        // with the sibling GET endpoints and the client's apiRequest convention).
        const overrideOrgId = orgContext.isSuperAdmin && req.query.orgId
            ? parseInt(req.query.orgId as string, 10)
            : undefined;


        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        const buildUserContext = () => ({
            organizationId: overrideOrgId && !Number.isNaN(overrideOrgId)
                ? overrideOrgId
                : (orgContext.organizationId ? Number(orgContext.organizationId) : null),
            userId,
            isAdmin: orgContext.isAdmin,
            isSuperAdmin: orgContext.isSuperAdmin,
            isOrgAdmin: orgContext.isOrgAdmin,
            // Active Project Space — flows into ToolContext so discover_capabilities
            // ranks in-project missions first and retrieval can narrow to scope.
            projectId: req.projectId ?? null,
            projectKey: req.projectKey ?? null,
        });

        // ── Streaming transport (SSE) ─────────────────────────────────────────
        // Opt-in via `Accept: text/event-stream`. Emits `status` events during the
        // agent loop, a `final` event with the answer, and a `meta` event with the
        // persisted messageId. Non-SSE clients (embed/public/legacy) fall through
        // to the unchanged JSON path below.
        const wantsStream = (req.headers.accept || "").includes("text/event-stream");
        if (wantsStream) {
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no"); // disable nginx proxy buffering
            res.flushHeaders();

            const sse = (event: string, data: any) => {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                if (typeof (res as any).flush === "function") (res as any).flush();
            };

            // SSE comment keepalive (ignored by EventSource/parsers) to defeat proxy idle timeouts.
            const ping = setInterval(() => {
                res.write(`: ping\n\n`);
                if (typeof (res as any).flush === "function") (res as any).flush();
            }, 15000);

            let sentFinal = false;
            try {
                const result: any = await agentService.chat({
                    message,
                    context: clientContext,
                    attachments,
                    userContext: buildUserContext(),
                    onEvent: (evt) => {
                        if (evt.type === "final") sentFinal = true;
                        sse(evt.type, evt.data ?? {});
                    },
                });

                // Fast-paths (greeting/app/intake/trivial) return without emitting a
                // `final`; surface their result as one final event here.
                if (!sentFinal) {
                    const respStr = typeof result === "string" ? result : (typeof result?.response === "string" ? result.response : "");
                    const isRich = respStr.includes('"type":"assistant_app"') ||
                        respStr.includes('"type":"assistant_form"') ||
                        respStr.includes('"type":"instant_app"') ||
                        respStr.includes('"type":"instant_app_surface"') ||
                        respStr.includes('"type":"input_request"') ||
                        respStr.includes('"type":"mode_switch_request"') ||
                        respStr.includes('"type":"intent_clarification"');
                    if (typeof result === "string") {
                        sse("final", { response: result, _richResponse: isRich });
                    } else {
                        sse("final", {
                            response: result?.response,
                            _richResponse: isRich,
                            metadata: result?.metadata,
                            scope: result?.scope,
                            missionId: result?.missionId
                        });
                    }
                    if (result?.messageId) sse("meta", { messageId: result.messageId });
                }

                sse("done", {});
            } catch (error: any) {
                console.error("Agent Chat Error (stream):", error);
                const { userMessage, errorCode } = mapAgentError(error?.message || "Internal Agent Error");
                // Deliver the error as a normal answer so the rendered bubble shows it.
                sse("final", { response: userMessage, error: userMessage, errorCode });
                sse("done", {});
            } finally {
                clearInterval(ping);
                res.end();
            }
            return;
        }

        try {
            // Write headers early to prevent external proxy (Ngrok, Cloudflare, Vite) Gateway Timeouts (504)
            // for long-running Agent loops. We use JSON whitespace padding.
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200);
            res.flushHeaders();

            // Keep the connection alive by writing a space every 15 seconds.
            // Leading whitespace is perfectly valid in JSON and will be ignored by res.json() on the client.
            const keepAliveInterval = setInterval(() => {
                res.write(" ");
                // flush if possible
                if (typeof (res as any).flush === 'function') {
                    (res as any).flush();
                }
            }, 15000);

            let result: any;
            try {
                result = await agentService.chat({
                    message,
                    context: clientContext,
                    attachments,
                    userContext: buildUserContext(),
                });
            } finally {
                clearInterval(keepAliveInterval);
            }

            // Handle both string and object returns for backward compatibility
            // If result is already a rich response JSON string (from render tools), don't double-wrap it
            const respStr = typeof result === "string" ? result : (typeof result?.response === "string" ? result.response : "");
            const isRichResponse = respStr.includes('"type":"assistant_app"') ||
                respStr.includes('"type":"assistant_form"') ||
                respStr.includes('"type":"instant_app"') ||
                respStr.includes('"type":"instant_app_surface"') ||
                respStr.includes('"type":"input_request"') ||
                respStr.includes('"type":"mode_switch_request"') ||
                respStr.includes('"type":"intent_clarification"');
            
            const responseData = typeof result === "string"
                ? { response: result, _richResponse: isRichResponse } 
                : { ...result, _richResponse: isRichResponse };
            res.write(JSON.stringify(responseData));
            res.end();

        } catch (error: any) {
            console.error("Agent Chat Error:", error);

            // Parse error message for user-friendly feedback
            const errorMessage = error.message || "Internal Agent Error";
            const { userMessage, errorCode } = mapAgentError(errorMessage);

            // If headers were already sent (which they were), we can't change the status code to 500 now.
            // We just send the error object and the client will still parse it as JSON.
            // The frontend doesn't throw on 200, so we wrap it in a format the frontend handles?
            // Actually, frontend checks `!res.ok`. Since we sent 200, it will parse it as SUCCESS.
            // But if we send `error` field, the frontend `AgentChatSheet` handles:
            // "data.response || 'No response received'"
            // Wait, so we should map the error to `response` so the user SEES the error!
            res.write(JSON.stringify({ 
                response: userMessage, 
                error: userMessage, 
                errorCode: errorCode, 
                details: process.env.NODE_ENV === 'development' ? errorMessage : undefined 
            }));
            res.end();
        }
    }));

    // GET /api/agent/daily-brief - Deterministic, real-data daily brief for the
    // Copilot. Bypasses the LLM (no hallucination / quota / timeout failures);
    // aggregates live dashboard stats, cost, insights, and pending approvals.
    router.get("/daily-brief", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const overrideOrgId = orgContext.isSuperAdmin && req.query.orgId
            ? parseInt(req.query.orgId as string, 10)
            : undefined;
        const effectiveOrgId = overrideOrgId && !Number.isNaN(overrideOrgId)
            ? overrideOrgId
            : (orgContext.organizationId ? Number(orgContext.organizationId) : null);

        const brief = await dailyBriefService.getDailyBrief({
            isSuperAdmin: orgContext.isSuperAdmin,
            organizationId: effectiveOrgId,
        });
        res.json(brief);
    }));

    // POST /api/agent/intake-form/submit - Persist a submitted intake form (e.g. the
    // bug-report form_agent) into its configured output dataset, wiring the
    // Assistant-rendered form to the pipeline's data store.
    router.post("/intake-form/submit", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const organizationId = assertOrgId(orgContext.organizationId);
        const formJobId = Number(req.body?.formJobId);
        const data = req.body?.data;
        if (!Number.isInteger(formJobId) || formJobId <= 0) {
            return res.status(400).json({ error: "formJobId (positive integer) is required" });
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return res.status(400).json({ error: "data (object) is required" });
        }

        const { jobService } = await import("../domain/jobs/job.service.js");
        // Load the form job in the caller's org so a user can only submit forms
        // they can see; getById is org-scoped and throws if not found.
        const job = await jobService.getById(formJobId, orgContext);
        if (job.type !== "form_agent") {
            return res.status(400).json({ error: "Target job is not a form_agent" });
        }
        if (!job.outputDatasetId) {
            return res.status(409).json({
                error: "This form has no output dataset configured, so submissions cannot be saved yet.",
            });
        }

        // Persist the submission as a row in the form's configured dataset. This is
        // the real dataset-write path (jobService.storeOutput only feeds the
        // knowledge store and ignores outputDatasetId).
        const { datasetService } = await import("../domain/knowledge/core/dataset-service.js");
        const result = await datasetService.addItems(
            job.outputDatasetId,
            [{ data: { ...data, _submittedVia: "assistant", _submittedAt: new Date().toISOString() } }],
            orgContext,
        );

        let datasetName: string | undefined;
        try {
            const ds = await datasetService.getById(job.outputDatasetId, orgContext);
            datasetName = ds?.name;
        } catch { /* name is best-effort */ }

        const stored = (result?.inserted ?? 0) > 0;
        res.json({
            stored,
            inserted: result?.inserted ?? 0,
            datasetId: job.outputDatasetId,
            datasetName,
            message: stored
                ? `Bug report saved to ${datasetName ?? `dataset ${job.outputDatasetId}`}.`
                : "Submission was not saved.",
        });
    }));

    // GET /api/agent/long-term-memories - Retrieve cross-mission facts and preferences
    router.get("/long-term-memories", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const { longTermMemoryService } = await import("../domain/agents/core/long-term-memory.service.js");
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;
        const search = req.query.search as string;

        const results = await longTermMemoryService.recall({
            organizationId: orgContext.organizationId ? Number(orgContext.organizationId) : 1,
            userId,
            search,
            limit: 100
        });

        res.json(results);
    }));

    // POST /api/agent/feedback/:messageId - Rate an AI response
    router.post("/feedback/:messageId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const messageId = validateIdParam(req.params.messageId, 'messageId');
        const { rating, feedback, reason, feedbackReason } = req.body;
        const orgContext = await getUserOrgContext(req);

        if (isNaN(messageId)) {
            return res.status(400).json({ error: "Invalid message ID" });
        }

        if (rating !== 1 && rating !== -1) return res.status(400).json({ error: 'Rating must be 1 or -1.' });
        await agentService.submitFeedback(messageId, { rating, feedback, reason, feedbackReason }, orgContext);

        res.json({ success: true });
    }));

    app.use("/api/agent", router);
}

