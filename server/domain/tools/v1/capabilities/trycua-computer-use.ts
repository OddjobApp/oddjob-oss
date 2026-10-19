import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { trycuaService } from "../../../integrations/trycua/trycua-service.js";
import { trycuaComputerUseTaskService } from "../../../integrations/trycua/computer-use-task.service.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("TrycuaTools");

/**
 * Record an action as a task step, without making the action wait for it.
 *
 * Deliberately not awaited: the step is bookkeeping for the TaskDock, and a
 * recording problem must not fail an action that already happened on the
 * desktop. It IS logged - `catch(() => undefined)` here meant a session whose
 * steps quietly stopped appearing looked like a session doing nothing.
 */
function recordStep(input: Parameters<typeof trycuaComputerUseTaskService.recordDirectAction>[0]): void {
    void trycuaComputerUseTaskService.recordDirectAction(input).catch((err: unknown) =>
        logger.warn("Failed to record a computer-use step", {
            action: input.action,
            sessionId: input.sessionId,
            error: err instanceof Error ? err.message : String(err),
        }),
    );
}

// ============================================================================
// Trycua Computer-Use Tools
// Expose sandboxed desktop/browser control to agents as first-class tools.
//
// Session lifecycle pattern:
//   trycua_create_session  →  trycua_screenshot  →  trycua_click / trycua_type_text
//   →  trycua_screenshot (verify)  →  … repeat …  →  trycua_end_session
// ============================================================================

export const TRYCUA_TOOLS: Record<string, ToolDefinition> = {

    trycua_teach_task: {
        name: "trycua_teach_task",
        idempotency: "read-safe",
        label: "Teach a Browser Task",
        group: "Computer Use",
        riskLevel: "low",
        description: "Open Teach a Task in Computer Use Studio when the user wants to demonstrate or teach a browser workflow. The user starts recording, edits variables and outputs, tests the draft, and approves it. Opening the studio does not start recording or grant tools to an agent.",
        parameters: z.object({ goal: z.string().max(2000).optional(), sessionId: z.string().optional() }),
        execute: async ({ goal, sessionId }) => ({
            success: true, type: "assistant_app", module: "ComputerUseStudioPod", title: "Teach a task",
            props: { initialTeaching: true, goal, sessionId },
            artifact: { type: "assistant_app", module: "ComputerUseStudioPod", title: "Teach a task", props: { initialTeaching: true, goal, sessionId } },
        }),
    },

    trycua_create_session: {
        name: "trycua_create_session",

        idempotency: "none",
        label: "Create Computer Session",
        group: "Computer Use",
        riskLevel: "high",
        description:
            "Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; " +
            "each organization has its own, started on demand). Returns a sessionId that must be passed to " +
            "all subsequent trycua_* tool calls. People can watch or take over the same desktop from " +
            "\"Open desktop\". Always end the session with trycua_end_session when done.",
        parameters: z.object({
            os: z.enum(["linux", "windows", "macos"])
                .default("linux")
                .describe("Operating system. Oddjob-managed desktops are Linux; windows/macos only work with a Cua cloud sandbox"),
            sandboxName: z.string().optional()
                .describe("Cua cloud sandbox name. Ignored on Oddjob-managed per-organization desktops"),
        }),
        execute: async ({ os, sandboxName }, context) => {
            try {
                const session = await trycuaService.createSession({
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    requestedOs: os,
                    sandboxName,
                    jobId: context.jobId ?? undefined,
                    missionRunId: context.missionId ?? undefined,
                });
                return JSON.stringify({
                    sessionId: session.id,
                    os: session.os,
                    status: session.status,
                    expiresAt: session.expiresAt,
                    message: `Computer session created (${os}). Use sessionId in all subsequent trycua_* calls.`,
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error creating computer session: ${msg}`;
            }
        },
    },

    trycua_screenshot: {
        name: "trycua_screenshot",

        idempotency: "read-safe",
        label: "Take Screenshot",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Capture the current screen as a base64-encoded PNG. Call this after every action " +
            "to verify the result before proceeding.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID from trycua_create_session"),
        }),
        execute: async ({ sessionId }, context) => {
            try {
                const { trycuaComputerIntelligenceService } = await import(
                    "../../../integrations/trycua/computer-intelligence.service.js"
                );
                const observation = await trycuaComputerIntelligenceService.observeSession({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    includeScreenshot: true,
                });
                return JSON.stringify({
                    sessionId,
                    screenshotDataUrl: observation.screenshot.dataUrl,
                    ui: observation.ui,
                    limitations: observation.limitations,
                    message: "Use the observed UI targets; do not invent coordinates when analysis is unavailable.",
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error taking screenshot: ${msg}`;
            }
        },
    },

    trycua_click: {
        name: "trycua_click",

        idempotency: "none",
        label: "Click at Coordinates",
        group: "Computer Use",
        riskLevel: "medium",
        description:
            "Click at the given x,y screen coordinates. " +
            "Use trycua_screenshot first to identify element positions.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            x: z.number().int().describe("X pixel coordinate"),
            y: z.number().int().describe("Y pixel coordinate"),
        }),
        execute: async ({ sessionId, x, y }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                    { action: "click", params: { x, y } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "click",
                    payload: { x, y },
                    result,
                });
                return JSON.stringify({ sessionId, action: "click", x, y, result });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error clicking at (${x}, ${y}): ${msg}`;
            }
        },
    },

    trycua_type_text: {
        name: "trycua_type_text",

        idempotency: "none",
        label: "Type Text",
        group: "Computer Use",
        riskLevel: "medium",
        description:
            "Type text into the currently focused input field. " +
            "Click the target field first, then call this tool.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            text: z.string().max(5000).describe("Text to type"),
        }),
        execute: async ({ sessionId, text }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                    { action: "type_text", params: { text } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "type_text",
                    payload: { text: `[REDACTED_TEXT:${text.length}]` },
                    result,
                });
                return JSON.stringify({
                    sessionId,
                    action: "type_text",
                    charCount: text.length,
                    result,
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error typing text: ${msg}`;
            }
        },
    },

    trycua_key_press: {
        name: "trycua_key_press",

        idempotency: "none",
        label: "Press Key",
        group: "Computer Use",
        riskLevel: "medium",
        description:
            "Press a key or a key combination. Examples: 'Enter', 'Tab', 'Escape', 'PageDown', 'ctrl+c', 'ctrl+shift+t'. " +
            "Combinations are joined with '+'.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            key: z.string().max(64).describe("Key name or combination (e.g. 'Enter', 'ctrl+a')"),
        }),
        execute: async ({ sessionId, key }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                    { action: "key_press", params: { key } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "key_press",
                    payload: { key },
                    result,
                });
                return JSON.stringify({ sessionId, action: "key_press", key, result });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error pressing key '${key}': ${msg}`;
            }
        },
    },

    trycua_scroll: {
        name: "trycua_scroll",

        idempotency: "none",
        label: "Scroll Screen",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Scroll at the mouse pointer by mouse-wheel clicks (roughly 50-100px each). Positive deltaY scrolls down; negative scrolls up.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            deltaX: z.number().default(0).describe("Horizontal scroll in wheel clicks (positive = right)"),
            deltaY: z.number().describe("Vertical scroll in wheel clicks (positive = down)"),
        }),
        execute: async ({ sessionId, deltaX, deltaY }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                    { action: "scroll", params: { deltaX, deltaY } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "scroll",
                    payload: { deltaX, deltaY },
                    result,
                });
                return JSON.stringify({ sessionId, action: "scroll", deltaX, deltaY, result });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error scrolling: ${msg}`;
            }
        },
    },

    trycua_wait: {
        name: "trycua_wait",

        idempotency: "read-safe",
        label: "Wait",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Pause for a number of milliseconds. Use to wait for page loads or animations.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            ms: z.number().int().min(100).max(10000).describe("Milliseconds to wait (100–10000)"),
        }),
        execute: async ({ sessionId, ms }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                    { action: "wait", params: { ms } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "wait",
                    payload: { ms },
                    result,
                });
                return JSON.stringify({ sessionId, action: "wait", ms, result });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error waiting: ${msg}`;
            }
        },
    },

    trycua_find_element: {
        name: "trycua_find_element",

        idempotency: "read-safe",
        label: "Find Element on Screen",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Use vision AI to find the coordinates of an element on the screen matching the query.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            query: z.string().describe("Description of the element to find (e.g., 'Submit button', 'Settings icon')"),
        }),
        execute: async ({ sessionId, query }, context) => {
            try {
                const { trycuaComputerIntelligenceService, resolveGroundedTarget } = await import(
                    "../../../integrations/trycua/computer-intelligence.service.js"
                );
                const observation = await trycuaComputerIntelligenceService.observeSession({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    includeScreenshot: true,
                });
                const grounding = resolveGroundedTarget({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    instruction: `click ${query}`,
                    target: { label: query },
                }, observation, query);

                if (grounding.resolved && grounding.target) {
                    return JSON.stringify({
                        sessionId,
                        query,
                        x: grounding.target.x,
                        y: grounding.target.y,
                        method: grounding.method,
                        confidence: grounding.confidence,
                        label: grounding.target.label,
                    });
                }

                const screenshot = await trycuaService.getScreenshot(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                );
                
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");

                const aiConfig = await systemAiService.getAiConfig('copilot', context?.organizationId as any);
                if (!aiConfig || !aiConfig.apiKey) throw new Error("AI configuration missing");

                const client = AIClientFactory.getClient({ provider: aiConfig.provider } as any);
                
                const prompt = `You are a visual grounding assistant. 
                I have provided a screenshot of a computer screen.
                Please find the element described as: "${query}".
                Return the X and Y coordinates of the CENTER of this element.
                The coordinates should be in pixels relative to the image size.
                Output ONLY a JSON object with keys "x" and "y".
                Example: {"x": 100, "y": 200}`;

                const result = await client.execute({
                    model: aiConfig.model || "gemini-1.5-pro",
                    systemPrompt: "You are a precise visual grounding assistant.",
                    userPrompt: prompt,
                    attachments: [{ type: "image_url", url: screenshot }],
                } as any, undefined, aiConfig.apiKey);

                if (!result.success || !result.output) throw new Error(result.error || "Visual grounding failed");

                try {
                    const coords = JSON.parse(result.output);
                    return JSON.stringify({
                        sessionId,
                        query,
                        x: coords.x,
                        y: coords.y,
                        method: "vision_fallback",
                        confidence: 0.62,
                        warning: grounding.rationale,
                    });
                } catch (e) {
                    return `Failed to parse coordinates from output: ${result.output}`;
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error finding element: ${msg}`;
            }
        },
    },

    trycua_dom_extract: {
        name: "trycua_dom_extract",

        idempotency: "read-safe",
        label: "Extract DOM Content",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Extract structured text or element attributes from the active browser tab via the DevTools Protocol (CDP). " +
            "Significantly faster and more accurate than screenshot OCR for data extraction tasks (search results, table rows, " +
            "form values, structured page metadata). Only available on Oddjob-managed desktops (TRYCUA_PROVIDER_TYPE=org_desktop); " +
            "falls back gracefully with an error if CDP is unavailable. " +
            "Modes: 'text' — inner text of all elements matching the CSS selector; " +
            "'attribute' — value of a specific attribute (e.g. 'href', 'data-id'); " +
            "'full_page_text' — the entire visible text of the page (document.body.innerText); " +
            "'structured_json' — structured text, links, images, accessible labels and non-secret form values; " +
            "'table' — rows and cells from matching tables; 'url' — the active tab URL.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            mode: z.enum(["text", "attribute", "full_page_text", "structured_json", "table", "url"])
                .describe("Extraction mode"),
            selector: z.string().optional()
                .describe("CSS selector to match elements (required except for full_page_text and url)"),
            attribute: z.string().optional()
                .describe("HTML attribute to extract per element (required for attribute mode, e.g. 'href', 'src', 'data-id')"),
            limit: z.number().int().min(1).max(500).optional()
                .describe("Maximum elements to return (default 50)"),
            tabUrl: z.string().optional()
                .describe("Substring of the URL of the tab to read. Give it whenever more than one page may be open; without it the last non-blank tab is used and the result says which."),
            ingestKnowledgeGraph: z.boolean().optional()
                .describe("If true, files the extract as a Knowledge Document (indexed for semantic search) with a graph node linking it to this session"),
        }),
        execute: async ({ sessionId, mode, selector, attribute, limit, tabUrl, ingestKnowledgeGraph }, context) => {
            try {
                const { orgDesktopService } = await import("../../../integrations/trycua/org-desktop.service.js");
                const { connectDesktopBrowser } = await import("../../../integrations/trycua/skill-recorder.js");

                // ensureBrowser returns the CDP host and also ensures Chromium is running
                // with remote debugging. Returns undefined if the provider is not org_desktop.
                if (!context.organizationId) throw new Error("An organization is required");
                const session = await trycuaService.getSession(sessionId, context.organizationId);
                if (session.userId !== context.userId) throw new Error("Session does not belong to this user");
                const cdpHost = await orgDesktopService.ensureBrowser(context.organizationId).catch(() => undefined);
                if (!cdpHost) {
                    return JSON.stringify({ error: "DOM extraction is only available on Oddjob-managed desktops (TRYCUA_PROVIDER_TYPE=org_desktop). Use trycua_observe for other providers." });
                }

                const browser = await connectDesktopBrowser(cdpHost);
                try {
                    const { extractDom, chooseExtractionPage } = await import("../../../integrations/trycua/dom-extraction.js");
                    const pages = browser.contexts().flatMap((c) => c.pages());
                    const chosen = chooseExtractionPage(pages, tabUrl);
                    const page = chosen.page;
                    if (!page) {
                        return JSON.stringify({
                            error: tabUrl
                                ? `No open browser tab matched "${tabUrl}".`
                                : "No open browser tab found in the session.",
                            openTabs: chosen.candidates,
                        });
                    }

                    const results = await extractDom(page, { mode, selector, attribute, limit });

                    let exfiltration: any = undefined;
                    if (ingestKnowledgeGraph) {
                        const { trycuaKnowledgeBridge } = await import("../../../integrations/trycua/trycua-knowledge-bridge.js");
                        const pageTitle = await page.title().catch(() => "Web Scraping Extraction");
                        const pageUrl = page.url();
                        const stringified = typeof results === "string" ? results : JSON.stringify(results, null, 2);
                        exfiltration = await trycuaKnowledgeBridge.ingestScrapedContent({
                            organizationId: context.organizationId,
                            userId: context.userId,
                            title: `${pageTitle} (${mode})`,
                            url: pageUrl,
                            content: stringified,
                            sourceSessionId: sessionId,
                            metadata: { mode, selector, attribute },
                        }).catch((err: any) => ({ success: false, message: err?.message }));
                    }

                    recordStep({
                        sessionId,
                        organizationId: context.organizationId,
                        userId: context.userId!,
                        action: "dom_extract",
                        payload: { mode, selector, attribute, ingestKnowledgeGraph },
                        result: { count: Array.isArray(results) ? results.length : undefined, exfiltration },
                    });

                    // Which tab this came from, always: under Xvfb every tab claims to be
                    // focused and the target list is not recency-ordered, so a silent
                    // choice between several pages is a wrong answer waiting to happen.
                    const source = {
                        extractedFrom: page.url(),
                        ...(chosen.ambiguous
                            ? { ambiguousTab: true, openTabs: chosen.candidates, hint: "Pass tabUrl to name the tab." }
                            : {}),
                    };

                    return JSON.stringify(mode === "full_page_text"
                        ? { mode, ...source, text: results, charCount: String(results).length, exfiltration }
                        : mode === "url"
                            ? { mode, ...source, url: results, exfiltration }
                            : { mode, ...source, selector, attribute, count: Array.isArray(results) ? results.length : 0, results, exfiltration });
                } finally {
                    await browser.close();
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error extracting DOM content: ${msg}`;
            }
        },
    },

    trycua_end_session: {
        name: "trycua_end_session",

        idempotency: "idempotent",
        label: "End Computer Session",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Terminate a computer session and release its resources. " +
            "Always call this when the task is complete.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID to terminate"),
        }),
        execute: async ({ sessionId }, context) => {
            try {
                const terminated = await trycuaService.endSession(
                    sessionId,
                    context.organizationId!,
                    context.userId!,
                );
                return terminated
                    ? `Session ${sessionId} terminated successfully.`
                    : `Session ${sessionId} was already inactive.`;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Error ending session: ${msg}`;
            }
        },
    },

    trycua_navigate: {
        name: "trycua_navigate",

        idempotency: "none",
        label: "Navigate Browser",
        group: "Computer Use",
        riskLevel: "low",
        description: "Open an http(s) URL in the desktop's browser (a new tab if it is already open), or go back/forward/refresh.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            action: z.enum(["browser_navigate", "browser_back", "browser_forward", "browser_refresh"])
                .describe("Navigation action"),
            url: z.string().optional().describe("URL to navigate to (required for browser_navigate)"),
        }),
        execute: async ({ sessionId, action, url }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId, context.organizationId!, context.userId!,
                    { action, params: url ? { url } : {} },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action,
                    payload: url ? { url } : {},
                    result,
                });
                return JSON.stringify({ sessionId, action, url, result });
            } catch (err: unknown) {
                return `Navigation error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },

    trycua_window: {
        name: "trycua_window",

        idempotency: "none",
        label: "Window Management",
        group: "Computer Use",
        riskLevel: "low",
        description: "Maximize or minimize the active window. Focusing a window by title is only available on Cua cloud sandboxes.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            action: z.enum(["window_focus", "window_maximize", "window_minimize"])
                .describe("Window action"),
            title: z.string().optional().describe("Window title or partial title to target"),
        }),
        execute: async ({ sessionId, action, title }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId, context.organizationId!, context.userId!,
                    { action, params: title ? { title } : {} },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action,
                    payload: title ? { title } : {},
                    result,
                });
                return JSON.stringify({ sessionId, action, title, result });
            } catch (err: unknown) {
                return `Window action error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },

    trycua_file_upload: {
        name: "trycua_file_upload",

        idempotency: "none",
        label: "Upload File",
        group: "Computer Use",
        riskLevel: "high",
        description: "Upload a file from a path inside the sandbox into an open file dialog. Only available on Cua cloud sandboxes, not on Oddjob-managed desktops.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
            path: z.string().describe("Absolute path of the file to upload inside the sandbox"),
        }),
        execute: async ({ sessionId, path }, context) => {
            try {
                const result = await trycuaService.executeAction(
                    sessionId, context.organizationId!, context.userId!,
                    { action: "file_upload", params: { path } },
                );
                recordStep({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    action: "file_upload",
                    payload: { path },
                    result,
                });
                return JSON.stringify({ sessionId, action: "file_upload", path, result });
            } catch (err: unknown) {
                return `File upload error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },

    trycua_observe: {
        name: "trycua_observe",

        idempotency: "read-safe",
        label: "Observe Screen (Vision)",
        group: "Computer Use",
        riskLevel: "low",
        description: "Take a screenshot and run Gemini Vision OCR to identify visible text, UI elements, and interactive regions. More detailed than trycua_screenshot alone.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID"),
        }),
        execute: async ({ sessionId }, context) => {
            try {
                const { trycuaComputerIntelligenceService } = await import(
                    "../../../integrations/trycua/computer-intelligence.service.js"
                );
                const observation = await trycuaComputerIntelligenceService.observeSession({
                    sessionId,
                    organizationId: context.organizationId!,
                    userId: context.userId!,
                    includeScreenshot: true,
                });
                return JSON.stringify({
                    sessionId,
                    surfaceType: observation.ui.surfaceType,
                    activeApp: observation.ui.activeApp.name,
                    observationSource: observation.ui.source,
                    accessibility: {
                        available: observation.accessibility.available,
                        source: observation.accessibility.source,
                        nodeCount: observation.accessibility.nodes.length,
                        error: observation.accessibility.error,
                    },
                    visibleText: observation.ui.visibleText.slice(0, 20),
                    clickableRegions: observation.ui.clickableRegions.slice(0, 10).map(r => ({
                        label: r.label,
                        bounds: r.bounds,
                        confidence: r.confidence,
                        evidence: r.evidence,
                    })),
                    textInputs: observation.ui.textInputs.slice(0, 5).map(i => ({
                        label: i.label,
                        bounds: i.bounds,
                        confidence: i.confidence,
                        evidence: i.evidence,
                    })),
                    warnings: observation.ui.warnings,
                    limitations: observation.limitations,
                    screenshotDataUrl: observation.screenshot.dataUrl,
                });
            } catch (err: unknown) {
                return `Observation error: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },

    trycua_run_task: {
        name: "trycua_run_task",

        idempotency: "none",
        label: "Run Computer Task",
        group: "Computer Use",
        riskLevel: "high",
        description:
            "Give the computer-use agent a goal in plain language (e.g. 'Open linkedin.com and list my three newest notifications'). " +
            "If an approved learned skill matches, it is replayed first; Gemini computer use then finishes the task from the screen. " +
            "Starts immediately. May pause for a person (a login, a CAPTCHA, a confirmation before an irreversible " +
            "action): the result then says what is needed and where to open the desktop. " +
            "Pass previousTaskId to chain tasks: the model retains full memory of the prior task and continues from the same screen state.",
        parameters: z.object({
            sessionId: z.string().describe("Trycua session ID from trycua_create_session"),
            task: z.string().min(3).max(2000).describe("The goal, in plain language"),
            skillId: z.string().optional().describe("Run this approved learned skill first (see trycua_list_skills)"),
            skillInputs: z.record(z.string()).optional().describe("Values for the skill's inputs; missing ones are read from the task"),
            maxSteps: z.number().int().min(1).max(50).optional().describe("Model turns allowed (default 15)"),
            previousTaskId: z.string().optional().describe(
                "Task ID of a prior completed task in this session. The new task starts with the model's full memory of the prior " +
                "task and continues from the same screen state — no re-navigation needed. Use to chain sequential goals."
            ),
        }),
        execute: async ({ sessionId, task, skillId, skillInputs, maxSteps, previousTaskId }, context) => {
            if (!context.organizationId || !context.userId) return "Error: running a computer task needs an organization and user context.";
            try {
                const { trycuaComputerUseTaskService } = await import("../../../integrations/trycua/computer-use-task.service.js");
                const { task: row, steps } = await trycuaComputerUseTaskService.createTask({
                    sessionId,
                    organizationId: context.organizationId,
                    userId: String(context.userId),
                    task,
                    maxSteps,
                    skillId,
                    skillInputs,
                    previousTaskId,
                    requireConfirmation: false,
                });
                const result = (row.result ?? {}) as Record<string, unknown>;
                return JSON.stringify({
                    taskId: row.id,
                    status: row.status,
                    summary: result.summary,
                    pending: result.pending,
                    error: row.error,
                    skillReplay: steps.filter((s) => s.phase === "skill_replay").map((s) => ({ status: s.status, action: s.action, result: s.result })),
                    steps: steps.length,
                });
            } catch (err: unknown) {
                return `Error running computer task: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },


    trycua_list_skills: {
        name: "trycua_list_skills",

        idempotency: "idempotent",
        label: "List Learned Computer Skills",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "List the organization's learned computer-use skills: browser procedures recorded from a person's actions " +
            "and approved by an admin. Pass a skill's id to trycua_run_task to replay it.",
        parameters: z.object({
            status: z.enum(["active", "draft", "archived"]).default("active").describe("Which skills to list"),
        }),
        execute: async ({ status }, context) => {
            if (!context.organizationId) return "Error: listing skills needs an organization context.";
            try {
                const { learnedSkillsService } = await import("../../../integrations/trycua/learned-skills.service.js");
                const skills = await learnedSkillsService.listSkills(context.organizationId, status);
                return JSON.stringify(skills.map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    site: s.site,
                    inputs: s.inputs,
                    riskClass: s.riskClass,
                    successCount: s.successCount,
                    failureCount: s.failureCount,
                })));
            } catch (err: unknown) {
                return `Error listing skills: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },

    trycua_save_task_as_skill: {
        name: "trycua_save_task_as_skill",
        idempotency: "none",
        label: "Save Computer Task as Skill",
        group: "Computer Use",
        riskLevel: "medium",
        description: "Save the steps of a computer-use task as a draft learned skill. Works for runs that acted on a page (a recorded URL and element); a run that clicked screen coordinates is refused, because there is nothing a browser can replay - use trycua_teach_task for those.",
        parameters: z.object({
            taskId: z.string().describe("Task ID to extract steps from"),
            name: z.string().optional().describe("Optional custom name for the skill"),
            goal: z.string().optional().describe("Optional goal description for the skill"),
        }),
        execute: async ({ taskId, name, goal }, context) => {
            if (!context.organizationId) return "Error: saving skill requires an organization context.";
            try {
                const { learnedSkillsService } = await import("../../../integrations/trycua/learned-skills.service.js");
                const { skill, skipped } = await learnedSkillsService.createSkillFromTask({
                    organizationId: context.organizationId,
                    userId: String(context.userId ?? "system"),
                    taskId,
                    name,
                    goal,
                });
                return JSON.stringify({
                    success: true,
                    skillId: skill.id,
                    name: skill.name,
                    status: skill.status,
                    stepsCount: (skill.steps as any[])?.length ?? 0,
                    procedure: skill.procedure,
                    // Report the gap rather than letting the step count imply the
                    // draft covers the whole run.
                    skippedActions: skipped.length,
                    skippedReasons: [...new Set(skipped.map((s) => s.reason))],
                });
            } catch (err: unknown) {
                return `Error saving task as skill: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    },
    mount_computer_studio: {
        name: "mount_computer_studio",
        idempotency: "read-safe",
        label: "Mount Computer Use Studio",
        group: "Computer Use",
        riskLevel: "low",
        description:
            "Mounts Computer Use Studio in the side rail beside the CREW conversation, allowing visual inspection and live browser/desktop control.",
        parameters: z.object({
            sessionId: z.string().optional().describe("Existing Trycua session ID to attach to."),
            goal: z.string().optional().describe("Goal or objective for the computer-use session."),
            teach: z.boolean().optional().describe("Whether to open in teaching mode."),
        }),
        execute: async ({ sessionId, goal, teach }: { sessionId?: string; goal?: string; teach?: boolean }) => {
            return JSON.stringify({
                type: "computer_use_studio_pod",
                module: "ComputerUseStudioPod",
                component: "ComputerUseStudioPod",
                title: "Computer Use Studio",
                sessionId,
                goal,
                props: {
                    sessionId,
                    goal,
                    initialTeaching: teach === true,
                },
            });
        },
    },
};
