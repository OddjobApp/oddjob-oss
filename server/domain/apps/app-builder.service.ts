/**
 * App Builder Service
 *
 * Handles interactive "chat-to-code" enhancements for deployed apps.
 * Snapshots the current workspace, asks the AI to apply instructions,
 * updates local files, and restarts the container runtime.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { dockerBridgeService } from "@domain/core/infrastructure/docker/docker-bridge.service.js";
import { appRegistryService } from "./app-registry.service.js";
import { uiRegistryService } from "./core/ui-registry.service.js";
import { mcpClientService } from "@domain/integrations/core/mcp-client.service.js";
import { apps } from "@shared/schema/index.js";
import { ToolContext } from "../tools/v1/capabilities/types.js";
import { tryFixJson, getErrorContext } from "../../../shared/utils/jsonUtils.js";
import { resolveForgeWorkspacePath, isWithinDirectory, isSharedServerApp } from "./core/forge-paths.js";
import { normalizeEdits } from "./app-builder-edits.js";
import { forgeValidatorService } from "./core/forge-validator.service.js";
import { detectLaunchProfile, prepareNodeWorkspace } from "./infrastructure/node-launch-profile.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for npm install + build
const BUILD_MAX_BUFFER = 50 * 1024 * 1024; // 50 MB — npm output exceeds the 1 MB default

const logger = createLogger("AppBuilder");
const MAX_SOURCE_CHARS = 20_000;
type BuilderBackupEntry = { existed: boolean; content: string };

// Sleep helper for rate limit backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wrapper for AI calls with exponential backoff on 429 rate limit errors
 */
async function executeWithBackoff(
    client: any,
    config: any,
    prompt: any,
    maxRetries = 3
): Promise<any> {
    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            const result = await client.execute(prompt, undefined, config.apiKey || undefined);
            // Check for 429 specifically in error message or status
            if (!result.success && (result.error?.includes("429") || result.error?.includes("RESOURCE_EXHAUSTED"))) {
                throw new Error("429");
            }
            return result;
        } catch (err: any) {
            if (err.message === "429" && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 5000 + (Math.random() * 1000);
                logger.warn(`[AppBuilder] 429 Rate limit hit. Retrying in ${Math.round(delay/1000)}s... (Attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                attempt++;
            } else {
                throw err;
            }
        }
    }
    throw new Error("Max retries exceeded");
}

const IMPERATIVE_VERBS = /(can you|could you|please|I'd like to|let's|help me)\s+(change|add|remove|update|set|make|switch|turn|use|apply|replace|fix|adjust|increase|decrease|move|rename|delete|show|hide|enable|disable|beautify|enhance|modernize|redesign|polish|style|design)/i;
const COMMAND_TRIGGERS = /\b(change|add|remove|update|set|make|switch|turn|use|apply|replace|fix|adjust|increase|decrease|move|rename|delete|show|hide|enable|disable|beautify|enhance|modernize|redesign|polish|style|design)\b/i;

const CONVERSATIONAL_TRIGGERS = [
    /^what.*(font|color|palette|theme|layout|background|style|design|option|available|can i use|do you support)/i,
    /^(show me|list|tell me|explain|how do i|how can i|what are|what is|which).*(font|color|theme|layout|style|design|gradient|shadow|glassmorphism|palette|component|animation|background)/i,
    /^(what|how|which|is there|are there|do you|does this)/i,
];

const DESIGN_SYSTEM_TRIGGERS = /\b(beautify|design system|stitch|premium|obsidian|gold|theme|style|aesthetic|modernize|redesign|ui strategy)\b/i;
const DEBUG_TRIGGERS = /\b(debug|diagnose|why (is|isn't|doesn't|won't|isn't)|not (working|loading|rendering|showing)|broken|crash(ing|ed)?|error|exception|TypeError|ReferenceError|blank (screen|page)|white screen|500|404|infinite loop|fix (the )?(bug|issue|error|problem)|something('s| is) wrong)\b/i;

function isDebugRequest(prompt: string): boolean {
    return DEBUG_TRIGGERS.test(prompt.trim());
}

function isConversational(prompt: string): boolean {
    const trimmed = prompt.trim();
    // If it contains a command verb anywhere, it's likely NOT just conversational
    if (COMMAND_TRIGGERS.test(trimmed)) return false;
    if (IMPERATIVE_VERBS.test(trimmed)) return false;
    if (/\?$/.test(trimmed) && !COMMAND_TRIGGERS.test(trimmed)) return true;
    return CONVERSATIONAL_TRIGGERS.some(re => re.test(trimmed));
}

const DESIGN_KNOWLEDGE = `
Available design options in the Oddjob App Studio:

**Fonts** (via Google Fonts — added via pages/_document.tsx <link> tag, applied with style={{ fontFamily: 'Poppins, sans-serif' }}):
- Inter (default, clean sans-serif)
- Outfit (modern, geometric)
- Geist (vercel-style, minimal)
- Poppins, Sora, DM Sans, Nunito, Manrope
- For monospace: JetBrains Mono, Fira Code, IBM Plex Mono
- Note: use a <link> tag in _document.tsx, NOT next/font/google (not supported here)

**Colors / Themes**:
- Tailwind's full palette (slate, zinc, stone, blue, indigo, violet, emerald, rose, amber, etc.)
- Custom CSS variables via globals.css (:root { --primary: ...; })
- Dark mode via .dark class or next-themes
- Glassmorphism: bg-white/10 backdrop-blur-md border border-white/20
- Gradients: bg-gradient-to-br from-indigo-500 to-purple-600

**Backgrounds**:
- Solid: bg-slate-950, bg-zinc-900, bg-white
- Gradient: bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900
- Animated: CSS keyframe shimmer/pulse via globals.css
- Mesh gradient via inline SVG or CSS conic-gradient
- Noise texture via a repeating SVG background-image

**Layouts**:
- Grid: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4
- Flex: flex flex-col / flex-row gap-x
- Sidebar + main: flex h-screen (sidebar w-64 + flex-1 overflow-auto)
- Dashboard: resizable panels (shadcn ResizablePanelGroup)
- Full-bleed hero with sticky nav

**UI Components** (import from @domain-ui/core/ui/components/ui/[name]):
- **Layout**: Card, Tabs, Sheet, Accordion, ScrollArea, Separator, Resizable, Sidebar
- **Data & Tables**: Table, DataTable (advanced), StatCard, Badge, Avatar
- **Visualization**: Chart (recharts), Gauge (circular dial/meter), Progress
- **Media**: VideoPlayer (HTML5), AudioPlayer (HTML5), YouTubePlayer
- **Inputs & Forms**: Button, Input, Select, MultiSelect, Checkbox, Switch, Slider, Textarea, Label, ToggleGroup, InputOTP
- **Navigation**: Breadcrumb, NavigationMenu, Pagination, Carousel
- **Overlays**: Dialog, Popover, Drawer, Tooltip, HoverCard, ContextMenu, Command (palette)
- **Feedback**: Toast, Alert, Skeleton, EmptyState
- **Utilities**: CopyButton, RefreshButton, FileDropzone
- **AI**: CopilotKit, CopilotPopup, CopilotSidebar, FormRenderer

**Aesthetic Rules**:
- **Glassmorphism**: Use \`bg-white/10 backdrop-blur-md border border-white/20\` for a premium look.
- **Grids**: Use \`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6\`.
- **Gradients**: Favor subtle, soft gradients: \`bg-gradient-to-br from-indigo-500/20 to-purple-500/0\`.

**Orchestration Patterns**:
- **DataTable**: Use \`import { DataTable, type Column } from "@domain-ui/core/ui/components/ui/data-table"\`.
  - Column structure: \`{ header: "Name", accessorKey: "name", cell: (row) => <Badge>{row.name}</Badge> }\`.
  - Props: \`columns\`, \`data\`, \`searchPlaceholder\`, \`searchKeys: ["key1", "key2"]\`.
- **Resizable Layout**: Use \`ResizablePanelGroup\`, \`ResizablePanel\`, and \`ResizableHandle\` from "@domain-ui/core/ui/components/ui/resizable".
  - Pattern: \`<ResizablePanelGroup direction="horizontal"> <ResizablePanel defaultSize={20}>Sidebar</ResizablePanel> <ResizableHandle /> <ResizablePanel>Main content</ResizablePanel> </ResizablePanelGroup>\`.
- **Sidebar**: Use \`SidebarProvider\`, \`Sidebar\`, \`SidebarContent\` for app-level navigation.

Just describe what you want and the builder will apply it to your code.
`;

/**
 * Fetches recent server-side container logs AND client-side browser errors
 * (written to .client-errors.log by the in-app error relay) for debug context.
 */
async function fetchContainerLogs(appId: number, workspacePath: string): Promise<string[]> {
    const lines: string[] = [];

    // ── Server logs via docker logs ───────────────────────────────────────────
    try {
        const [deployment] = await db
            .select({ id: appDeployments.id })
            .from(appDeployments)
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.status, "active")))
            .limit(1);

        if (deployment) {
            const [instance] = await db
                .select({ containerId: appInstances.containerId })
                .from(appInstances)
                .where(and(eq(appInstances.deploymentId, deployment.id), eq(appInstances.status, "running")))
                .limit(1);

            if (instance?.containerId) {
                const serverLogs = await dockerBridgeService.getLogs(instance.containerId, 150);
                if (serverLogs.length > 0) {
                    lines.push("=== SERVER / NEXT.JS LOGS ===");
                    lines.push(...serverLogs);
                }
            }
        }
    } catch (err: any) {
        logger.warn(`[AppBuilder] Could not fetch server logs: ${err.message}`);
    }

    // ── Client-side errors via .client-errors.log (written by the error relay) ─
    try {
        const clientLogPath = path.join(workspacePath, ".client-errors.log");
        const raw = await fs.readFile(clientLogPath, "utf-8");
        const entries = raw.trim().split("\n").filter(Boolean).slice(-100); // last 100 entries
        if (entries.length > 0) {
            lines.push("=== CLIENT-SIDE BROWSER ERRORS ===");
            lines.push(...entries);
        }
    } catch {
        // File doesn't exist yet — relay not installed or no errors yet
    }

    return lines;
}

/**
 * Resolves a design system context by looking up the linked Stitch project or
 * discovering the most relevant one. Fetches actual design tokens (colors, fonts, MD)
 * to be injected into the AI prompt.
 */
async function resolveDesignSystemContext(appTitle: string, existingStitchId?: string | null): Promise<string> {
    try {
        const allTools = mcpClientService.getAllTools();
        const getProj = allTools.find(t => t.name === 'stitch_get_project');
        const listProj = allTools.find(t => t.name === 'stitch_list_projects');
        
        if (!getProj || !listProj) return "";

        let projectId = existingStitchId;

        // Auto-discovery if no ID linked
        if (!projectId) {
            const listRaw = await listProj.execute({}, { named: {}, positional: {} } as ToolContext);
            const listData = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw;
            const projects = listData?.projects || [];
            
            const match = projects[0];
            
            if (match) {
                projectId = match.name.split('/').pop();
            }
        }

        if (projectId) {
            const projRaw = await getProj.execute({ name: `projects/${projectId}` }, { named: {}, positional: {} } as ToolContext);
            const projData = typeof projRaw === 'string' ? JSON.parse(projRaw) : projRaw;
            
            if (projData?.designTheme) {
                const theme = projData.designTheme;
                const colors = theme.namedColors || {};
                const designMd = projData.designMd || "";
                
                return `
DESIGN SYSTEM INJECTION (STITCH):
- Project: "${projData.title || projectId}"
- Strategy: ${designMd.slice(0, 1000)}...
- Semantic Colors: ${JSON.stringify(colors)}
- Typography: Headline: ${theme.headlineFont}, Body: ${theme.bodyFont}
- Roundness: ${theme.roundness}

MANDATE: Apply these specific colors and fonts to the UI. If you see 'primary', use "${colors.primary || '#indigo-500'}". 
If the strategy says "No Borders", remove borders and use background shifts. 
Match the 'Sovereign Intelligence' aesthetic (Gold/Obsidian) if specified in strategy.
`;
            }
        }
    } catch (err: any) {
        logger.warn(`[AppBuilder] Design context resolution failed: ${err.message}`);
    }
    return "";
}

export const appBuilderService = {
    /** @see normalizeEdits in ./app-builder-edits.ts */
    normalizeEdits,


    async previewEnhancementPlan(
        appId: number,
        slug: string,
        prompt: string,
        organizationId?: number,
        scopePath?: string
    ): Promise<{
        success: boolean;
        planId?: string;
        appId?: number;
        slug?: string;
        instruction?: string;
        mode?: "conversation" | "debug" | "design" | "implementation";
        requiresApproval?: boolean;
        risk?: "low" | "medium" | "high";
        likelyFiles?: string[];
        workspacePath?: string;
        scopePath?: string;
        checks?: string[];
        error?: string;
    }> {
        const app = await appRegistryService.getApp(appId).catch(() => null);
        if (!app) return { success: false, error: "App record not found." };

        if (organizationId) {
            const ownerOrgId = (app as any).developerOrgId ?? (app as any).organizationId ?? null;
            if (ownerOrgId && ownerOrgId !== organizationId) {
                return { success: false, error: "App Builder access requires the app's developer organization." };
            }
        }

        const workspacePath = await resolveForgeWorkspacePath(slug);
        try {
            await fs.access(workspacePath);
        } catch {
            return { success: false, error: "Workspace directory not found for this app." };
        }

        const workspaceSnapshot = await snapshotDirectory(workspacePath, MAX_SOURCE_CHARS, scopePath);
        const mode = isDebugRequest(prompt)
            ? "debug"
            : isConversational(prompt)
                ? "conversation"
                : DESIGN_SYSTEM_TRIGGERS.test(prompt)
                    ? "design"
                    : "implementation";

        const likelyFiles = selectLikelyEnhancementFiles(prompt, workspaceSnapshot, mode);
        const checks = [
            "App registry ownership checked",
            "Forge workspace resolved",
            `${Object.keys(workspaceSnapshot).length} source files sampled`,
            mode === "conversation" ? "No file write expected" : "Generated edits will be validated before write",
            scopePath ? `Writes will be restricted to ${scopePath}` : "Writes will be restricted to the app workspace",
        ];

        const risk = mode === "debug" || likelyFiles.includes("package.json")
            ? "high"
            : likelyFiles.length > 3
                ? "medium"
                : "low";

        return {
            success: true,
            planId: `builder_plan_${appId}_${Date.now()}`,
            appId,
            slug,
            instruction: prompt,
            mode,
            requiresApproval: mode !== "conversation",
            risk,
            likelyFiles,
            workspacePath,
            ...(scopePath ? { scopePath } : {}),
            checks,
        };
    },

    async enhanceApp(
        appId: number,
        slug: string,
        prompt: string,
        organizationId?: number,
        chatHistory?: { role: string; content: string }[],
        scopePath?: string // Optional scope for shared server workbenches (e.g., "app/pm-workbench")
    ): Promise<{
        success: boolean;
        filesWritten?: number;
        error?: string;
        message?: string;
        conversational?: boolean;
        buildFailed?: boolean;
        recoverable?: boolean;
        backupAvailable?: boolean;
    }> {
        logger.info(`[AppBuilder] Interactive enhancement requested for ${slug}`);

        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) return { success: false, error: "App record not found." };

        // Check if the app is a Tokenized UI app
        const isTokenized = app.config && (app.config as any).tokenizedUI;
        if (isTokenized) {
            logger.info(`[AppBuilder] Tokenized UI app detected: ${slug}. Initiating schema-level enhancement.`);
            try {
                const currentSchema = (app.config as any).tokenizedUI;
                
                const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const aiConfig = await systemAiService.getAiConfig('copilot', organizationId);
                if (!aiConfig) {
                    throw new Error("AI configuration not found.");
                }
                const client = AIClientFactory.getClient(aiConfig as any);
                
                const promptMsg = `User request: "${prompt}"\n\nCurrent Tokenized UI Schema:\n${JSON.stringify(currentSchema, null, 2)}`;
                const { TOKENIZED_UI_GENERATOR_PROMPT } = await import("./core/forge-prompts.js");
                
                const result = await executeWithBackoff(client, aiConfig, {
                    model: aiConfig.model,
                    systemPrompt: `${TOKENIZED_UI_GENERATOR_PROMPT}\nYour task is to take the user's request and edit/re-generate the provided schema to fulfill it. Output ONLY the updated JSON schema, complying with the original TokenizedUISchema rules. Do not include markdown wraps or prose.`,
                    messages: [{ role: 'user', content: promptMsg }],
                    requestType: "text",
                    responseType: "text",
                    maxTokens: 4096,
                });

                if (!result.success || !result.output) {
                    throw new Error(result.error || "AI failed to generate updated layout schema.");
                }

                let cleanOutput = String(result.output).trim();
                if (cleanOutput.startsWith("```")) {
                    cleanOutput = cleanOutput.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
                }

                const updatedSchema = JSON.parse(cleanOutput);
                
                const updatedConfig = {
                    ...(app.config as any),
                    tokenizedUI: updatedSchema
                };
                
                await db.update(apps)
                    .set({ config: updatedConfig })
                    .where(eq(apps.id, appId));
                
                logger.info(`[AppBuilder] Successfully updated Tokenized UI schema for app ${slug}`);
                return {
                    success: true,
                    filesWritten: 1,
                    message: "Tokenized UI schema updated successfully."
                };
            } catch (err: any) {
                logger.error(`[AppBuilder] Tokenized UI enhancement failed: ${err.message}`);
                return { success: false, error: `Failed to update schema: ${err.message}` };
            }
        }

        // Shared server apps have special handling
        const isShared = isSharedServerApp(slug);
        if (isShared) {
            logger.info(`[AppBuilder] Shared server app detected: ${slug}`);
            if (scopePath) {
                logger.info(`[AppBuilder] Scope restricted to: ${scopePath}`);
            }
        }

        // ── Debug intent: pull container logs and ask AI to fix ─────────────────
        const isDebug = isDebugRequest(prompt);
        if (isDebug) {
            logger.info(`[AppBuilder] Debug intent detected — fetching container logs for ${slug}`);
        }

        // ── Conversational intent: answer questions without rebuilding ──────────
        if (!isDebug && isConversational(prompt)) {
            logger.info(`[AppBuilder] Detected conversational prompt — answering without rebuild`);
            try {
                const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const aiConfig = await systemAiService.getAiConfig('copilot', organizationId);
                if (aiConfig) {
                    const client = AIClientFactory.getClient(aiConfig as any);
                    
                    // Prepend chat history to conversational context
                    const messages = (chatHistory || []).slice(-10).map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        content: m.content
                    }));
                    messages.push({ role: 'user', content: prompt });

                    const result = await executeWithBackoff(client, aiConfig, {
                        model: aiConfig.model,
                        systemPrompt: `You are the Oddjob App Studio design assistant. Answer the user's question about design options concisely and helpfully. Use the following knowledge base:\n${DESIGN_KNOWLEDGE}\nIf the user asks to apply something, tell them to rephrase as an instruction (e.g. "Change the font to Poppins").`,
                        messages,
                        requestType: "text",
                        responseType: "text",
                        maxTokens: 512,
                    } as any);
                    if (result.success && result.output) {
                        return { success: true, conversational: true, message: String(result.output), filesWritten: 0 };
                    }
                }
            } catch (err: any) {
                logger.warn(`[AppBuilder] Conversational AI call failed, falling back to static: ${err.message}`);
            }
            return { success: true, conversational: true, message: DESIGN_KNOWLEDGE, filesWritten: 0 };
        }

        const workspacePath = await resolveForgeWorkspacePath(slug);
        
        try {
            await fs.access(workspacePath);
        } catch {
            return { success: false, error: "Workspace directory not found for this app." };
        }

        // 1. Snapshot current code state
        logger.info(`[AppBuilder] Snapshotting workspace: ${workspacePath}`);
        const workspaceSnapshot = await snapshotDirectory(workspacePath, MAX_SOURCE_CHARS, scopePath);

        // 1.5 Fetch UI Palette Manifest
        const uiPalette = await uiRegistryService.getUIPaletteManifest();

        // 1.6 Fetch server + client error context for debug requests
        let containerLogs: string[] = [];
        if (isDebug) {
            containerLogs = await fetchContainerLogs(appId, workspacePath);
            logger.info(`[AppBuilder] Retrieved ${containerLogs.length} log lines for debug context`);
        }

        // 2. Build AI prompt
         const debugSystemPrompt = `You are the Oddjob Interactive App Builder in DEBUG mode.
 The user reports an error or broken behavior. You will receive:
 - currentErrors: server-side Next.js/container logs AND client-side browser errors (if the error relay is installed)
 - currentFiles: the full source of the workspace
 
 Your job:
 1. Analyze currentErrors to identify the root cause (TypeErrors, missing modules, bad imports, unhandled rejections, etc.)
 2. Cross-reference with currentFiles to find the exact location
 3. Fix the root cause — do NOT add error suppression. Fix the actual bug.
 4. If pages/api/report-error.ts is missing, add it. If pages/_app.tsx lacks the error relay useEffect, add it — this ensures future browser errors are captured automatically.
 
 Error relay to inject if missing:
 - pages/api/report-error.ts: accept POST, append JSON line to .client-errors.log via fs.appendFileSync(path.join(process.cwd(), '.client-errors.log'), ...)
 - pages/_app.tsx useEffect: window.addEventListener('error', ...) + window.addEventListener('unhandledrejection', ...) both POST to /api/report-error
 
 Critical rules:
 - **Oddjob UI Library**: Use components from "@domain-ui/core/ui/components/ui/[name]". Available: Card, Button, Input, Badge, Table, Tabs, Dialog, Tooltip, Select, Skeleton, Progress, Avatar, etc.
 - **Hooks**: Use useToast from "@domain-ui/core/ui/hooks/use-toast".
 - **NEVER import from "@shared/"** — that package does not exist in the workspace.
 - **Icons**: Do NOT import lucide-react unless already present in package.json. Use inline SVGs or emoji instead.
 - **External API calls**: NEVER call external APIs from client components — always proxy through pages/api/*.ts routes.
 
 ═══════════════════════════════════════════════════════
 CRITICAL: OUTPUT FORMAT (FAILURE TO FOLLOW = SYSTEM CRASH)
 ═══════════════════════════════════════════════════════
 1. Return ONLY a valid JSON object.
 2. Keys are relative file paths (e.g., "pages/index.tsx").
 3. Values are the COMPLETE corrected file content.
 4. DO NOT include any conversational text, explanations, or metadata outside the JSON.
 5. DO NOT use markdown code blocks (\`\`\`json). Return raw, valid JSON string.
 ═══════════════════════════════════════════════════════`;

         const standardSystemPrompt = `You are the Oddjob Interactive App Builder.
 Your goal is to modify the existing application codebase based on the user's instructions.
 
 Guidelines:
 - **Oddjob UI Library**: Use components from "@domain-ui/core/ui/components/ui/[name]" (resolved via tsconfig path alias to ./src/domain/core/ui/). 
   - Available: Card, Button, Input, Badge, Table, DataTable, StatCard, Tabs, Dialog, Tooltip, Select, MultiSelect, Slider, Gauge, VideoPlayer, AudioPlayer, YouTubePlayer, Skeleton, Progress, Avatar, Sidebar, Breadcrumb, Command, Pagination, Carousel, Resizable, etc.
 - **Hooks**: Use useToast from "@domain-ui/core/ui/hooks/use-toast".
 - **NEVER import from "@shared/"** — that package does not exist in the workspace.
 - **Font changes**: Add a <link> tag in pages/_document.tsx (create it if missing) and apply with style={{ fontFamily: 'Outfit, sans-serif' }}.
 - **Data Visualization (Recharts)**: Use \`recharts\` for charts. Use the new \`Gauge\` component from "@domain-ui/core/ui/components/ui/gauge" for circular dials/meters.
 - **Media**: Use \`VideoPlayer\`, \`AudioPlayer\` or \`YouTubePlayer\` from "@domain-ui/core/ui/components/ui/[name]" for media-rich features.
 - **Fidelity First**: Preserve the existing app's purpose, information architecture, copy, controls, calculations, routes, API calls, and data contracts unless the user explicitly asks to change them. A theme/style request is visual-only.
 - **Framework Fidelity**: Keep the current framework. For Express/static apps, edit their existing public HTML/CSS/JS; never replace them with a React, Next.js, chat, or dashboard scaffold.
 - **Aesthetics**: Follow any explicit design identity or selected theme exactly. When none is supplied, use restrained platform-native polish; do not impose glassmorphism or a dark theme by default.
 - **AI Embellishment**: Add decorative hierarchy, micro-interactions, and responsive polish only to the degree the user asks. Embellishment must never invent features or remove existing ones.
 - **Icons (Lucide React)**: You MUST use \`lucide-react\` for UI indicators. If it's missing from package.json, add it.
 
 ${isShared ? `
 - **Shared Server Architecture**: This is a shared Next.js server hosting multiple workbenches as route groups.
 - **Route Groups**: Workbenches are organized under app/{workbench-name}/ directories.
 - **Editing Scope**: ${scopePath ? `Currently scoped to: ${scopePath}. Only edit files within this directory.` : 'Editing the entire shared server. Focus on the specific route group being modified.'}
 - **Shared Components**: Common components should be placed in app/components/ or lib/ directories.
 - **Navigation**: Use Next.js App Router with route groups for internal navigation between workbenches.
 ${scopePath ? `- **Scope Restriction**: You MUST only modify files within the ${scopePath} directory. Do not edit files outside this scope.` : ''}
 ` : ''}
 
 ═══════════════════════════════════════════════════════
 ARCHITECTURAL AWARENESS & CODE INTELLIGENCE (X-RAY)
 ═══════════════════════════════════════════════════════
 Before making logic changes, you MUST ensure you understand the "Blast Radius":
 1. Use 'xray_find_symbol' to locate definitions of functions, classes, or interfaces.
 2. Use 'xray_trace_impact' if you are modifying a shared utility, a database schema, or a exported route.
 3. RISK REPORTING: If 'xray_trace_impact' shows more than 2 impacted files:
    - DO NOT apply the code changes immediately.
    - Instead, return a CONVERSATIONAL MESSAGE starting with "⚠️ RISK ASSESSMENT:" summarizing the impacted files and why they are affected.
    - Ask the user: "Should I proceed with these changes?"
    - Only write the code if the user explicitly confirms (e.g., "Yes", "Proceed", "Go ahead").
 4. If the impact is isolated (0-2 files), proceed with the generation immediately but mention the files identified.
 
 ═══════════════════════════════════════════════════════
 CRITICAL: OUTPUT FORMAT (FAILURE TO FOLLOW = SYSTEM CRASH)
 ═══════════════════════════════════════════════════════
 1. Return ONLY a valid JSON object.
 2. Keys are relative file paths.
 3. Values are the complete updated file content.
 4. DO NOT include any conversational text prefix or suffix.
 5. DO NOT use markdown code blocks (\`\`\`json). Return raw, valid JSON string.
 ═══════════════════════════════════════════════════════`;

        const systemPrompt = isDebug ? debugSystemPrompt : standardSystemPrompt;

        // 2.2 Resolve Design Context (Stitch)
        let stitchDesignTokens = "";
        if (DESIGN_SYSTEM_TRIGGERS.test(prompt)) {
            logger.info(`[AppBuilder] Design system intent detected — resolving Stitch context for ${slug}`);
            stitchDesignTokens = await resolveDesignSystemContext(app.name || slug, app.stitchProjectId);
        }

        const userPromptPayload: Record<string, any> = {
            instructions: prompt,
            uiPalette,
            currentFiles: workspaceSnapshot
        };
        if (isDebug && containerLogs.length > 0) {
            userPromptPayload.currentErrors = containerLogs.join('\n');
        } else if (isDebug) {
            userPromptPayload.currentErrors = "No logs available (container may be offline and no client errors have been captured yet). Inspect the source files for likely issues (bad imports, missing null checks, incorrect API calls, CORS violations, etc.). Also ensure the error relay (pages/api/report-error.ts + _app.tsx listeners) is present so future errors are captured.";
        }

        const userPrompt = JSON.stringify(userPromptPayload, null, 2);

        // 3. Call AI
        let generatedFiles: Record<string, string> = {};
        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const aiConfig = await systemAiService.getAiConfig('copilot', organizationId);
            if (!aiConfig) {
                return { success: false, error: "No AI configuration available for this organization." };
            }

            const allTools = await mcpClientService.getAllTools();
            const tools = allTools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: (t as any).parameters
            }));

            const stitchInstructions = app.stitchProjectId || allTools.some(t => t.name.startsWith("stitch")) 
                ? `\n\nSTITCH DESIGN SYSTEM: You have access to Stitch design tools. 
1. The current project ID is: "${app.stitchProjectId || 'NOT_LINKED'}".
2. If ID is NOT_LINKED, first call 'stitch_create_project' with title: "${app.name}".
3. Use the projectId for design tasks like 'stitch_generate_variants'.
4. Integrate resulting UI code into the app files.`
                : "";

            logger.info(`[AppBuilder] Invoking AI to generate code edits (Agentic mode)...`);
            const client = AIClientFactory.getClient(aiConfig as any);
            
            let messages: any[] = [];
            
            // Integrate persistent chat history for context-aware "Double-Turn" flows
            if (chatHistory && chatHistory.length > 0) {
                // Take last 8 turns (16 messages) to maintain context without exceeding token limits
                const history = chatHistory.slice(-16).map(m => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    content: m.content
                }));
                messages.push(...history);
            }

            messages.push({ role: "user", content: userPrompt });

            let raw = "";
            let callCount = 0;
            const maxCalls = 8;
            let currentStitchId = app.stitchProjectId;

            while (callCount < maxCalls) {
                callCount++;
                let result;
                try {
                    result = await executeWithBackoff(client, aiConfig, {
                        model: aiConfig.model,
                        systemPrompt: systemPrompt + stitchInstructions + stitchDesignTokens,
                        messages,
                        tools: tools.length > 0 ? tools : undefined,
                        maxTokens: isDebug ? 8192 : 4096,
                        requestType: (tools.length === 0) ? "json" : "text",
                    } as any);
                } catch (err: any) {
                    return { success: false, error: `AI generation failed after retries: ${err.message}` };
                }

                if (!result.success || (!result.output && !result.metadata?.toolCalls)) {
                    return { success: false, error: `AI generation failed: ${result.error}` };
                }

                if (result.metadata?.toolCalls) {
                    logger.info(`[AppBuilder] AI invoking tools: ${result.metadata.toolCalls.map((tc: any) => tc.name).join(", ")}`);
                    
                    const modelParts: any[] = [];
                    if (result.output && !result.output.startsWith('{"toolCalls"')) {
                        modelParts.push({ text: result.output });
                    }
                    result.metadata.toolCalls.forEach((tc: any) => {
                        modelParts.push({ functionCall: tc });
                    });
                    messages.push({ role: "model", content: modelParts });

                    for (const tc of result.metadata.toolCalls) {
                        const targetTool = allTools.find(t => t.name === tc.name);
                        if (targetTool) {
                            try {
                                const toolResult = await targetTool.execute(tc.args || {}, { 
                                    named: {}, 
                                    positional: {},
                                    organizationId
                                } as ToolContext);
                                
                                // Dynamic Project ID capture
                                if (tc.name === 'stitch_create_project' && toolResult) {
                                    try {
                                        const data = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                                        const newId = data?.projectId || data?.id;
                                        if (newId) {
                                            currentStitchId = newId;
                                            await db.update(apps).set({ stitchProjectId: newId }).where(eq(apps.id, appId));
                                            logger.info(`[AppBuilder] Captured and persisted new Stitch Project ID: ${newId}`);
                                        }
                                    } catch {}
                                }

                                messages.push({
                                    role: "tool",
                                    content: [{ 
                                        functionResponse: {
                                            name: tc.name,
                                            response: typeof toolResult === 'string' ? { content: toolResult } : toolResult
                                        }
                                    }]
                                });
                            } catch (e: any) {
                                messages.push({
                                    role: "tool",
                                    content: [{ 
                                        functionResponse: {
                                            name: tc.name,
                                            response: { error: e.message }
                                        }
                                    }]
                                });
                            }
                        }
                    }
                } else {
                    raw = result.output?.trim() || "";
                    break;
                }
            }

            if (!raw) {
                return { success: false, error: "AI failed to return any code adjustments." };
            }

            let jsonBlock = this.getJsonBlock(raw);
            if (!jsonBlock) {
                logger.error(`[AppBuilder] AI failed to format code edits as JSON. Raw output (first 500 chars): ${raw.slice(0, 500).replace(/\n/g, ' ')}`);
                return { success: false, error: "AI failed to format code edits as JSON." };
            }

            // Try to auto-fix common JSON errors
            const fixed = tryFixJson(jsonBlock);
            if (fixed && fixed.changes.length > 0) {
                logger.info(`[AppBuilder] Auto-fixed JSON: ${fixed.changes.join(', ')}`);
                jsonBlock = fixed.fixed;
            }

            try {
                generatedFiles = JSON.parse(jsonBlock);
            } catch (e: any) {
                const posMatch = e.message?.match(/position (\d+)/);
                const pos = posMatch ? parseInt(posMatch[1], 10) : 0;
                const context = getErrorContext(jsonBlock, pos, 50);
                logger.error(`[AppBuilder] AI returned invalid JSON. Error: ${e.message}. Context: ${context}`);
                logger.error(`[AppBuilder] Raw output below:\n--- RAW AI RESPONSE START ---\n${raw.slice(0, 2000)}\n--- RAW AI RESPONSE END ---`);
                return { success: false, error: `AI returned invalid JSON: ${e.message}` };
            }

            // Normalize generatedFiles across common LLM structure variations:
            generatedFiles = this.normalizeEdits(generatedFiles);

            if (!generatedFiles || typeof generatedFiles !== "object") {
                return { success: false, error: "AI returned an invalid edit payload. Expected file paths with string code content." };
            }

            if (Object.keys(generatedFiles).length === 0) {
                logger.info(`[AppBuilder] AI returned 0 file modifications for ${slug}`);
                return {
                    success: true,
                    filesWritten: 0,
                    message: "No files changed — the AI found nothing to update for that request."
                };
            }

            const validation = await forgeValidatorService.validateCode(generatedFiles);
            if (validation.fixed) {
                generatedFiles = { ...generatedFiles, ...validation.fixed };
            }
            if (!validation.valid) {
                const summary = forgeValidatorService.getSummary(validation.issues);
                const topIssues = validation.issues
                    .filter(issue => issue.severity === "critical" || issue.severity === "high")
                    .slice(0, 5)
                    .map(issue => `${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.type}: ${issue.message}`)
                    .join("; ");
                return {
                    success: false,
                    error: `Generated code failed security validation (${summary.critical} critical, ${summary.high} high). ${topIssues}`,
                };
            }
        } catch (err: any) {
            logger.error(`[AppBuilder] AI call failed: ${err.message}`);
            return { success: false, error: "AI failed to parse code adjustments." };
        }

        // 4. Backup files about to be overwritten so the user can revert
        const backupData: Record<string, BuilderBackupEntry> = {};
        let backupAvailable = false;
        for (const relPath of Object.keys(generatedFiles)) {
            const fullPath = path.resolve(workspacePath, relPath);
            if (!isWithinDirectory(workspacePath, fullPath)) continue;
            try {
                backupData[relPath] = {
                    existed: true,
                    content: await fs.readFile(fullPath, "utf-8"),
                };
            } catch {
                backupData[relPath] = { existed: false, content: "" };
            }
        }
        try {
            await fs.writeFile(
                path.join(workspacePath, ".builder-last-backup.json"),
                JSON.stringify(backupData),
                "utf-8"
            );
            backupAvailable = true;
        } catch (err: any) {
            logger.warn(`[AppBuilder] Failed to write backup: ${err.message}`);
        }

        // 5. Write generated files into the workspace
        let written = 0;
        for (const [relPath, content] of Object.entries(generatedFiles)) {
            if (typeof content !== "string") continue;
            // Security: keep within workspace
            const fullPath = path.resolve(workspacePath, relPath);
            if (!isWithinDirectory(workspacePath, fullPath)) {
                logger.warn(`[AppBuilder] Skipped out-of-workspace path: ${relPath}`);
                continue;
            }
            
            // Scope validation for shared servers
            if (scopePath) {
                const scopedDirPath = path.resolve(workspacePath, scopePath);
                if (!isWithinDirectory(scopedDirPath, fullPath)) {
                    logger.warn(`[AppBuilder] Skipped out-of-scope path: ${relPath} (scope: ${scopePath})`);
                    continue;
                }
            }
            
            try {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, content, "utf-8");
                written++;
            } catch (err: any) {
                logger.warn(`[AppBuilder] Failed to write ${relPath}: ${err.message}`);
            }
        }

        logger.info(`[AppBuilder] Wrote ${written} updated files into ${slug}`);

        if (written === 0) {
           const requestedFiles = Object.keys(generatedFiles).length;
           return requestedFiles === 0
               ? { success: true, filesWritten: 0, message: "No file changes were requested." }
               : {
                   success: false,
                   filesWritten: 0,
                   error: "No generated files were written. The requested paths were outside the app workspace or scope.",
                   recoverable: false,
                   backupAvailable,
               };
        }

        // 5.5 Repair _app.tsx globals.css import if the AI removed it
        if ('pages/_app.tsx' in generatedFiles) {
            try {
                const appTsxPath = path.join(workspacePath, "pages", "_app.tsx");
                const content = await fs.readFile(appTsxPath, "utf-8");
                if (!content.includes("globals.css")) {
                    await fs.writeFile(appTsxPath, `import "../styles/globals.css";\n${content}`, "utf-8");
                    logger.info(`[AppBuilder] Repaired globals.css import in _app.tsx for ${slug}`);
                }
            } catch (repairErr: any) {
                logger.warn(`[AppBuilder] _app.tsx repair warning: ${repairErr.message}`);
            }
        }

        // 6. Restart or rebuild depending on whether package.json changed.
        // If package.json was modified the v1 image must be rebuilt so npm install runs.
        // Otherwise just restart — the bind-mounted source is already up to date and
        // Next.js HMR will pick up the changes within seconds.
        const packageJsonChanged = 'package.json' in generatedFiles;

        try {
            await appRegistryService.stopApp(appId);

            // ALWAYS trigger a full container rebuild for forged apps to ensure 
            // platform-correct binaries (Linux) are generated inside the container.
            // Host-side builds on Windows cause next-swc/native binary mismatches.
            logger.info(`[AppBuilder] Triggering robust in-container rebuild for ${slug}...`);
            
            // Purge the named node_modules volume so it re-initialises from the new image.
            await dockerBridgeService.deleteVolume(`oddjob-nm-${slug}`).catch(() => {});
            
            const rebuildResult = await this.buildContainer(appId, slug);
            if (!rebuildResult.success) {
                return {
                    success: false,
                    filesWritten: written,
                    error: rebuildResult.error,
                    buildFailed: true,
                    recoverable: true,
                    backupAvailable,
                };
            }
            
            logger.info(`[AppBuilder] App enhancement complete and LIVE.`);
            return { success: true, filesWritten: written };
        } catch (err: any) {
            logger.error(`[AppBuilder] Container restart failed: ${err.message}`);
            return {
                success: false,
                filesWritten: written,
                error: err.message || "Container failed to restart with new code.",
                buildFailed: true,
                recoverable: true,
                backupAvailable,
            };
        }
    },

    async revertLast(
        appId: number,
        slug: string
    ): Promise<{ success: boolean; filesRestored?: number; error?: string }> {
        const workspacePath = await resolveForgeWorkspacePath(slug);
        const backupFile = path.join(workspacePath, ".builder-last-backup.json");

        let backupData: Record<string, string | BuilderBackupEntry>;
        try {
            const raw = await fs.readFile(backupFile, "utf-8");
            backupData = JSON.parse(raw);
        } catch {
            return { success: false, error: "No backup found — nothing to revert." };
        }

        let restored = 0;
        for (const [relPath, entry] of Object.entries(backupData)) {
            const fullPath = path.resolve(workspacePath, relPath);
            if (!isWithinDirectory(workspacePath, fullPath)) continue;
            try {
                const existed = typeof entry === "string" ? entry !== "" : entry.existed;
                const content = typeof entry === "string" ? entry : entry.content;
                if (!existed) {
                    // File was new - delete it.
                    await fs.unlink(fullPath).catch(() => {});
                } else {
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, "utf-8");
                }
                restored++;
            } catch (err: any) {
                logger.warn(`[AppBuilder] Revert failed for ${relPath}: ${err.message}`);
            }
        }

        // Remove backup so Revert can't be triggered twice
        await fs.unlink(backupFile).catch(() => {});

        // Rebuild and restart the production server with the restored files
        try {
            await this.buildContainer(appId, slug);
        } catch (err: any) {
            logger.warn(`[AppBuilder] Container restart after revert failed: ${err.message}`);
        }

        logger.info(`[AppBuilder] Reverted ${restored} file(s) for ${slug}`);
        return { success: true, filesRestored: restored };
    },

    async buildContainer(
        appId: number,
        slug: string
    ): Promise<{ success: boolean; error?: string }> {
        logger.info(`[AppBuilder] Full rebuild requested for ${slug}`);
        
        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) return { success: false, error: "App record not found." };

        const workspacePath = await resolveForgeWorkspacePath(slug);
        try { await fs.access(workspacePath); } catch {
            return { success: false, error: "Workspace directory not found." };
        }

        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(app.blueprint || "") ||
                            await fs.access(path.join(workspacePath, "Dockerfile")).then(() => true).catch(() => false);

        if (isDockerApp) {
            try {
                await appRegistryService.stopApp(appId);
                logger.info(`[AppBuilder] Building Docker container locally for ${slug}...`);
                const { dockerBridgeService } = await import("@domain/core/infrastructure/docker/docker-bridge.service.js");
                const buildRes = await dockerBridgeService.buildImage(workspacePath, `oddjob-app/${slug}`, "v1");
                if (!buildRes.success) {
                    return { success: false, error: buildRes.error };
                }

                const [dep] = await db.select({ organizationId: appDeployments.organizationId })
                    .from(appDeployments)
                    .where(eq(appDeployments.appId, appId))
                    .limit(1);
                
                await appRegistryService.startApp(appId, dep?.organizationId, { rebuildAttempted: true });
                logger.info(`[AppBuilder] Docker build & container start complete for ${slug}.`);
                return { success: true };
            } catch (err: any) {
                logger.error(`[AppBuilder] Docker rebuild failed: ${err.message}`);
                return { success: false, error: err.message || "Docker rebuild failed." };
            }
        }

        if (await detectLaunchProfile(workspacePath) === "node") {
            try {
                await appRegistryService.stopApp(appId);
                const prepared = await prepareNodeWorkspace(workspacePath, slug);
                if (!prepared.ready) return { success: false, error: prepared.error };

                const [dep] = await db.select({ organizationId: appDeployments.organizationId })
                    .from(appDeployments)
                    .where(eq(appDeployments.appId, appId))
                    .limit(1);
                await appRegistryService.startApp(appId, dep?.organizationId, { rebuildAttempted: true });
                logger.info(`[AppBuilder] Node build & process start complete for ${slug}.`);
                return { success: true };
            } catch (err: any) {
                logger.error(`[AppBuilder] Node rebuild failed: ${err.message}`);
                return { success: false, error: err.message || "Node rebuild failed." };
            }
        }

        try { await fs.access(path.join(workspacePath, "package.json")); } catch {
            return { success: false, error: "Critical build manifest (package.json) is missing from the workspace." };
        }

        try {
            await appRegistryService.stopApp(appId);

            // Mach 2: Robust local build
            logger.info(`[AppBuilder] Generating build locally for ${slug}...`);

            // Force NODE_ENV=production so that `next build` always runs a production
            // build. Without this the parent dev-server's NODE_ENV=development leaks
            // into the child process and causes the pre-renderer to fail on /404 and
            // /500 with "<Html> should not be imported outside of pages/_document".
            const buildEnv = tenantProcessEnv({
                NODE_ENV: "production",
                // Prevent Next.js instrumentation from creating symlinks in
                // .next/dev/node_modules/ which fails on Windows without
                // Developer Mode or elevated privileges (EPERM: symlink).
                NEXT_PRIVATE_WORKER: "1",
                ...(process.platform === "win32" ? { NEXT_DISABLE_SWC: "1" } : {}),
            });
            const execOpts = { cwd: workspacePath, timeout: BUILD_TIMEOUT_MS, maxBuffer: BUILD_MAX_BUFFER, env: buildEnv };
            try {
                // Remove stale .next directory before building — leftover .next/dev/
                // artifacts from prior dev sessions can interfere with production builds
                // (symlink creation attempts in .next/dev/node_modules/ on Windows).
                const nextOutputDir = path.join(workspacePath, ".next");
                await fs.rm(nextOutputDir, { recursive: true, force: true }).catch(() => {});

                const isWin = process.platform === "win32";
                // Use the workspace's local next binary (installed by the npm
                // install above), NOT the Oddjob server's. The server doesn't
                // depend on Next.js so process.cwd()/node_modules/.bin/next
                // wouldn't exist.
                const nextBin = path.resolve(workspacePath, "node_modules", ".bin", isWin ? "next.cmd" : "next");
                const hasNextBinary = await fs.access(nextBin).then(() => true).catch(() => false);
                if (!hasNextBinary) {
                    logger.info(`[AppBuilder] Running npm install for ${slug}...`);
                    // --include=dev is required: the build runs with NODE_ENV=production (for a
                    // production `next build`), under which npm omits devDependencies — but the
                    // build tools (tailwindcss, postcss, autoprefixer, typescript) live there.
                    // Without this, next build fails with "Cannot find module 'tailwindcss'".
                    await execAsync("npm install --no-audit --no-fund --legacy-peer-deps --no-package-lock --no-save --include=dev", execOpts);
                } else {
                    logger.info(`[AppBuilder] Reusing existing node_modules for ${slug}; next binary is already installed.`);
                }

                logger.info(`[AppBuilder] Running next build for ${slug}...`);
                const buildCmd = isWin ? `"${nextBin}" build` : `"${nextBin}" build`;

                if (isWin) {
                    // On Windows, NEXT_DISABLE_SWC is not honoured by Next.js 14.
                    // The only reliable way to bypass the broken SWC binary is to
                    // write a .babelrc that forces Babel compilation instead.
                    const babelRcPath = path.join(workspacePath, ".babelrc");
                    const hasBabelRc = await fs.access(babelRcPath).then(() => true).catch(() => false);
                    if (!hasBabelRc) {
                        logger.info(`[AppBuilder] Injecting .babelrc to bypass SWC binary for ${slug}...`);
                        await fs.writeFile(babelRcPath, JSON.stringify({
                            presets: ["next/babel"]
                        }, null, 2));
                    }
                    // Remove the corrupt @next/swc-win32-x64-msvc package so Next.js
                    // doesn't attempt to load it and immediately fails.
                    const swcWinPkg = path.join(workspacePath, "node_modules", "@next", "swc-win32-x64-msvc");
                    await fs.rm(swcWinPkg, { recursive: true, force: true }).catch(() => {});
                }

                try {
                    await execAsync(buildCmd, execOpts);
                } catch (firstBuildErr: any) {
                    if (firstBuildErr.message?.includes("swc") || firstBuildErr.message?.includes("Win32") || firstBuildErr.message?.includes("SWC")) {
                        logger.warn(`[AppBuilder] Build failed with SWC binary error, injecting .babelrc and retrying for ${slug}...`);
                        // Write .babelrc to force Babel (works even if already present; overwrite is safe)
                        const babelRcPath = path.join(workspacePath, ".babelrc");
                        await fs.writeFile(babelRcPath, JSON.stringify({ presets: ["next/babel"] }, null, 2));
                        // Nuke the corrupt SWC native binary
                        const swcWinPkg = path.join(workspacePath, "node_modules", "@next", "swc-win32-x64-msvc");
                        await fs.rm(swcWinPkg, { recursive: true, force: true }).catch(() => {});
                        // Clear .next so stale artifacts from the failed build don't interfere
                        const nextOutputDir = path.join(workspacePath, ".next");
                        await fs.rm(nextOutputDir, { recursive: true, force: true }).catch(() => {});
                        await execAsync(buildCmd, execOpts);
                    } else {
                        throw firstBuildErr;
                    }
                }
            } catch (buildErr: any) {
                logger.error(`[AppBuilder] Local build failed: ${buildErr.message}`);
                return { success: false, error: `Local build failed: ${buildErr.message}` };
            }

            const [dep] = await db.select({ organizationId: appDeployments.organizationId })
                .from(appDeployments)
                .where(eq(appDeployments.appId, appId))
                .limit(1);
            // Pass rebuildAttempted=true so the recursive provisionInstance
            // call here cannot trigger another buildContainer (which would
            // loop back to here). One rebuild attempt per outer call, max.
            await appRegistryService.startApp(appId, dep?.organizationId, { rebuildAttempted: true });
            logger.info(`[AppBuilder] Rebuild complete for ${slug}.`);
            return { success: true };
        } catch (err: any) {
            logger.error(`[AppBuilder] Rebuild failed: ${err.message}`);
            return { success: false, error: err.message || "Rebuild failed." };
        }
    },

    /**
     * JIT Forging: Initiates a background forge process for a predicted asset need.
     */
    async initiateBackgroundForge(
        options: {
            slug: string;
            name: string;
            description: string;
            organizationId?: number;
            missionRunId?: number;
            blueprint?: string;
        }
    ): Promise<{ success: boolean; jobId?: string }> {
        logger.info(`[AppBuilder] Initiating JIT Background Forge for ${options.slug}`);
        
        const { appForgeService } = await import("./app-forge.service.js");
        
        const forgeResult = await appForgeService.forgeApp(options.blueprint || "chat-assistant", {
            name: options.name,
            slug: options.slug,
            description: options.description,
            organizationId: options.organizationId,
            oddjobMissionId: options.missionRunId ?? 0, // Linking to the mission run
            jobId: `jit-${options.slug}-${Date.now()}`
        });

        return forgeResult;
    },

    /**
     * Surgically extracts the primary JSON block from a potentially noisy LLM response.
     * Prioritizes markdown code fences, falls back to greedy brace matching.
     */
    getJsonBlock(text: string): string | null {
        // Try markdown code block first (best for structured output)
        const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fencedMatch && fencedMatch[1]) {
            return fencedMatch[1].trim();
        }

        // Fallback: Greedy search for the largest brace-enclosed structure
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            return text.substring(firstBrace, lastBrace + 1).trim();
        }

        return null;
    }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function snapshotDirectory(
    dirPath: string,
    maxChars: number,
    scopePath?: string // Optional scope to restrict snapshot (e.g., "app/pm-workbench")
): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    let totalChars = 0;
    
    // Resolve the scoped directory if scopePath is provided
    const scopedDirPath = scopePath ? path.resolve(dirPath, scopePath) : dirPath;

    async function walk(dir: string): Promise<void> {
        let entries: any[];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (totalChars >= maxChars) return;
            const fullPath = path.join(dir, entry.name);
            
            // Skip directories outside the scope when scopePath is provided
            if (scopePath && !isWithinDirectory(scopedDirPath, fullPath)) {
                continue;
            }
            
            if (entry.isDirectory()) {
                if (["node_modules", ".next", "dist", ".git"].includes(entry.name)) continue;
                await walk(fullPath);
            } else if (/\.(ts|tsx|js|jsx|css|json)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
                try {
                    const content = await fs.readFile(fullPath, "utf-8");
                    // Skip oversized files but continue scanning remaining entries
                    if (totalChars + content.length > maxChars) continue;
                    const rel = path.relative(dirPath, fullPath).replace(/\\/g, "/");
                    snapshot[rel] = content;
                    totalChars += content.length;
                } catch {
                    // skip unreadable files
                }
            }
        }
    }

    await walk(scopedDirPath);
    return snapshot;
}

function selectLikelyEnhancementFiles(
    prompt: string,
    snapshot: Record<string, string>,
    mode: "conversation" | "debug" | "design" | "implementation"
): string[] {
    if (mode === "conversation") return [];

    const files = new Set<string>();
    const sourceFiles = Object.keys(snapshot);
    const primaryPage = sourceFiles.find(file => /^(pages\/index|src\/pages\/index|app\/page|src\/app\/page)\.(tsx|jsx)$/.test(file))
        ?? sourceFiles.find(file => /\.(tsx|jsx)$/.test(file));

    if (primaryPage) files.add(primaryPage);

    if (mode === "debug") {
        if (sourceFiles.includes("pages/_app.tsx")) files.add("pages/_app.tsx");
        files.add("pages/api/report-error.ts");
    }

    if (mode === "design" || /\b(color|theme|font|layout|style|redesign|polish|background|css)\b/i.test(prompt)) {
        const cssFile = sourceFiles.find(file => /(^|\/)(globals|global)\.css$/.test(file)) ?? "styles/globals.css";
        files.add(cssFile);
        files.add("pages/_document.tsx");
    }

    if (/\b(package|dependency|install|lucide|recharts|framer|chart|map|calendar|video|audio)\b/i.test(prompt)) {
        files.add("package.json");
    }

    return Array.from(files);
}
