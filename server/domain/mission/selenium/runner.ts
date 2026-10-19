import type { SeleniumConfig, SeleniumStep } from "@shared/schema/index.js";
import type { VariableContext } from "../../../core/variable-resolver.js";
import { ConfigurationError, JobExecutionError, RateLimitError } from "@server/utils/errors.js";
import { aiHealingService } from "@domain/ai/core/ai-healing.service.js";
import { datasetService } from "../../knowledge/core/dataset-service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { LocalBrowserStrategy } from "./strategies/local.js";
import { GridBrowserStrategy } from "./strategies/grid.js";
import { BrowserStrategy, PageLike } from "./strategies/base.js";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("SeleniumRunner");

export interface SeleniumExecutionResult {
    success: boolean;
    extracted: Record<string, any>;
    screenshots?: Record<string, string>;
    cookies?: any[];
    har?: any;
    video?: string;
    timing: {
        totalMs: number;
        pageLoads: number;
        steps: { action: string; durationMs: number; success: boolean }[];
    };
    error?: string;
}

const MAX_CONCURRENT_SESSIONS = 3;
let activeSessions = 0;

export class SeleniumRunner {

    async execute(
        config: SeleniumConfig,
        context: VariableContext
    ): Promise<SeleniumExecutionResult> {
        if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
            throw new RateLimitError(
                `Max concurrent Selenium sessions reached (${MAX_CONCURRENT_SESSIONS}). Please try again later.`
            );
        }

        activeSessions++;
        const startTime = Date.now();
        const extracted: Record<string, any> = {};
        const screenshots: Record<string, string> = {};
        const stepTimings: { action: string; durationMs: number; success: boolean, error?: string }[] = [];
        let pageLoads = 0;

        let strategy: BrowserStrategy;
        let page: PageLike | null = null;
        let cleanup: (() => Promise<void>) | null = null;

        try {
            // Specialized API Scrapers (Bypass Strategy Logic)
            if (config.mode === "firecrawl" || config.mode === "scrapegraph") {
                const { scraperApiService } = await import("./scraper-api.service.js");
                let result;
                if (config.mode === "firecrawl") {
                    result = await scraperApiService.firecrawl(config.startUrl || config.steps?.[0]?.value || "", (config.proxy as any)?.password);
                } else {
                    result = await scraperApiService.scrapegraph(config.startUrl || config.steps?.[0]?.value || "", config.goal || "", (config.proxy as any)?.password);
                }

                activeSessions--; // Early release for API call
                return {
                    success: result.success,
                    extracted: { content: result.content, ...result.metadata },
                    timing: { totalMs: Date.now() - startTime, pageLoads: 1, steps: [] },
                    error: result.error
                };
            }

            // Select Strategy & Regional Routing
            if (config.mode === "grid" || config.region) {
                strategy = new GridBrowserStrategy();
                
                // If a region is specified, resolve its remote URL
                if (config.region) {
                    const registryStr = process.env.BROWSER_REGISTRY || "{}";
                    try {
                        const registry = JSON.parse(registryStr);
                        const regionalUrl = registry[config.region];
                        if (regionalUrl) {
                            logger.info(`Routing mission to region: ${config.region} (${regionalUrl})`);
                            (config as any).remoteUrl = regionalUrl;
                        } else {
                            logger.warn(`Region ${config.region} not found in registry. Using default Grid.`);
                        }
                    } catch (e) {
                        logger.error("Failed to parse BROWSER_REGISTRY:", e as any);
                    }
                }
            } else {
                strategy = new LocalBrowserStrategy();
            }

            const initResult = await strategy.init(config);
            page = initResult.page;
            cleanup = initResult.cleanup;

            // Import cookies
            if (config.importCookiesFromStep !== undefined && context.positional) {
                const stepOutput = context.positional[config.importCookiesFromStep];
                if (stepOutput) {
                    try {
                        const parsedOutput = typeof stepOutput === 'string' ? JSON.parse(stepOutput) : stepOutput;
                        if (parsedOutput?.cookies && Array.isArray(parsedOutput.cookies)) {
                            await page.context().addCookies(parsedOutput.cookies);
                        }
                    } catch (e) {
                        logger.warn("Failed to import cookies from previous step:", e as any);
                    }
                }
            }

            // Execute steps
            for (const step of config.steps || []) {
                const stepStart = Date.now();
                try {
                    await this.executeStep(page, step, extracted, screenshots, context, config);
                    if (step.action === "goto") pageLoads++;
                    
                    const durationMs = Date.now() - stepStart;
                    stepTimings.push({
                        action: step.action,
                        durationMs,
                        success: true
                    });

                    // SELF-HEALING: Detect Bot Challenges & CAPTCHAs
                    if (step.action === "goto") {
                        const bodyText = await page.textContent("body");
                        if (bodyText && (
                            bodyText.includes("Access Denied") || 
                            bodyText.includes("unusual traffic") || 
                            bodyText.includes("Verify you are human") ||
                            bodyText.includes("Cloudflare") ||
                            bodyText.includes("enable cookies") ||
                            bodyText.includes("Distil Networks") ||
                            bodyText.includes("Akamai")
                        )) {
                            logger.warn(`[SeleniumRunner] Bot challenge detected on ${step.value}. Attempting self-healing...`);
                            
                            // If we're not already using a premium unblocker, upgrade and retry the whole mission
                            if (!config.proxy?.provider || config.proxy.provider === 'none') {
                                logger.info("[SeleniumRunner] Upgrading to premium unblocking strategy (ScrapingBee/Residential)...");
                                const upgradedConfig: any = {
                                    ...config,
                                    proxy: { ...(config.proxy || {}), provider: "scrapingbee" },
                                    stealth: true
                                };
                                return this.execute(upgradedConfig, context);
                            }
                        }
                    }

                    // Emit progress event for real-time visualization
                    eventStream.publish('selenium.step_completed', {
                        action: step.action,
                        selector: step.selector,
                        success: true,
                        durationMs,
                        screenshot: config.liveStreamScreenshots ? await page.screenshot({ encoding: 'base64', quality: 50 }) : undefined
                    }, { 
                        subject: `selenium-run:${config.jobId || 'temp'}` 
                    }).catch(() => {});

                    // ORGANIC JITTER: Add a random delay between steps to bypass pattern analysis (Splunk/SIEM)
                    const jitterMs = 500 + Math.floor(Math.random() * 2000);
                    await new Promise(r => setTimeout(r, jitterMs));

                } catch (stepError) {
                    logger.error(`Step "${step.action}" failed:`, stepError as any);

                    const durationMs = Date.now() - stepStart;
                    if (config.screenshotOnError) {
                        try {
                            screenshots["error"] = await page.screenshot({ encoding: "base64" }) as string;
                        } catch (e) {
                            logger.warn("Failed to capture error screenshot:", e as any);
                        }
                    }

                    eventStream.publish('selenium.step_completed', {
                        action: step.action,
                        selector: step.selector,
                        success: false,
                        error: String(stepError),
                        durationMs,
                        screenshot: screenshots["error"]
                    }, { 
                        subject: `selenium-run:${config.jobId || 'temp'}` 
                    }).catch(() => {});

                    if (step.optional) {
                        stepTimings.push({
                            action: step.action,
                            durationMs,
                            success: false,
                            error: String(stepError)
                        });
                        continue;
                    }
                    throw stepError;
                }
            }

            // Final screenshot
            if (config.screenshotOnComplete) {
                try {
                    screenshots["final"] = await page.screenshot({ encoding: "base64" }) as string;
                } catch (e) {
                    logger.warn("Failed to capture final screenshot:", e as any);
                }
            }

            // Export cookies
            let cookies: any[] | undefined;
            if (config.exportCookies) {
                try {
                    cookies = await page.context().cookies();
                } catch (e) {
                    logger.warn("Failed to export cookies:", e as any);
                }
            }

            if (cleanup) await cleanup();

            return {
                success: true,
                extracted: {
                    ...extracted,
                    html: config.extractHtml ? await page.evaluate(() => document.documentElement.outerHTML) : undefined,
                    text: config.extractText ? await page.textContent('body') : undefined,
                },
                screenshots,
                cookies,
                timing: {
                    totalMs: Date.now() - startTime,
                    pageLoads,
                    steps: stepTimings
                }
            };

        } catch (error) {
            if (cleanup) {
                try { await cleanup(); } catch (e) { logger.warn("Cleanup failed:", e as any); }
            }
            return {
                success: false,
                extracted,
                screenshots,
                timing: {
                    totalMs: Date.now() - startTime,
                    pageLoads,
                    steps: stepTimings
                },
                error: error instanceof Error ? error.message : String(error)
            };
        } finally {
            activeSessions--;
        }
    }

    private async executeStep(
        page: PageLike,
        step: SeleniumStep,
        extracted: Record<string, any>,
        screenshots: Record<string, string>,
        context: VariableContext,
        config: SeleniumConfig
    ): Promise<void> {
        const { healingEnabled = false, datasetId } = config;
        const resolvedValue = step.value ? this.resolveVariables(step.value, context) : undefined;

        // Compatibility normalization: Legacy tool definitions (like browse_web) pass targeting
        // locators via 'value' instead of 'selector'. We auto-remap these for all element actions.
        const locatorActions = ["click", "dblclick", "extract", "extractAll", "hover", "scroll", "scrollTo", "waitForSelector", "check", "uncheck", "select"];
        if (locatorActions.includes(step.action) && !step.selector && step.value) {
            step.selector = resolvedValue || step.value;
        }

        switch (step.action) {
            case "updateDataset":
                if (!datasetId) {
                    logger.warn("updateDataset called but no datasetId configured");
                    break;
                }
                const currentItem = (context as any).item;
                if (!currentItem || !currentItem.id) {
                    logger.warn("updateDataset called but no current item context found");
                    break;
                }
                const updates = step.updates || {};
                const ResolvedUpdates: Record<string, any> = {};
                for (const [key, val] of Object.entries(updates)) {
                    ResolvedUpdates[key] = typeof val === 'string' ? this.resolveVariables(val, context) : val;
                }
                try {
                    const mergedData = { ...(currentItem.data || {}), ...ResolvedUpdates };
                    await datasetService.updateItem(datasetId, currentItem.id, {
                        data: mergedData
                    }, { organizationId: null, userId: 1 } as any);
                    logger.info(`Updated dataset item ${currentItem.id}`, ResolvedUpdates);
                } catch (e) {
                    throw new JobExecutionError(0, "Failed to update dataset: " + String(e));
                }
                break;

            case "navigate":
            case "open":
            case "goto":
                const referrers = [
                    "https://www.google.com/",
                    "https://www.bing.com/",
                    "https://twitter.com/",
                    "https://www.linkedin.com/",
                    "https://duckduckgo.com/"
                ];
                const randomReferrer = referrers[Math.floor(Math.random() * referrers.length)];
                await page.goto(resolvedValue!, { 
                    waitUntil: "domcontentloaded", 
                    timeout: step.timeout,
                    referer: randomReferrer
                });
                break;

            case "click":
                await this.executeWithHealing(page, step, async () => {
                    await page.click(step.selector!, { timeout: step.timeout });
                }, healingEnabled);
                break;

            case "type":
                await this.executeWithHealing(page, step, async () => {
                    await page.fill(step.selector!, resolvedValue!, { timeout: step.timeout });
                }, healingEnabled);
                break;

            case "wait":
                await new Promise(r => setTimeout(r, step.waitMs || 1000));
                break;

            case "screenshot":
                const screenshot = await page.screenshot({ encoding: "base64", fullPage: step.value === "fullPage" }) as string;
                screenshots[step.extractAs || "screenshot"] = screenshot;
                if (step.extractAs) extracted[step.extractAs] = screenshot;
                break;

            case "extract":
                if (!step.selector) throw new Error("Extract step requires a valid selector");

                if (step.format === "json") {
                    // Simplified extraction logic for brevity - assume similar to original
                    const text = await page.textContent(step.selector);
                    try { extracted[step.extractAs!] = text ? JSON.parse(text) : null; } catch { extracted[step.extractAs!] = text; }
                } else {
                    extracted[step.extractAs!] = await page.textContent(step.selector);
                }
                break;

            case "extractAI":
                await this.executeSmartScrape(page, step, config, extracted);
                break;

            default:
                // Implement other steps as needed (hover, scroll, etc.) or throw error
                logger.warn(`Step action ${step.action} not fully implemented in refactor yet.`);
                break;
        }
    }

    private resolveVariables(value: string, context: VariableContext): string {
        return value.replace(/\{\{(.+?)\}\}/g, (_, key) => {
            const parts = key.split('.');
            let current: any = context;
            for (const part of parts) {
                if (current === undefined || current === null) return "";
                current = current[part];
            }
            return current === undefined || current === null ? "" : String(current);
        });
    }

    private async executeWithHealing(page: PageLike, step: SeleniumStep, action: () => Promise<void>, healingEnabled: boolean) {
        try {
            await action();
        } catch (error) {
            if (healingEnabled && step.selector) {
                logger.info(`Action failed, attempting healing for selector: ${step.selector}`);
                let domain = "default";
                try {
                    domain = await page.evaluate(() => window.location.hostname) as string || "default";
                } catch { /* page may be closed or navigation in flight */ }
                const content = await page.evaluate(() => document.body.innerHTML);
                const newSelector = await aiHealingService.healSelector(step.selector, content, (error as Error).message);
                if (newSelector) {
                    logger.info(`Healing successful, new selector: ${newSelector}`);
                    step.selector = newSelector;
                    await action(); // Retry with new selector
                    return;
                }
            }
            throw error;
        }
    }

    /**
     * The `extractAI` step: read the page, ask a model for the requested data,
     * and put it in `extracted` under the step's key.
     *
     * This was a stub — its body was a note reading "Copy AI extraction logic
     * from original executeSmartScrape" and a log line — so an extractAI step
     * logged and extracted nothing, silently. The original it refers to is not
     * in this repository's history, so this is written against the AI client
     * the rest of the codebase uses: execute(config, input, apiKey) with
     * responseType "json", not a generateStructured method (which exists only
     * on the constitutional-AI client).
     */
    private async executeSmartScrape(page: PageLike, step: SeleniumStep, config: SeleniumConfig, extracted: Record<string, any>) {
        const key = step.extractAs || "extracted";
        const instruction = step.aiPrompt?.trim();

        if (!instruction) {
            logger.warn(`[SmartScrape] Step has no aiPrompt; nothing to extract into "${key}".`);
            return;
        }

        const aiConfig = await systemAiService.getAiConfig("copilot");
        if (!aiConfig) {
            logger.warn(`[SmartScrape] No AI configuration available; leaving "${key}" unset.`);
            return;
        }

        // The rendered text, not the raw HTML: markup costs tokens without
        // helping, and a long page is truncated rather than refused.
        const pageText = String(await page.evaluate("document.body ? document.body.innerText : ''") ?? "");
        const excerpt = pageText.slice(0, 20000);

        const client = AIClientFactory.getClient(aiConfig as any);
        const result = await client.execute(
            {
                model: aiConfig.model,
                systemPrompt:
                    "You extract structured data from a web page. Answer with JSON only — no prose, no code fences.",
                userPrompt: `${instruction}\n\n--- PAGE TEXT ---\n${excerpt}`,
                requestType: "json",
                responseType: "json",
                maxTokens: 2048,
            } as any,
            undefined,
            aiConfig.apiKey ?? "",
        );

        if (!result.success || !result.output) {
            logger.warn(`[SmartScrape] Extraction failed for "${key}": ${result.error ?? "no output"}`);
            return;
        }

        try {
            extracted[key] = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
        } catch {
            // A model that ignored the JSON instruction still produced
            // something; keep the text rather than losing the step's work.
            extracted[key] = result.output;
        }

        logger.info(`[SmartScrape] Extracted "${key}" from ${excerpt.length} characters of page text.`);
    }
}


