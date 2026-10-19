// @ts-nocheck

import { Router } from "express";
import { z } from "zod";
import { requireAuth, seleniumRateLimiter } from "@domain/core/auth/security.service.js";
import { seleniumRecorder } from "@domain/agents/core/selenium-recorder.service.js";
import { seleniumAgentService } from "@domain/agents/core/selenium-agent.service.js";
import { seleniumCaptureService } from "@domain/agents/core/selenium-capture.service.js";

const router = Router();

// Active capture sessions (for cleanup)
const activeCapturePages: Map<string, { page: any; cleanup: () => Promise<void> }> = new Map();

// Selenium Recorder
router.post("/record", requireAuth, seleniumRateLimiter, async (req, res, next) => {
    try {
        const schema = z.object({
            url: z.string().url().optional(),
        });

        const validation = schema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
        }

        const { url } = validation.data;
        const steps = await seleniumRecorder.recordSteps(url);
        res.json({ steps });
    } catch (error) {
        next(error);
    }
});

// Selenium Auto-Pilot
router.post("/autopilot", requireAuth, seleniumRateLimiter, async (req, res, next) => {
    try {
        const schema = z.object({
            url: z.string().url(),
            goal: z.string().min(5).max(1000),
            datasetId: z.number().int().optional(),
        });

        const validation = schema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
        }

        const { url, goal, datasetId } = validation.data;

        // Set a higher timeout for this request as it runs the agent loop
        req.setTimeout(120000); // 2 minutes

        const context = {
            organizationId: (req as any).organizationId || null,
            userId: (req as any).user?.id
        };

        const steps = await seleniumAgentService.runAutoPilot(url, goal, context, datasetId);
        res.json({ steps });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// CAPTURE TOOLS - Interactive right-click capture
// ============================================================================

const startCaptureSchema = z.object({
    url: z.string().url(),
    steps: z.array(z.any()).optional()
});

/**
 * Start an interactive capture session
 * Opens a browser window where user can Ctrl+Right-click to capture
 */
router.post("/capture/start", requireAuth, seleniumRateLimiter, async (req, res, next) => {
    try {
        const validation = startCaptureSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
        }

        const { url, steps } = validation.data;

        const { sessionId, page, cleanup } = await seleniumCaptureService.startCaptureSession(url, steps);

        // Store for later cleanup
        activeCapturePages.set(sessionId, { page, cleanup });

        // Listen for captures (for real-time updates via SSE/WebSocket if implemented)
        seleniumCaptureService.on('capture', ({ sessionId: sid, capture }) => {
            if (sid === sessionId) {
                console.log(`[Capture] Session ${sessionId} captured:`, capture.type);
            }
        });

        res.json({
            sessionId,
            message: "Capture session started. Use Ctrl+Right-click or Shift+Right-click in the browser to open capture menu.",
            instructions: [
                "?? Capture Image - Right-click on an image",
                "?? Capture Text Block - Right-click on a text element",
                "?? Capture Selection - Select text first, then right-click",
                "?? Capture Element - Capture the full HTML of the element",
                "?? Full Screenshot - Take a screenshot of the current page",
            ]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get all active capture sessions
 */
router.get("/capture/sessions", requireAuth, async (_req, res, next) => {
    try {
        const activeSessions = seleniumCaptureService.getActiveSessions();
        res.json(activeSessions.map(s => ({
            sessionId: s.id,
            url: s.url,
            createdAt: s.createdAt,
            eventCount: s.events.length
        })));
    } catch (error) {
        next(error);
    }
});

/**
 * Get captures from an active session
 */
router.get("/capture/:sessionId", requireAuth, async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        const sessionData = seleniumCaptureService.getEvents(sessionId);
        const session = (seleniumCaptureService as any).sessions.get(sessionId); // Hack to get metadata if needed

        if (!session) {
            return res.status(404).json({ error: "Capture session not found" });
        }

        res.json({
            sessionId: session.id,
            url: session.url,
            active: session.active,
            eventCount: session.events.length,
            events: session.events,
            createdAt: session.createdAt,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Stop a capture session and get final results
 */
// Stop a capture session and get final results
router.post("/capture/:sessionId/stop", requireAuth, async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const schema = z.object({
            excludedEventIds: z.array(z.string()).optional()
        });

        // Allow body to be empty or contain the optional field
        const validation = schema.safeParse(req.body || {});

        const sessionData = activeCapturePages.get(sessionId);
        if (sessionData) {
            await sessionData.cleanup();
            activeCapturePages.delete(sessionId);
        }

        const session = (seleniumCaptureService as any).sessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: "Capture session not found" });
        }

        let eventsToProcess = session.events;
        if (validation.success && validation.data.excludedEventIds) {
            const excluded = new Set(validation.data.excludedEventIds);
            eventsToProcess = session.events.filter((e: any) => !excluded.has(e.id));
        }

        // Convert unified events to Selenium steps
        const steps = seleniumCaptureService.eventsToSteps(eventsToProcess);

        res.json({
            sessionId: session.id,
            message: "Capture session stopped",
            eventCount: eventsToProcess.length,
            events: session.events, // Return original full list if needed, or filtered? Returning full list is fine for audit.
            steps, // Ready-to-use Selenium steps (filtered)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Take a manual screenshot during a capture session
 */
router.post("/capture/:sessionId/screenshot", requireAuth, async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const schema = z.object({
            fullPage: z.boolean().default(false),
            extractAs: z.string().optional(),
        });

        const validation = schema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
        }

        const { fullPage, extractAs } = validation.data;

        const sessionData = activeCapturePages.get(sessionId);
        if (!sessionData) {
            return res.status(404).json({ error: "Active capture session not found" });
        }

        const screenshot = await sessionData.page.screenshot({
            encoding: 'base64',
            fullPage,
        });

        const capture = {
            id: extractAs || `screenshot_${Date.now()}`,
            type: 'screenshot' as const,
            content: screenshot,
            metadata: {
                sourceUrl: await sessionData.page.url(),
                timestamp: new Date().toISOString(),
            },
        };

        // Add to session events
        const session = (seleniumCaptureService as any).sessions.get(sessionId);
        if (session) {
            session.events.push(capture);
        }

        res.json({
            success: true,
            capture,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Navigate to a different URL during capture session
 */
router.post("/capture/:sessionId/navigate", requireAuth, async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const schema = z.object({
            url: z.string().url(),
        });

        const validation = schema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: "Invalid input", details: validation.error.format() });
        }

        const { url } = validation.data;

        const sessionData = activeCapturePages.get(sessionId);
        if (!sessionData) {
            return res.status(404).json({ error: "Active capture session not found" });
        }

        await sessionData.page.goto(url, { waitUntil: 'domcontentloaded' });

        res.json({
            success: true,
            message: `Navigated to ${url}`,
            currentUrl: await sessionData.page.url(),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * List all capture sessions
 */
router.get("/capture", requireAuth, async (req, res, next) => {
    try {
        const sessions: any[] = [];

        // Get active sessions from map
        for (const [id] of activeCapturePages) {
            const session = (seleniumCaptureService as any).sessions.get(id);
            if (session) {
                sessions.push({
                    sessionId: session.id,
                    url: session.url,
                    active: session.active,
                    eventCount: session.events.length,
                    createdAt: session.createdAt,
                });
            }
        }

        res.json({ sessions });
    } catch (error) {
        next(error);
    }
});

export default router;

