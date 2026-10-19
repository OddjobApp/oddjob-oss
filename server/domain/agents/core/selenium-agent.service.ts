import { chromium } from "playwright-extra";
import type { Page, Browser } from "playwright";
import stealth from 'puppeteer-extra-plugin-stealth';
import { injectAxe, checkA11y } from "axe-playwright";

// Apply the stealth plugin
chromium.use(stealth());
import { SeleniumStep, credentials, approvalRequests, agentSessions, agentRunSteps } from "@shared/schema/index.js";
import { proxyPoolService } from '@domain/core/infrastructure/proxy-pool.service.js';
import { agentSessionService } from './agent-session.service.js';
import { adversarialAIService } from '@domain/core/infrastructure/adversarial-ai.service.js';
import { humanLikeClick, humanLikeType } from '@domain/core/utils/human-like-actions.js';
import { db } from "@server/database_service.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { eq } from "drizzle-orm";
import type { OrgContext } from "@domain/jobs/job.service.js";
import { knowledgeService } from "@domain/knowledge/knowledge.service.js";
import type { AppDeployment } from "@shared/schema/apps.js";
import { threatAnalysisService } from './threat-analysis.service.js';
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";

const logger = createLogger("SeleniumAgent");

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/120.0.0.0"
];

export interface AIDecision {
    action: "click" | "type" | "navigate" | "scroll" | "wait" | "done" | "fail" | "finish" | "pause_for_captcha" | "updateDataset" | "extract_knowledge";
    selector?: string;
    coordinates?: { x: number; y: number };
    text?: string;
    url?: string;
    reason: string;
    captureScreenshot?: boolean;
}

export class SeleniumAgentService {

    /**
     * Runs an autonomous session to achieve a goal starting from a URL.
     * Returns the recorded steps.
     */
    async runAutoPilot(
        startUrl: string, 
        goal: string, 
        context: OrgContext, 
        datasetId?: number, 
        deployment?: AppDeployment,
        emitLog?: (message: string, level?: 'info' | 'warn' | 'error' | 'success') => Promise<void>,
        options: {
            isPriority?: boolean;
            proxyPoolName?: string;
            adversarialMode?: boolean;
            sessionId?: string;
            hibernationHours?: number;
            dynamicEvasion?: boolean;
        } = { isPriority: true }
    ): Promise<SeleniumStep[]> {
        logger.info("Starting Titan Auto-Pilot", { startUrl, goal, datasetId, userId: context.userId });

        // 1. Setup AI Client
        const aiConfig = await systemAiService.getAiConfig('copilot', context.organizationId ?? undefined) || { provider: 'google', model: 'gemini-2.0-flash', apiKey: "" };
        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: (aiConfig as any).baseUrl } as any);
        const apiKey = aiConfig.apiKey || "";

        // 2. Launch Browser
        const browserConfig = (deployment?.browserConfig as any) || {};
        const headless = browserConfig.headless !== false;
        const stealthMode = browserConfig.stealthMode !== false;

        let viewport = browserConfig.viewport || { width: 1280, height: 720 };
        let userAgent = stealthMode ? USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] : undefined;
        const launchOptions: any = {
            headless,
            args: ['--disable-webrtc']
        };

        if (options.proxyPoolName) {
            const identity = proxyPoolService.getProxyIdentity(options.proxyPoolName);
            if (identity) {
                logger.info(`Using proxy from pool "${options.proxyPoolName}"`);
                launchOptions.proxy = { server: identity.connectionString };

                if (identity.fingerprint) {
                    logger.info("Applying synchronized browser fingerprint.");
                    userAgent = identity.fingerprint.userAgent;
                    viewport = identity.fingerprint.viewport;
                    // Additional fingerprint properties would be applied in the cloakPage method
                }
            } else {
                logger.warn(`Proxy pool "${options.proxyPoolName}" was requested but no identity could be retrieved. Proceeding without proxy.`);
            }
        }

        const browser = await chromium.launch(launchOptions);
        const browserContext = await browser.newContext({
            viewport,
            userAgent
        });
        const page = await browserContext.newPage();

        // 2.1 Apply Stealth Evasions (Cloaking)
        if (stealthMode) {
            await this.cloakPage(page);
            logger.info("[Titan] Stealth Evasions Applied (Cloaking Level: Titanium)");
        }

        // 2.5 Consult Navigational Memory (RAG Step)
        let navigationGuide = "";
        try {
            const domain = new URL(startUrl).hostname;
            const guide = await knowledgeService.findNavigationalGuide(domain, goal, context);
            if (guide) {
                navigationGuide = `
                COLLECTIVE MEMORY (PAST SUCCESSFUL STRATEGY):
                The organization has successfully completed this goal on this domain before.
                SUCCESSFUL PATH: ${guide.textContent}
                NOTE: Use this as a reference but verify selectors against current page state.
                `;
                logger.info("[Titan] Found navigational guide in memory", { domain });
            }
        } catch (ragErr) {
            logger.warn("[Titan] Failed to consult navigational memory", { error: ragErr });
        }

        const recordedSteps: SeleniumStep[] = [];
        const maxSteps = 15; // Safety limit

        if (options.sessionId) {
            await agentSessionService.wakeSession(options.sessionId);
            const session = await db.select().from(agentSessions).where(eq(agentSessions.sessionId, options.sessionId)).limit(1);
            if (session[0]?.progress) {
                recordedSteps.push(...session[0].progress);
                logger.info(`Resuming session ${options.sessionId} with ${recordedSteps.length} existing steps.`);
            }
        }

        try {
            // Initial Navigation
            await page.goto(startUrl);
            recordedSteps.push({ action: 'goto', value: startUrl, optional: false });

            // Fetch Dataset Context if available
            let datasetContext = "";
            if (datasetId) {
                try {
                    const dataset = await datasetService.getById(datasetId, context);
                    if (dataset) {
                        // Get schema or first item keys
                        // Assuming schemaMapping or raw data to infer keys
                        const columns = dataset.schemaMapping ? Object.keys(dataset.schemaMapping) : [];
                        // Fallback to fetching one item to guess columns if schema is empty
                        if (columns.length === 0) {
                            const items = await datasetService.getItems(datasetId, context, { limit: 1 });
                            if (items.items.length > 0) {
                                columns.push(...Object.keys(items.items[0].data as any));
                            }
                        }

                        if (columns.length > 0) {
                            datasetContext = `
                            AVAILABLE DATASET CONTEXT:
                            - Input Variables: You can use these variables in 'type' or 'goto' steps: ${columns.map(c => `{{${c}}}`).join(', ')}
                            - Output Columns: You can update these columns using the 'updateDataset' action: ${columns.join(', ')}
                            `;
                        }
                    }
                } catch (e: any) {
                    logger.warn("Failed to fetch dataset context", e);
                }
            }

            // 3. Agent Loop
            for (let i = 0; i < maxSteps; i++) {
                logger.info(`[Agent] Step ${i + 1}/${maxSteps}`);

                // A. Capture State
                // Screenshot is critical for visual context
                const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
                const screenshotBase64 = screenshotBuffer.toString('base64');
                const screenshotDataUrl = `data:image/jpeg;base64,${screenshotBase64}`;

                // Simplified DOM (Text representation)
                // We extract interactive elements to reduce token usage vs full HTML
                const pageState = await this.getInteractiveState(page);

                // B. Prompt AI
                const prompt = `
                You are an autonomous browser agent.
                GOAL: "${goal}"
                
                Current Page URL: ${page.url()}
                Step History: ${JSON.stringify(recordedSteps.map(s => s.action + (s.selector ? ': ' + s.selector : '')))}

                ${datasetContext}

                ${navigationGuide}

                Visible Interactive Elements:
                ${JSON.stringify(pageState.elements.slice(0, 100), null, 2)} 
                (List truncated to 100)
                INSTRUCTIONS:
                1. Analyze the screenshot and element list.
                2. Determine the next single action to move towards the goal.
                3. If the goal is achieved (e.g. you found the info, or arrived at the destination), return action "finish".
                4. Selectors MUST be precise. Prefer IDs or specific Attributes.
                5. VERIFICATION: If you are verifying a script or state, ensure you look for the specific expected elements/text before finishing.
                6. SCREENSHOTS: You can request a high-res capture by adding "captureScreenshot": true to your response.
                7. IMPEDIMENTS: If you encounter a CAPTCHA or a "Verify you are human" block, return action "pause_for_captcha".

                RESPONSE FORMAT (JSON ONLY):
                {
                    "action": "click" | "type" | "goto" | "wait" | "updateDataset" | "extract_knowledge" | "pause_for_captcha" | "finish",
                    "selector": "css_selector" (required for click/type if coordinates not used),
                    "coordinates": { "x": number, "y": number } (optional, use for precise visual grounding based on the screenshot),
                    "value": "text_to_type" (required for type, optional for others),
                    "captureScreenshot": boolean (optional, if true will save a high-res snapshot),
                    "updates": { "page_theme": "snapshot_or_summary" } (required for extract_knowledge or updateDataset),
                    "reasoning": "Why I chose this action (include visual rationale)"
                }
                `;

                const finalPrompt = options.adversarialMode 
                    ? adversarialAIService.getAttackPrompt(prompt)
                    : prompt;

                const aiResult = await aiClient.execute({
                    model: aiConfig.model, // Use configured model
                    userPrompt: finalPrompt,
                    temperature: 0,
                    requestType: "json",
                    useCache: false,
                    enableQueryExpansion: false,
                    saveOutputToFile: false,
                    attachments: [{ type: 'image_url', url: screenshotDataUrl }],
                    isPriority: options.isPriority
                } as any, undefined, aiConfig.apiKey || "");

                if (!aiResult.success || !aiResult.output) {
                    logger.error("AI failed to respond", (aiResult.error as any));
                    break;
                }

                // C. Parse & Execute
                let decision: any;
                try {
                    decision = JSON.parse(aiResult.output);
                } catch (e) {
                    logger.error("Failed to parse AI JSON", { output: aiResult.output });
                    continue;
                }

                    // Record high-res gallery items if requested
                    if (decision.captureScreenshot) {
                        const highRes = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 });
                        recordedSteps.push({ 
                            action: 'screenshot', 
                            value: `data:image/jpeg;base64,${highRes.toString('base64')}`,
                            extractAs: `gallery_${Date.now()}` 
                        } as any);
                    }

                    if (decision.action === 'finish') {
                    logger.info("Agent decided goal is reached. Curation sequence starting...");
                    
                    // Final State Accessibility Audit
                    try {
                        await emitLog?.("Initiating accessibility audit (axe-core)...", 'info');
                        const auditResult = await this.runAccessibilityAudit(page);
                        recordedSteps.push({
                            action: 'accessibility_report',
                            value: JSON.stringify(auditResult),
                            optional: true
                        } as any);
                    } catch (axeErr: any) {
                        logger.warn("[Titan] Accessibility audit failed", { error: axeErr });
                    }

                    // Trigger Navigational Memory Recording
                    if (deployment?.navigationalMemoryShared !== false) {
                        try {
                            const domain = new URL(page.url()).hostname;
                            await knowledgeService.curateNavigationalGuide(domain, goal, recordedSteps, context);
                            logger.info("[Titan] Successfully recorded winning path to collective memory.");
                        } catch (curationErr) {
                            logger.warn("[Titan] Failed to curate navigational guide", { error: curationErr });
                        }
                    }
                    break;
                }

                if (decision.action === 'pause_for_captcha') {
                    logger.info("[Titan] Captcha detected. Initiating HIL Relay...");
                    const missionRunId = (context as any).missionRunId; 
                    
                    if (!missionRunId) {
                        logger.error("[Titan] No missionRunId in context, cannot initiate HIL.");
                        continue;
                    }

                    try {
                        const { approvalService } = await import("@domain/integrations/core/approval.service.js");
                        const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");

                        // 1. Snapshot Captcha
                        const captchaShot = await page.screenshot({ type: 'jpeg', quality: 90 });
                        
                        // 2. Create HIL Request
                        const approval = await approvalService.createApprovalRequest({
                            executionId: missionRunId.toString(),
                            jobId: 0, // System-level
                            approverType: 'internal',
                            approverEmail: 'ops@oddjob.ai',
                            status: 'pending',
                            context: {
                                type: 'captcha_solution',
                                goal: goal,
                                screenshot: `data:image/jpeg;base64,${captchaShot.toString('base64')}`
                            }
                        });

                        // 3. Pause Mission
                        await missionRunService.pauseForHumanApproval(missionRunId, [approval.id]);

                        // 4. Wait Loop (Polling for Solution)
                        logger.info(`[Titan] Agent paused. Waiting for human to solve captcha (Approval ID: ${approval.id})...`);
                        let solvedData = null;
                        const pollLimit = 60; // 5 minutes (5s each)
                        for (let p = 0; p < pollLimit; p++) {
                            await new Promise(r => setTimeout(r, 5000));
                             const [updatedReq] = await (db.select().from(approvalRequests).where(eq(approvalRequests.id, approval.id)).limit(1) as any);
                             
                             if (updatedReq?.status === 'approved') {
                                 solvedData = (updatedReq as any).modifiedOutput;
                                 break;
                             }
                             if (updatedReq?.status === 'rejected') {
                                 throw new Error("Captcha relay rejected by human.");
                             }
                        }

                        if (!solvedData) throw new Error("Captcha relay timed out after 5 minutes.");

                        logger.info("[Titan] Captcha solution received! Resuming navigation...");
                        
                        // 5a. A click target the human marked on the screenshot. The
                        // approval UI reports it in screenshot pixels; the mouse
                        // works in CSS pixels, which differ by devicePixelRatio.
                        const target = solvedData.coordinates;
                        if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
                            const dpr = await page.evaluate(() => window.devicePixelRatio || 1).catch(() => 1);
                            await page.mouse.click(target.x / dpr, target.y / dpr);
                            recordedSteps.push({ action: 'click', value: `coords:${target.x},${target.y}`, optional: false });
                            await page.waitForTimeout(1000);
                        }

                        // 5b. Apply Solution if it has a 'solution' field
                        if (solvedData.solution && decision.selector) {
                            await page.fill(decision.selector, solvedData.solution);
                            await page.keyboard.press('Enter');
                            recordedSteps.push({ action: 'type', selector: decision.selector, value: 'HIDDEN_CAPTCHA_SOL', optional: false });
                        }
                        
                        // Clear pause status
                        await missionRunService.clearResumeAndSetActive(missionRunId);
                        continue;

                    } catch (hilErr) {
                        logger.error("[Titan] Captcha HIL failed", hilErr);
                        break;
                    }
                }

                if (decision.action === 'click') {
                    let coords = decision.coordinates;
                    
                    if (!coords && decision.selector) {
                        // Attempt visual grounding as a first resort or fallback
                        coords = await this.findCoordinatesVisually(
                            `Element matching selector "${decision.selector}" (${decision.reasoning})`,
                            screenshotDataUrl,
                            aiClient,
                            aiConfig
                        );
                    }

                    if (coords) {
                        logger.info(`[Titan] Visual Grounding: Clicking at coordinates {x: ${coords.x}, y: ${coords.y}}`);
                        await page.mouse.click(coords.x, coords.y);
                        recordedSteps.push({ action: 'click', value: `coords:${coords.x},${coords.y}`, optional: false });
                    } else if (decision.selector) {
                        logger.info(`[Titan] Falling back to selector-based click: ${decision.selector}`);
                        await humanLikeClick(page, decision.selector);
                        recordedSteps.push({ action: 'click', selector: decision.selector, optional: false });
                    }
                    // Wait for navigation or load
                    await page.waitForTimeout(2000);
                } else if (decision.action === 'type' && decision.selector && decision.value) {
                    await humanLikeType(page, decision.selector, decision.value);
                    recordedSteps.push({ action: 'type', selector: decision.selector, value: decision.value, optional: false });
                } else if (decision.action === 'goto' && decision.value) {
                    await page.goto(decision.value);
                    recordedSteps.push({ action: 'goto', value: decision.value, optional: false });
                } else if (decision.action === 'wait') {
                    await page.waitForTimeout(2000);
                    recordedSteps.push({ action: 'wait', waitMs: 2000, optional: false });
                } else if (decision.action === 'extract_knowledge' && decision.updates) {
                    // Provide a snapshot of the DOM if requested, or just record the agent's summary
                    const cleanHtml = await page.evaluate(() => {
                        // Strip out scripts and styles to save tokens
                        const clone = document.cloneNode(true) as Document;
                        clone.querySelectorAll('script, style, svg').forEach(e => e.remove());
                        return clone.body.innerText.substring(0, 5000);
                    });

                    const extractedData = { ...decision.updates, _snapshot: cleanHtml, _url: page.url() };
                    recordedSteps.push({
                        action: 'extract_knowledge',
                        updates: extractedData,
                        optional: false
                    });
                    logger.info(`[Agent] Extracted knowledge`, Object.keys(decision.updates));
                } else if (decision.action === 'updateDataset' && decision.updates) {
                    // This is a logical step, no browser action
                    recordedSteps.push({
                        action: 'updateDataset',
                        updates: decision.updates,
                        optional: false
                    });
                }

                if (options.dynamicEvasion) {
                    const analysis = await threatAnalysisService.analyze({
                        captchaPresent: decision.action === 'pause_for_captcha',
                        // Add more metrics here
                    }, context.organizationId ?? undefined);

                    logger.info(`Threat Analysis - Score: ${analysis.threatScore}, Reason: ${analysis.reasoning}`);

                    if (analysis.threatScore >= 8) {
                        logger.warn("High threat detected. Forcing hibernation.");
                        options.hibernationHours = (options.hibernationHours || 1) * 2; // Double hibernation time
                        break; // End the current run
                    } else if (analysis.threatScore >= 5) {
                        logger.info("Medium threat detected. Increasing delays.");
                        await page.waitForTimeout(5000); // 5s cool-down
                    }
                }
            }
        } catch (error) {
            logger.error(`Selenium AutoPilot critical failure: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        } finally {
            await browser.close();

            if (options.sessionId) {
                await agentSessionService.updateProgress(options.sessionId, recordedSteps);
                if (options.hibernationHours) {
                    await agentSessionService.hibernateSession(options.sessionId, options.hibernationHours);
                }
            }
        }

        return recordedSteps;
    }

    /**
     * Extracts a simplified list of interactive elements from the page.
     */
    private async getInteractiveState(page: Page) {
        // We pass the function as a string to page.evaluate to verify it runs in the browser context 
        // without being affected by local build/transpilation artifacts (like __name injection).
        return await page.evaluate(`(() => {
            const elements = [];
            // Helper to get simple CSS selector
            const getSelector = (el) => {
                if (el.id) return '#' + el.id;
                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.split(' ').filter(c => c.trim()).join('.');
                    if (classes) return el.tagName.toLowerCase() + '.' + classes;
                }
                return el.tagName.toLowerCase();
            };

            const interestingTags = ['button', 'a', 'input', 'select', 'textarea'];
            document.querySelectorAll('*').forEach((el) => {
                const tag = el.tagName.toLowerCase();
                if (!interestingTags.includes(tag) && el.getAttribute('role') !== 'button') return;

                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return; // Invisible

                let text = el.textContent?.substring(0, 50).trim() || '';
                if (tag === 'input') {
                    text = el.placeholder || el.value || '';
                }

                elements.push({
                    tag,
                    text,
                    selector: getSelector(el),
                    // Add attributes that might allow for better selection
                    id: el.id,
                    href: el.getAttribute('href'),
                    type: el.getAttribute('type'),
                    ariaLabel: el.getAttribute('aria-label'),
                    bounds: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    }
                });
            });
            return { elements };
        })()`) as { elements: any[] };
    }

    /**
     * Injects Titanium Stealth (Cloaking) evasions into the page.
     */
    private async cloakPage(page: Page) {
        await page.addInitScript(() => {
            // Mask webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

            // Mask chrome
            (window as any).chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };

            // Mask permissions
            const originalQuery = window.navigator.permissions.query;
            (window.navigator.permissions as any).query = (parameters: any) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission } as any) :
                    originalQuery(parameters)
            );

            // Mask hardware/plugins
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

            // --- Canvas Fingerprint Forgery ---
            const originalGetContext = HTMLCanvasElement.prototype.getContext;
            (HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: any[]) {
                if (type === '2d') {
                    const context = originalGetContext.call(this, type, ...args) as CanvasRenderingContext2D | null;
                    if (context) {
                        const originalToDataURL = context.canvas.toDataURL;
                        context.canvas.toDataURL = function(...args: any[]) {
                            // Return a consistent, pre-computed fake hash
                            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mP8/wcAAwAB/epv2AAAAABJRU5ErkJggg==';
                        };
                    }
                    return context;
                }
                return originalGetContext.call(this, type, ...args);
            };
        });
    }

    /**
     * Skill: Accessibility Audit
     * Runs axe-playwright against the current page state and returns violation count + summary.
     */
    async runAccessibilityAudit(page: Page) {
        logger.info("[Titan] Running Accessibility Audit...");
        try {
            await injectAxe(page);
            // We use a light scan for performance
            const results = await page.evaluate(() => {
                // Return a simplified summary to avoid bloating the step history
                return (window as any).axe.run({
                    runOnly: {
                        type: 'tag',
                        values: ['wcag2a', 'wcag2aa', 'best-practice']
                    }
                });
            });

            const summary = {
                violationCount: (results as any).violations?.length || 0,
                incompleteCount: (results as any).incomplete?.length || 0,
                passesCount: (results as any).passes?.length || 0,
                score: this.calculateAccessibilityScore(results),
                topViolations: (results as any).violations?.slice(0, 5).map((v: any) => ({
                    id: v.id,
                    impact: v.impact,
                    description: v.description,
                    help: v.help,
                    helpUrl: v.helpUrl
                }))
            };

            logger.info(`[Titan] Audit complete: ${summary.violationCount} violations found. Score: ${summary.score}%`);
            return summary;
        } catch (err: any) {
            throw new Error(`Accessibility audit failed: ${err.message}`);
        }
    }

    private calculateAccessibilityScore(results: any): number {
        const violations = results.violations || [];
        if (violations.length === 0) return 100;

        // Custom scoring: deduct points based on impact
        let deductions = 0;
        for (const v of violations) {
            const weight = v.impact === 'critical' ? 20 : v.impact === 'serious' ? 10 : v.impact === 'moderate' ? 5 : 2;
            deductions += weight;
        }

        return Math.max(0, 100 - deductions);
    }

    /**
     * Finds coordinates of an element visually using Gemini.
     */
    private async findCoordinatesVisually(description: string, screenshotDataUrl: string, aiClient: any, aiConfig: any): Promise<{ x: number; y: number } | null> {
        logger.info(`[Titan] Visually grounding element: "${description}"`);
        const prompt = `
        Analyze the screenshot and find the coordinates of the element described as: "${description}".
        Return the exact center coordinates of the element as {x, y} in pixels.
        
        Output ONLY valid JSON:
        { "x": number, "y": number }
        
        If you cannot find the element or are unsure, return null.
        `;

        try {
            const result = await aiClient.execute({
                model: aiConfig.model,
                userPrompt: prompt,
                temperature: 0,
                requestType: "json",
                useCache: false,
                enableQueryExpansion: false,
                saveOutputToFile: false,
                attachments: [{ type: 'image_url', url: screenshotDataUrl }]
            } as any, undefined, aiConfig.apiKey || "");

            if (!result.success || !result.output) {
                logger.warn("[Titan] Visual grounding failed to respond");
                return null;
            }

            const data = JSON.parse(result.output.replace(/```json/g, '').replace(/```/g, '').trim());
            if (data && typeof data.x === 'number' && typeof data.y === 'number') {
                return data;
            }
            return null;
        } catch (err) {
            logger.warn("[Titan] Visual grounding failed to parse", { error: err });
            return null;
        }
    }

    async recordRunSteps(sessionId: string, steps: any[], options?: { final?: boolean }) {
        const stepRecords = steps.map((step, index) => ({
            runId: sessionId,
            stepIndex: index,
            type: "action",
            content: step.action || "selenium_step",
            action: step.action,
            selector: step.selector || null,
            value: step.value || null,
            optional: step.optional || false,
            metadata: options?.final ? { ...step, final: true } : step,
        }));

        if (stepRecords.length > 0) {
            await db.insert(agentRunSteps).values(stepRecords);
        }
    }

    async recordErrorStep(sessionId: string, errorMessage: string) {
        await db.insert(agentRunSteps).values({
            runId: sessionId,
            stepIndex: -1,
            type: "error",
            content: errorMessage,
            action: "error",
            metadata: { error: errorMessage },
        });
    }

    async getRunSteps(sessionId: string) {
        return await db
            .select()
            .from(agentRunSteps)
            .where(eq(agentRunSteps.runId, sessionId))
            .orderBy(agentRunSteps.stepIndex);
    }
}

export const seleniumAgentService = new SeleniumAgentService();


