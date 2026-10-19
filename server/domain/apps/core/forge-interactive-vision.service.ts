
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";
import type { Browser } from "playwright";

const logger = createLogger("ForgeInteractiveVision");

export const INTERACTIVE_UI_AUDIT_PROMPT = `
You are an Interactive UI Audit Agent (Omni-model). 
Your goal is to perform a cognitive walkthrough of the provided UI screenshot.

1. PERCEPTION: Identify all interactive elements (buttons, inputs, links, cards).
2. INTENT ANALYSIS: For each element, what is its perceived function?
3. COGNITIVE WALKTHROUGH:
   - What is the most obvious "Happy Path"?
   - Are there any "Dead Ends" (buttons that look clickable but lead nowhere)?
   - Is the visual hierarchy clear? (e.g. is the Primary Call-to-Action prominent?)
4. FRICTION POINTS: Identify anything that would frustrate a user.

Output must be JSON: { 
  "happyPath": ["..."], 
  "interactiveElementsCount": 0, 
  "frictionPoints": ["..."], 
  "uxScore": 0-100, 
  "isMobileResponsive": boolean,
  "actionSuggestions": ["..."]
}
`;

export class ForgeInteractiveVisionService {
    /**
     * Performs a deep interactive audit of the live UI using Vision-Action reasoning.
     */
    async performInteractiveAudit(
        url: string, 
        organizationId?: number,
        traceContext?: TraceContext
    ): Promise<any> {
        let browser: Browser | null = null;
        try {
            const playwright = await import("playwright");
            browser = await playwright.chromium.launch({ headless: true });
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            
            logger.info(`Starting Interactive UI Audit for ${url}`);
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            
            // Wait for data to load
            await new Promise(r => setTimeout(r, 3000));
            
            const screenshotBuffer = await page.screenshot({ fullPage: true });
            const base64Screenshot = screenshotBuffer.toString('base64');
            
            const aiConfig = await systemAiService.getAiConfig('codegen', organizationId);
            if (!aiConfig) return { uxScore: 100, frictionPoints: [] };

            // Using Gemini 1.5 Pro for deep interactive reasoning (Omni-model proxy)
            const visionConfig = { ...aiConfig, model: "gemini-1.5-pro" };
            const client = AIClientFactory.getClient(visionConfig as any);
            
            const response = await client.execute({
                model: visionConfig.model,
                systemPrompt: INTERACTIVE_UI_AUDIT_PROMPT,
                userPrompt: `Perform an interactive audit of this live application: ${url}`,
                requestType: 'json',
                responseType: 'json',
                maxTokens: 2048
            } as any, undefined, aiConfig.apiKey || "", [{
                fileUri: `data:image/png;base64,${base64Screenshot}`,
                mimeType: 'image/png',
                fileName: 'interactive-audit.png'
            }], traceContext as any);

            if (response.success && response.output) {
                const parsed = typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
                logger.info(`[InteractiveVision] Audit completed. UX Score: ${parsed.uxScore}`);
                return parsed;
            }
            throw new Error(`Interactive Audit AI call failed: ${response.error}`);
        } catch (err: any) {
            logger.error(`Interactive Audit failed: ${err.message}`);
            return { error: err.message, uxScore: 50, frictionPoints: ["Could not perform visual audit."] };
        } finally {
            if (browser) await browser.close();
        }
    }
}

export const forgeInteractiveVisionService = new ForgeInteractiveVisionService();
