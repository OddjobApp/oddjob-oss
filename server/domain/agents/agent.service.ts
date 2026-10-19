import { db } from "@server/database_service.js";
import { getOrgConditions } from '@server/utils/org-conditions.js';
import type { OrgContext } from '@server/utils/auth-context.js';
import { eq, and, desc, sql, inArray, gt } from "drizzle-orm";
import {
    agentChatMessages,
    credentials,
    videoCritiques,
    contactIntentStates,
    orgSettings,
    jobs,
    jobTypes,
    pipelines,
    datasets,
    toolPermissionMap,
    systemSettings,
    missions,
    type InsertVideoCritique,
    type McpPermission
} from "@shared/schema/index.js";
import { videoFeedbackService } from "@domain/media/video-feedback-service.js";
import { runAgentLoop } from "./agent-runner.js";
import { AIClientFactory, FallbackAIClient } from "@domain/ai/core/ai-client.service.js";
import { FileParser } from "@domain/core/infrastructure/file-parser.service.js";
import { randomUUID } from "crypto";
import { getFileCache, setFileCache, getChatHistory, setChatHistory, type CachedFile } from "@domain/auth/core/embed-profile-cache.js";
import { systemContextService } from "@domain/core/infrastructure/system-context.service.js";
import { embeddingService } from "@domain/knowledge/core/rag/embedding-service.js";
import { SidecarSyncService } from "../knowledge/core/sidecar-sync-service.js";
import { createLogger } from "@server/utils/logger.js";
const sidecarSyncService = new SidecarSyncService();
import { ragService } from "@domain/knowledge/core/rag.service.js";
import { promptService } from "@domain/ai/core/prompt-service.js";
import {
    buildCopilotActionPreview as buildActionPreview,
    deriveCopilotEvidence as deriveEvidence,
    isReadOnlyAppPresentationRequest,
    extractInstantAppRenderRequest,
    extractInstantAppAssembleRequest,
    isExplicitAssistantFormRequest,
    isExplicitExternalResearchRequest,
    normalizeCopilotMode,
    type CopilotEvidenceItem,
    type CopilotMode,
} from "@domain/ai/core/copilot-contract.js";
import { criticService } from "./core/critic-service.js";
import { isGreetingMessage, isTrivialChatMessage } from "./core/chat-intent.js";
import { MoltProducer } from "@domain/governor/index.js";
import type { GovernanceResolved } from "@domain/governor/index.js";
import { missionService } from "../mission/core/mission.service.js";
import { systemAiService } from "../ai/core/system-ai.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";
import { copilotIntentPredictor } from "@domain/ai/core/copilot-intent-predictor.service.js";
import { dailyBriefService } from "@domain/admin/core/daily-brief.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
const logger = createLogger("AgentService");

function normalizeAppSearchText(value: unknown): string {
    return String(value ?? "")
        .toLowerCase()
        .replace(/['"`]/g, "")
        // Strip intent verbs and generic nouns so they don't score against app entries.
        // IMPORTANT: add new verbs here if users commonly prefix them (e.g. "show", "start").
        .replace(/\b(app|apps|application|applications|workbench|workspace|installed|open|launch|start|show|run|open|list|find|retrieve|get|url|href|the|all|to|for|and|its|me|please)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * There is deliberately no built-in app list here.
 *
 * One used to sit in this file: five workbenches with hardcoded hrefs, every one
 * marked "installed" for every organization. They were one organization's apps
 * (public slugs that resolve only for org 342), and "/app/it-ticketing" resolved
 * nowhere at all, so the Copilot offered apps the caller did not have and the
 * launcher answered "App not found or not published". What an organization has is
 * what list_installed_apps returns for it.
 */

const STOP_WORDS = new Set(["the", "and", "for", "you", "can", "our", "all", "its", "how", "what", "with", "this", "that", "please", "could", "would"]);

/**
 * The organization's apps, out of what list_installed_apps answered with.
 *
 * It returns `{ "items": [...] }`, or a plain sentence when the organization has
 * nothing. The caller used to accept a string starting with "[" and nothing else, so
 * the catalogue was ALWAYS empty - which is why a hardcoded list of one organization's
 * workbenches stood in for it, and why the Copilot offered apps that did not exist.
 */
export function parseAppCatalog(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
        const items = (raw as any).items;
        return Array.isArray(items) ? items : [];
    }
    if (typeof raw !== "string") return [];
    const text = raw.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return []; // "No installed apps ..."
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        return Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
        return [];
    }
}

export function selectAppForPresentation(message: string, catalog: any[]): any | null {
    const rawCandidates = Array.isArray(catalog) ? catalog : [];
    const candidates = rawCandidates.filter((item) => item?.availability === "installed" || item?.source === "blueprint");

    const query = normalizeAppSearchText(message);
    // Nothing installed means nothing to open, and the caller says so rather than
    // offering a link that cannot resolve.
    if (!query) return candidates[0] ?? null;

    const queryTokens = new Set(query.split(/\s+/).filter((t) => t.length > 0 && !STOP_WORDS.has(t)));
    let best: { item: any; score: number } | null = null;

    for (const item of candidates) {
        const title = normalizeAppSearchText(item?.title);
        const slug = normalizeAppSearchText(item?.slug);
        const description = normalizeAppSearchText(item?.description);
        let score = 0;

        if (title && query.includes(title)) score += 20;
        if (slug && query.includes(slug)) score += 16;
        if (title && title.includes(query)) score += 12;
        if (slug && slug.includes(query)) score += 8;

        for (const token of queryTokens) {
            if (STOP_WORDS.has(token)) continue;
            // Match exact word or substring in title, slug, or description. A short
            // token only counts as a whole word: "it" is a substring of "suite",
            // "quality" and "monitoring", so "open the it ticketing app" scored
            // against every app and returned an unrelated one.
            const wholeWordOnly = token.length < 4;
            const hasWord = (text: string) => text.split(/[\s-]+/).includes(token);
            if (hasWord(title)) score += 6;
            else if (!wholeWordOnly && title.includes(token)) score += 4;
            if (wholeWordOnly ? hasWord(slug) : slug.includes(token)) score += 3;
            if (wholeWordOnly ? hasWord(description) : description.includes(token)) score += 2;

            // Extra domain keyword boosts
            if ((token === 'rfc' || token === 'research') && (slug.includes('research') || title.includes('research') || title.includes('rfc'))) score += 10;
            if ((token === 'sdlc' || token === 'code') && (slug.includes('sdlc') || title.includes('sdlc'))) score += 10;
            if ((token === 'ops' || token === 'telemetry') && (slug.includes('ops') || title.includes('ops'))) score += 10;
            if ((token === 'ticket' || token === 'bug') && (slug.includes('ticket') || title.includes('ticket'))) score += 10;
        }

        if (!best || score > best.score) {
            best = { item, score };
        }
    }

    // No match means no match: answering with whichever app happened to be first
    // sends someone to an unrelated workbench. The caller lists what is installed.
    return best && best.score > 0 ? best.item : null;
}

// Provider-specific profiles for system instructions
// Profiles and Generic Prompts now imported from ../prompts/agent-prompts

// Caches are now backed by Redis via embed-profile-cache.ts — see @domain/auth/core/embed-profile-cache.js

// Types for the chat interface
export interface AgentChatContext {
    currentUrl?: string;
    subPage?: {
        key?: string;
        label?: string;
        pathname?: string;
        section?: string;
        tab?: string;
        entityType?: string;
        entityId?: string;
    };
    selectedText?: string;
    dom?: string;
    jobId?: number;
    jobConfig?: any;
    branding?: any;
    files?: any[];
    history?: any[];
    sessionId?: string; // For tracking authenticated sessions in public chat
    mode?: CopilotMode | "planning";
    audience?: "business" | "operator" | "developer" | string;
    confirmedExecution?: boolean;
    provenanceHint?: CopilotEvidenceItem[];
    missionId?: number;
    profile?: object; // Embed personalization: customer/session data from external API
    allowedToolsOverride?: string[]; // Deployment-level tools to add (e.g. http_request for embed)
    fingerprint?: string; // Pulse activity fingerprint
    nlp_summary?: string; // Pulse context summary
    pipelineExecution?: {
        nonce: string;
        inputData: Record<string, any>;
    };
    screenContext?: {
        currentRoute?: string;
        page?: string;
        subPage?: AgentChatContext["subPage"];
    };
    [key: string]: any;
}

// Does the message ask to file/submit/fill an intake-style form (bug report,
// ticket, request, feedback, …)? Kept deliberately broad — the intake fast-path
// only acts when it ALSO finds a matching form_agent job, so a false positive
// with no matching form simply falls through to normal processing.
function isIntakeFormRequest(message: string): boolean {
    const text = message.trim();
    if (!text) return false;
    return (
        /\b(file|submit|fill(?:\s+out)?|log|raise|report|create|open|start|make|lodge|register)\b[^.!?\n]*\b(bug|defect|issue|ticket|report|request|form|intake|complaint|feedback|incident)\b/i.test(text) ||
        /\b(bug|defect|issue|incident)\s+report\b/i.test(text)
    );
}

// A form_agent job (type='form_agent') stores its interactive form under
// config.formSchema. Map fields onto the assistant_form contract the chat sheet
// renders. Types line up with render_intake_form's supported set.
const INTAKE_FIELD_TYPES = new Set(["text", "number", "textarea", "markdown", "select", "radio", "rating", "boolean", "location", "geo"]);
function mapIntakeFieldType(type: unknown): string {
    return typeof type === "string" && INTAKE_FIELD_TYPES.has(type) ? type : "text";
}

function deriveFormTitle(name: string): string {
    const cleaned = String(name || "")
        .replace(/form agent/i, "")
        .replace(/template/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) return "Intake form";
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Find the org's best-matching active form_agent job for the request and build
// its assistant_form payload from the stored schema. Requires at least one
// keyword overlap so we never render an unrelated form.
async function resolveFormAgentForm(
    message: string,
    organizationId: number,
): Promise<{ jobId: number; title: string; payload: any } | null> {
    let rows: any[] = [];
    try {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        const cacheKey = `oddjob:form_agents:org:${organizationId}`;
        const cached = await redis.get(cacheKey).catch(() => null);
        if (cached) {
            rows = JSON.parse(cached);
        } else {
            const { pool } = await import("@server/database_service.js");
            const res = await pool.query(
                `select id, name, config from jobs
                 where organization_id = $1 and type = 'form_agent' and (is_active is null or is_active = true)`,
                [organizationId],
            );
            rows = res.rows || [];
            if (rows.length > 0) {
                await redis.set(cacheKey, JSON.stringify(rows), "EX", 900).catch(() => {});
            }
        }
    } catch {
        const { pool } = await import("@server/database_service.js");
        const res = await pool.query(
            `select id, name, config from jobs
             where organization_id = $1 and type = 'form_agent' and (is_active is null or is_active = true)`,
            [organizationId],
        );
        rows = res.rows || [];
    }
    if (rows.length === 0) return null;

    const lower = message.toLowerCase();
    const tokens = new Set((lower.match(/[a-z]{3,}/g) || []).filter((t) => !["the", "and", "for", "want", "please", "form", "report", "file", "submit", "create", "open"].includes(t)));
    const score = (name: string): number => {
        const n = String(name || "").toLowerCase();
        let s = 0;
        for (const t of tokens) if (n.includes(t)) s += 1;
        if (/\bbug\b/.test(lower) && /bug/.test(n)) s += 3;
        return s;
    };

    let best: any = null;
    let bestScore = 0;
    for (const r of rows) {
        const s = score(r.name || "");
        if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best || bestScore < 1) return null; // no confident match → defer

    const schema = best.config?.formSchema;
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    if (fields.length === 0) return null;

    const title = deriveFormTitle(best.name);
    const payload = {
        type: "assistant_form",
        title,
        description: "Fill in the fields below and submit — this uses the existing form.",
        submitLabel: "Submit",
        schema: {
            fields: fields.map((f: any) => ({
                key: f.key,
                label: f.label ?? f.key,
                type: mapIntakeFieldType(f.type),
                required: f.required ?? false,
                ...(Array.isArray(f.options) ? { options: f.options } : {}),
                ...(f.defaultValue != null ? { defaultValue: f.defaultValue } : {}),
            })),
        },
        // Carried so a future submit handler can route the data back to this
        // form's pipeline instead of only echoing it into the chat.
        context: { formJobId: best.id, formName: best.name },
    };
    return { jobId: best.id, title, payload };
}

export const agentService = {
    /**
     * Parse and cache uploaded files for agent context
     */
    async processUploadedFiles(files: Express.Multer.File[]) {
        const uploadedFiles = [];

        for (const file of files) {
            // Explicitly capped. The parser no longer truncates by default —
            // attachments keep their full text — but this path caches parsed
            // content in Redis for a chat turn, where an unbounded document is a
            // memory problem rather than a feature.
            const parsed = await FileParser.parse(file.buffer, file.mimetype, file.originalname, {
                maxTextLength: 10000,
            });
            const fileId = randomUUID();

            await setFileCache(fileId, {
                content: parsed.content,
                type: parsed.type,
                summary: parsed.summary || "",
                metadata: parsed.metadata,
            });

            uploadedFiles.push({
                id: fileId,
                name: file.originalname,
                type: parsed.type,
                size: file.size,
                preview: parsed.summary?.slice(0, 200) + "..."
            });
        }
        return uploadedFiles;
    },

    /**
     * Main Chat Interface
     */
    async chat(input: {
        message: string;
        context?: AgentChatContext;
        attachments?: any[];
        userContext: {
            organizationId: number | null;
            userId: string;
            isAdmin: boolean;
            isSuperAdmin: boolean;
            isOrgAdmin: boolean;
            allowedTopicIds?: number[] | null;
            allowedDatasetIds?: number[] | null;
            allowedPipelineIds?: number[] | null;
            permissions?: string[];
        };
        /**
         * Optional streaming sink (SSE transport). When provided, the service
         * emits `status` events during the agent loop, a `final` event with the
         * answer as soon as it is ready (before the blocking DB writes), and a
         * `meta` event carrying the persisted messageId. Non-streaming callers
         * omit it and receive only the returned object — behaviour is identical.
         */
        onEvent?: (evt: { type: "status" | "token" | "final" | "meta"; data?: any }) => void;
    }) {
        let { message, context: clientContext, attachments, userContext, onEvent } = input;

        // Immediate initial progress emit for streaming clients
        onEvent?.({ type: "status", data: { phase: "planning", label: "Analyzing request…" } });

        // Predict user intent dynamically using CopilotIntentPredictor (PredictionEngine + GoodQuestionEngine)
        const intentResult = copilotIntentPredictor.predictIntent(message, {
            page: clientContext?.page,
            currentUrl: clientContext?.currentUrl,
            jobId: clientContext?.jobId,
            cycleId: clientContext?.cycleId,
            missionId: clientContext?.missionId,
            confirmedExecution: clientContext?.confirmedExecution,
        });

        const copilotMode = clientContext?.mode
            ? normalizeCopilotMode(clientContext.mode)
            : intentResult.suggestedMode;
        clientContext = { ...(clientContext || {}), mode: copilotMode };

        // --- Fast-path: Daily Brief ---
        // Instantly aggregate real platform metrics without slow LLM tool loops or quota failures
        if (!clientContext?.jobId && intentResult.intent === "daily_brief") {
            try {
                const orgId = userContext.organizationId ? Number(userContext.organizationId) : null;
                const brief = await dailyBriefService.getDailyBrief({
                    isSuperAdmin: !!userContext.isSuperAdmin,
                    organizationId: orgId,
                });
                const sessionId = clientContext?.sessionId;
                const userId = userContext.userId || 'anonymous';
                this.saveMessage(undefined, userId, 'user', message, { context: clientContext }, sessionId).catch(() => {});
                this.saveMessage(undefined, userId, 'assistant', brief.markdown, { generatedAt: brief.generatedAt }, sessionId).catch(() => {});

                return {
                    response: brief.markdown,
                    metadata: {
                        mode: copilotMode,
                        dryRun: true,
                        evidence: deriveEvidence(clientContext, "DAILY_BRIEF", clientContext?.missionId),
                        generatedAt: brief.generatedAt,
                        intent: intentResult.intent,
                        confidence: intentResult.confidence,
                    },
                };
            } catch (err: any) {
                logger.error("[Agent FastPath] Daily brief generation failed:", err);
            }
        }

        // --- Intent Disambiguation: Good Question Engine (GQE) ---
        // When query is ambiguous or conflicting, present Socratic interactive choices
        if (!clientContext?.jobId && intentResult.intent === "clarification_needed" && intentResult.clarification) {
            const clarification = intentResult.clarification;
            const payload = {
                type: "intent_clarification",
                questionId: clarification.questionId,
                headline: clarification.headline,
                question: clarification.question,
                options: clarification.options,
                structuredPayload: clarification.structuredPayload,
            };
            const sessionId = clientContext?.sessionId;
            const userId = userContext.userId || 'anonymous';
            this.saveMessage(undefined, userId, 'user', message, { context: clientContext }, sessionId).catch(() => {});
            this.saveMessage(undefined, userId, 'assistant', JSON.stringify(payload), { clarification }, sessionId).catch(() => {});

            return {
                response: JSON.stringify(payload),
                metadata: {
                    mode: copilotMode,
                    dryRun: true,
                    evidence: deriveEvidence(clientContext, "INTENT_CLARIFICATION", clientContext?.missionId),
                    intent: intentResult.intent,
                    confidence: intentResult.confidence,
                    clarification,
                },
            };
        }

        // --- Conversational Fast-Track (Optimized for Speed) ---
        // Fast-path routing lives in chat-intent.ts (single source of truth, unit-tested).
        const isGreeting = isGreetingMessage(message);

        if (isGreeting) {
            const greetings = [
                "Hello! How can I help you today?",
                "Hey there! Ready to get to work.",
                "Hi! What's on your mind?",
                "Hello! I'm here and ready to assist.",
                "Greetings! How can I be of service?",
                "Hi! Always a pleasure. What can I do for you?"
            ];
            
            const thanksResponses = [
                "You're very welcome!",
                "Happy to help!",
                "Anytime! Let me know if you need anything else.",
                "Glad I could assist.",
                "No problem at all!"
            ];

            const acknowledgementResponses = [
                "Got it. What's next?",
                "Understood. Ready for your next instruction.",
                "Copy that. How should we proceed?",
                "Acknowledged. I'm standing by."
            ];

            const lower = message.toLowerCase();
            let response = greetings[Math.floor(Math.random() * greetings.length)];
            
            if (lower.includes("thank")) response = thanksResponses[Math.floor(Math.random() * thanksResponses.length)];
            else if (lower.match(/^(ok|okay|got it|understood|acknowledged)/)) response = acknowledgementResponses[Math.floor(Math.random() * acknowledgementResponses.length)];

            // Fire-and-forget saving to history to avoid blocking the response
            const sessionId = clientContext?.sessionId;
            const userId = userContext.userId || 'anonymous';
            const jobId = clientContext?.jobId;
            
            this.saveMessage(jobId, userId, 'user', message, { context: clientContext }, sessionId).catch(() => {});
            this.saveMessage(jobId, userId, 'assistant', response, {}, sessionId).catch(() => {});

            return {
                response,
                metadata: {
                    mode: copilotMode,
                    dryRun: copilotMode !== "execute",
                    evidence: deriveEvidence(clientContext, "CONVERSATIONAL", clientContext?.missionId),
                },
            };
        }

        if (
            (copilotMode === "execute" || intentResult.requiresConfirmation) &&
            clientContext?.confirmedExecution !== true &&
            !isReadOnlyAppPresentationRequest(message)
        ) {
            return {
                response: "I detected a live action request that will modify system state. Review the action preview below and confirm when you are ready to execute.",
                metadata: {
                    mode: "execute",
                    dryRun: true,
                    actionPreview: intentResult.actionPreview || buildActionPreview(message, clientContext),
                    evidence: deriveEvidence(clientContext, "EXECUTION_PREVIEW", clientContext?.missionId),
                    intent: intentResult.intent,
                    confidence: intentResult.confidence,
                },
            };
        }

        // --- Governor Check (Hierarchical Resolution) ---
        let governorConfig: GovernanceResolved = { enabled: false, mode: 'OFF', rules: [], source: 'none' };
        let jobConfig: any = clientContext?.jobConfig || null;
        const isConversational = false; // reserved for future lightweight conversational mode

        if (!isConversational) {
            try {
                // Check if governor module exists before importing
                const { governorResolver } = await import("@domain/governor/index.js");
                if (governorResolver && typeof governorResolver.resolveGovernance === 'function') {
                    governorConfig = await governorResolver.resolveGovernance({
                        jobId: clientContext?.jobId,
                        pipelineId: (clientContext?.jobConfig as any)?.pipelineId, 
                        jobConfig: jobConfig || clientContext?.jobConfig
                    });

                    if (governorConfig.enabled && clientContext?.sessionId) {
                        console.log(`[Governor] Active in ${governorConfig.mode} mode for session ${clientContext.sessionId}`);
                        const producer = new MoltProducer(clientContext.sessionId);
                        await producer.publish('OBSERVATION', {
                            role: 'user',
                            content: message,
                            attachments: attachments?.map(a => a.name)
                        }).catch(err => console.error("[Governor] Publish failed:", err));
                    }
                }
            } catch (err) {
                console.error("[Governor] Failed to resolve governance (non-fatal):", err);
            }
        }
        // -------------------------------------------------

        // Ensure permissions array exists
        if (!userContext.permissions) {
            userContext.permissions = [];
        }

        // If user is admin or super admin, grant default SaaS permissions for now
        // This ensures the internal Agent AI can use the tools immediately
        if (userContext.isAdmin || userContext.isSuperAdmin) {
            const defaultPerms = ["saas:read", "saas:write", "pipeline:read", "pipeline:execute", "knowledge:read", "knowledge:write", "document:read", "dataset:read", "template:read"] as McpPermission[];
            for (const p of defaultPerms) {
                if (!(userContext.permissions as string[]).includes(p)) {
                    (userContext.permissions as string[]).push(p);
                }
            }
        }

        // FAST PATH: Handle simple queries directly without LLM to avoid hallucinations
        const lowerMessage = message.toLowerCase().trim();
        if (lowerMessage.includes('how many jobs') || lowerMessage === 'job count' || lowerMessage === 'count jobs') {
            try {
                const { pool } = await import('@server/database_service.js');
                let query = 'SELECT COUNT(*) as count FROM jobs';
                const params: any[] = [];

                // Filter by org unless super admin
                if (!userContext.isSuperAdmin && userContext.organizationId) {
                    query += ' WHERE organization_id = $1';
                    params.push(userContext.organizationId);
                }

                const result = await pool.query(query, params);
                const count = result.rows[0]?.count || 0;
                return {
                    response: `There are **${count} jobs** in the system.`,
                    metadata: {
                        mode: copilotMode,
                        dryRun: true,
                        evidence: [
                            { label: "Jobs", source: "jobs table count" },
                        ],
                    },
                };
            } catch (e: any) {
                console.error('[Agent FastPath] Job count failed:', e);
                // Fall through to normal processing
            }
        }

        if (!clientContext?.jobId && isReadOnlyAppPresentationRequest(message)) {
            try {
                logger.info(`[Agent FastPath] Resolving app presentation request without agent loop: "${message.slice(0, 120)}"`);
                const { APP_FORGE_TOOLS } = await import("../tools/v1/capabilities/app-forge-tools.js");
                const { RENDER_TOOLS } = await import("../tools/v1/capabilities/render-tools.js");
                const toolContext = {
                    organizationId: assertOrgId(userContext.organizationId),
                    userId: userContext.userId,
                    isAdmin: userContext.isAdmin,
                    isSuperAdmin: userContext.isSuperAdmin,
                    isOrgAdmin: userContext.isOrgAdmin,
                    named: {},
                    positional: {},
                };

                const catalogRaw = await APP_FORGE_TOOLS.list_installed_apps.execute({}, toolContext);
                const catalog = parseAppCatalog(catalogRaw);

                const selectedApp = selectAppForPresentation(message, catalog);
                const evidence = deriveEvidence(clientContext, "APP_CATALOG", clientContext?.missionId);

                if (!selectedApp) {
                    const availableNames = catalog
                        .filter((a: any) => a?.availability === "installed")
                        .map((a: any) => a?.title)
                        .filter(Boolean)
                        .slice(0, 8)
                        .join(", ");
                    const suggestion = availableNames
                        ? `Available apps: ${availableNames}.`
                        : "No apps are currently installed for this organization.";
                    return {
                        response: `I couldn't find an installed app matching that name. ${suggestion}`,
                        metadata: {
                            mode: copilotMode,
                            dryRun: true,
                            evidence,
                            appCatalogCount: catalog.length,
                        },
                    };
                }

                const rendered = await RENDER_TOOLS.render_app_surface.execute({
                    title: selectedApp.title,
                    description: selectedApp.description || `Open ${selectedApp.title}`,
                    source: selectedApp.source,
                    slug: selectedApp.slug,
                    href: selectedApp.href,
                    mode: "embed",
                    actionLabel: selectedApp.actionLabel,
                    blueprint: selectedApp.blueprint,
                    cycleSlug: selectedApp.cycleSlug,
                    cycleName: selectedApp.cycleName,
                    routePath: selectedApp.routePath,
                    sourceAppId: selectedApp.sourceAppId,
                    sourceAppName: selectedApp.sourceAppName,
                }, toolContext);

                return {
                    response: rendered,
                    metadata: {
                        mode: copilotMode,
                        dryRun: true,
                        evidence,
                        appCatalogCount: catalog.length,
                        selectedApp: {
                            title: selectedApp.title,
                            slug: selectedApp.slug,
                            href: selectedApp.href,
                            source: selectedApp.source,
                            blueprint: selectedApp.blueprint,
                            cycleSlug: selectedApp.cycleSlug,
                            cycleName: selectedApp.cycleName,
                            routePath: selectedApp.routePath,
                        },
                    },
                };
            } catch (e: any) {
                logger.error("[Agent FastPath] App presentation failed:", e);
                // Fall through to normal processing so the user still gets a response.
            }
        }

        // Intake-form fast-path: when the user wants to file/submit something that an
        // existing form_agent job already defines a schema for (e.g. "I want to file a
        // bug report"), render THAT form deterministically. Without this the LLM tends
        // to describe the fields in prose or wander into mission-proposal instead of
        // loading the real form (the reported "bug report form won't load" symptom).
        // Only fires when a matching form_agent is found; otherwise falls through.
        if (!clientContext?.jobId && isIntakeFormRequest(message)) {
            try {
                const orgId = assertOrgId(userContext.organizationId);
                const form = await resolveFormAgentForm(message, orgId);
                if (form) {
                    logger.info(`[Agent FastPath] Rendering existing intake form "${form.title}" (job ${form.jobId}) without agent loop.`);
                    return {
                        response: JSON.stringify(form.payload),
                        metadata: {
                            mode: copilotMode,
                            dryRun: true,
                            evidence: deriveEvidence(clientContext, "INTAKE_FORM", clientContext?.missionId),
                            formJobId: form.jobId,
                        },
                    };
                }
                const isBugReport = /\b(bug|defect|issue|ticket|report|incident|intake)\b/i.test(message);
                const governedMission = /\bmission\b/i.test(message);
                const payload = {
                    type: "assistant_form",
                    title: isBugReport ? "Submit Bug Report & Workstream Ticket" : governedMission ? "Governed Mission Plan" : "Intake & Submission Form",
                    description: isBugReport
                        ? "Provide issue details and steps to reproduce below. This submits directly to the engineering workstream."
                        : governedMission
                        ? "Provide the mission inputs needed to prepare a governed plan."
                        : "Provide the missing information needed to continue.",
                    submitLabel: isBugReport ? "Submit Bug Ticket" : "Continue",
                    schema: {
                        fields: isBugReport
                            ? [
                                { key: "summary", label: "Issue Summary / Title", type: "text", required: true },
                                { key: "workstream", label: "Target Workstream", type: "select", required: true, options: ["Frontend UI & Breakpoints", "Form Engine & HIL", "Agent Swarm & Crew Room", "Database & Schema", "Telemetry & Spatial Engine"] },
                                { key: "severity", label: "Severity Level", type: "select", required: true, options: ["Low", "Medium", "High", "Critical"] },
                                { key: "reproduction", label: "Reproduction Steps & Log Trace", type: "textarea", required: true },
                              ]
                            : governedMission
                            ? [
                                { key: "objective", label: "Objective", type: "textarea", required: true },
                                { key: "priority", label: "Priority", type: "select", required: true, options: ["Low", "Medium", "High", "Critical"] },
                                { key: "risks", label: "Risks or constraints", type: "textarea", required: false },
                                { key: "successCriteria", label: "Success criteria", type: "textarea", required: true },
                              ]
                            : [
                                { key: "objective", label: "What should happen?", type: "textarea", required: true },
                                { key: "context", label: "Relevant context", type: "textarea", required: false },
                                { key: "constraints", label: "Constraints", type: "textarea", required: false },
                              ],
                    },
                };
                logger.info("[Agent FastPath] Rendering requested inline assistant form without agent loop.");
                return {
                    response: JSON.stringify(payload),
                    metadata: {
                        mode: copilotMode,
                        dryRun: true,
                        evidence: deriveEvidence(clientContext, "ASSISTANT_FORM", clientContext?.missionId),
                    },
                };
                // No matching form and no explicit form-construction request: fall through.
            } catch (e: any) {
                logger.error("[Agent FastPath] Intake form resolution failed:", e);
            }
        }

        // Instant-app fast-path: an explicit "render X as an instant app" request is
        // resolved DETERMINISTICALLY here — we call render_instant_app directly instead
        // of entering the agent loop and hoping a (possibly weak/slow local) model picks
        // the tool. This makes instant apps render in <1s on ANY backend (cloud, local
        // Ollama, or Mock). Only fires for single-block requests with a resolvable block;
        // multi-block/"assemble" phrasing and unresolved names fall through to the loop.
        if (!clientContext?.jobId) {
            const requestedBlock = extractInstantAppRenderRequest(message);
            if (requestedBlock) {
                try {
                    const { INSTANT_APP_TOOLS } = await import("../tools/v1/capabilities/instant-app-tools.js");
                    const toolContext = {
                        organizationId: assertOrgId(userContext.organizationId),
                        userId: userContext.userId,
                        isAdmin: userContext.isAdmin,
                        isSuperAdmin: userContext.isSuperAdmin,
                        isOrgAdmin: userContext.isOrgAdmin,
                        named: {},
                        positional: {},
                    };
                    const rendered = await INSTANT_APP_TOOLS.render_instant_app.execute({ component: requestedBlock }, toolContext);
                    // Only short-circuit on a real render payload; the tool returns a plain
                    // string starting with "No renderable"/"Failed" when it can't resolve —
                    // in that case fall through so the model can help pick a block.
                    if (typeof rendered === "string" && rendered.trim().startsWith("{") && rendered.includes('"type":"instant_app"')) {
                        logger.info(`[Agent FastPath] Rendered instant app "${requestedBlock}" without agent loop.`);
                        return {
                            response: rendered,
                            metadata: {
                                mode: copilotMode,
                                dryRun: true,
                                evidence: deriveEvidence(clientContext, "INSTANT_APP", clientContext?.missionId),
                                instantApp: requestedBlock,
                            },
                        };
                    }
                    logger.info(`[Agent FastPath] Instant-app block "${requestedBlock}" not resolvable — falling through to agent loop.`);
                } catch (e: any) {
                    logger.error("[Agent FastPath] Instant-app render failed:", e);
                }
            }
        }

        // Instant-app DASHBOARD fast-path: "assemble/build a dashboard" or "instant
        // app with X and Y" composes multiple blocks deterministically via
        // assemble_instant_app — no agent loop. Uses named blocks when given, else a
        // curated theme preset (mission/pipeline/agent/knowledge/data/operations).
        // Unresolved presets (0 blocks) fall through to the loop.
        if (!clientContext?.jobId) {
            const assembleReq = extractInstantAppAssembleRequest(message);
            if (assembleReq) {
                try {
                    const { INSTANT_APP_TOOLS } = await import("../tools/v1/capabilities/instant-app-tools.js");
                    const toolContext = {
                        organizationId: assertOrgId(userContext.organizationId),
                        userId: userContext.userId,
                        isAdmin: userContext.isAdmin,
                        isSuperAdmin: userContext.isSuperAdmin,
                        isOrgAdmin: userContext.isOrgAdmin,
                        named: {},
                        positional: {},
                    };
                    const rendered = await INSTANT_APP_TOOLS.assemble_instant_app.execute({
                        title: assembleReq.title,
                        layout: assembleReq.layout,
                        blocks: assembleReq.blocks.map((component) => ({ component })),
                    }, toolContext);
                    if (typeof rendered === "string" && rendered.trim().startsWith("{") && rendered.includes('"type":"instant_app_surface"')) {
                        logger.info(`[Agent FastPath] Assembled instant-app dashboard "${assembleReq.title}" (${assembleReq.blocks.length} blocks requested) without agent loop.`);
                        return {
                            response: rendered,
                            metadata: {
                                mode: copilotMode,
                                dryRun: true,
                                evidence: deriveEvidence(clientContext, "INSTANT_APP", clientContext?.missionId),
                                instantAppDashboard: assembleReq.title,
                            },
                        };
                    }
                    logger.info(`[Agent FastPath] Dashboard "${assembleReq.title}" resolved no blocks — falling through to agent loop.`);
                } catch (e: any) {
                    logger.error("[Agent FastPath] Instant-app assemble failed:", e);
                }
            }
        }

        // Resolve AI Configuration using Unified Resolver
        const aiConfig = await systemAiService.getAiConfig('copilot', userContext.organizationId || undefined);
        const aiConfigWithFallback = await systemAiService.getAiConfigWithFallback('copilot', userContext.organizationId || undefined);

        // Default to Google if totally unconfigured
        let provider = aiConfig?.provider || "google";
        let model = aiConfig?.model || "gemini-2.0-flash";
        let apiKey = aiConfig?.apiKey || developmentProviderKey();
        let baseUrl = aiConfig?.baseUrl;

        // Robustness: if we have an API key from env but no provider, make sure they align
        if (!aiConfig && developmentProviderKey("openai") && !developmentProviderKey()) {
            provider = "openai";
            model = "gpt-4o";
            apiKey = developmentProviderKey("openai");
        }

        // Read maxIterations from systemSettings copilot config (copilot.maxIterations), fallback to 20
        let maxIterations = (aiConfig as any)?.maxIterations || 20;
        // The no-job "copilot" is a conversational assistant. A full 20-iteration tool
        // loop can take minutes per reply, so bound it to keep responses prompt.
        if (!clientContext?.jobId) {
            maxIterations = Math.min(maxIterations, 12);
        }

        let allowedTools = promptService.getTools(userContext.isAdmin);

        // Oddjob Copilot tool gating by mode. The copilot (no job-bound agent) runs
        // in explain/plan/execute/audit modes. In the read-only modes it should
        // answer from current context — NOT invoke slow web-scraping tools
        // (google_search / browse_web go through Selenium and hang for minutes on
        // Google bot-challenges) or side-effecting tools. That hang is why the
        // copilot appeared to "not respond". Only execute mode (user-confirmed in
        // the UI) keeps the full toolset.
        const COPILOT_READONLY_MODES = new Set(["explain", "plan", "audit"]);
        if (!clientContext?.jobId && clientContext?.mode && COPILOT_READONLY_MODES.has(clientContext.mode)) {
            const allowExplicitWebResearch = isExplicitExternalResearchRequest(message);
            const READONLY_COPILOT_TOOLS = new Set([
                "search_unified_knowledge", "search_documents", "list_documents",
                "get_document_details", "get_document_template", "search_knowledge_base",
                "search_knowledge_graph", "get_entity_details", "explore_relationships",
                "get_entity_impact", "get_graph_statistics", "list_jobs", "get_job_details",
                "list_pipelines", "resolve_intent_to_pipeline", "get_pipeline_details",
                "get_pipeline_status", "list_datasets", "query_dataset", "get_dataset_details",
                "list_saas_connectors", "get_saas_connector_schema", "search_platform_nodes",
                "query_platform_structure", "get_blackboard", "file_read", "file_list",
                "analyze_image", "list_blueprints",
                // The org's own architecture specs. Both are exact lookups against
                // xray_node_documentation, so they answer "how is X built?" without
                // depending on the vector store — which is what made this content
                // unreachable in the first place.
                "list_xray_specs", "get_xray_spec",
                "discover_capabilities", "discover_capability_proposals", "list_missions", "propose_mission", "propose_mission_synthesis", "propose_research_mission", "remember", "render_intake_form", "render_app_surface", "list_instant_app_components", "render_instant_app", "assemble_instant_app", "list_installed_apps",
                // Side-effect-free: only returns a mode_switch_request prompt asking
                // the user to move to Execute mode. Must stay available in read-only
                // modes so a write request can offer the Execute path instead of a
                // dead-end refusal (see WRITE_REQUEST_GUIDANCE).
                "request_execute_mode",
                "mount_signal_studio",
                ...(allowExplicitWebResearch ? ["google_search", "browse_web"] : []),
            ]);
            allowedTools = allowedTools.filter(t => READONLY_COPILOT_TOOLS.has(t));
        }
        // jobConfig is now declared above for governor context
        try {
            const fs = await import('fs');
            const logMsg = `[${new Date().toISOString()}] Agent Chat: jobId=${clientContext?.jobId}, hasJobConfig=${!!jobConfig}, jobConfigId=${jobConfig?.id}\n`;
            fs.promises.appendFile('agent_debug_service.log', logMsg).catch(() => { });
        } catch (e) { }

        console.log(`[Agent Service DEBUG] Incoming jobConfig:`, !!jobConfig);
        if (jobConfig) {
            console.log(`[Agent Service DEBUG] jobConfig details: id=${jobConfig.id}, allowedTools count=${jobConfig.allowedTools?.length}`);
            if (jobConfig.allowedTools) {
                console.log(`[Agent Service DEBUG] First 5 allowedTools:`, jobConfig.allowedTools.slice(0, 5));
            }
        }

        // If jobId is provided but config missing, try to load from DB
        if (clientContext?.jobId && !jobConfig) {
            try {
                const job = await db.query.jobs.findFirst({
                    where: eq(jobs.id, clientContext.jobId!)
                });

                if (job && (job.type === 'ai_agent' || job.type === 'agent_ai' || job.type === 'node_script')) {
                    jobConfig = job.config;
                    // Force organization context to the job's organization if not already set correctly
                    if (job.organizationId) {
                        userContext.organizationId = job.organizationId;
                    }

                    // Merge OCEAN personality from agent/app deployment if not already in config
                    if (!(jobConfig as any)?.oceanTraits) {
                        try {
                            const { agentDeployments } = await import("@shared/schema/agent-deployments.js");
                            const { appDeployments } = await import("@shared/schema/apps.js");

                            const [agentDep] = await db.select({
                                oceanTraits: agentDeployments.oceanTraits,
                                soulArchetype: agentDeployments.soulArchetype,
                            }).from(agentDeployments).where(eq(agentDeployments.jobId, clientContext.jobId!)).limit(1);

                            if (agentDep?.oceanTraits) {
                                jobConfig = { ...(jobConfig as any), oceanTraits: agentDep.oceanTraits, soulArchetype: agentDep.soulArchetype };
                            } else {
                                // Fall back to app deployment linked via job
                                const [appDep] = await db.select({
                                    oceanTraits: appDeployments.oceanTraits,
                                    soulArchetype: appDeployments.soulArchetype,
                                }).from(appDeployments).where(eq(appDeployments.expertiseJobId, clientContext.jobId!)).limit(1);

                                if (appDep?.oceanTraits) {
                                    jobConfig = { ...(jobConfig as any), oceanTraits: appDep.oceanTraits, soulArchetype: appDep.soulArchetype };
                                }
                            }
                        } catch (e) {
                            // Non-fatal — continue without personality
                        }
                    }
                }
            } catch (e) {
                console.error(`[Agent Service] Failed to load job config for jobId ${clientContext.jobId}:`, e);
            }
        }

        // --- Mission Resolution ---
        let missionId = clientContext?.missionId;
        if (!missionId && clientContext?.jobId) {
            try {
                const mission = await missionService.getMissionForEntity({
                    entityType: 'job',
                    entityId: clientContext.jobId
                });
                if (mission) missionId = mission.id;
            } catch (e) {
                console.warn("[Agent Service] Failed to resolve mission:", e);
            }
        }
        if (missionId) {
            if (!clientContext) clientContext = {};
            clientContext.missionId = missionId;
        }
        // ----------------------------

        // Apply Job Configuration if available (from Context or DB)
        if (jobConfig) {
            // Override allowed tools from job config
            const toolsToApply = jobConfig.allowedTools || jobConfig.rbac?.allowedTools;
            if (toolsToApply && toolsToApply.length > 0) {
                if (toolsToApply.includes("*")) {
                    allowedTools = promptService.getTools(true); // Get all admin tools
                } else {
                    allowedTools = toolsToApply;
                }

                // CRITICAL: Ensure essential pipeline tools are available if the user has permission
                const hasPipelineExecute = (userContext.permissions as string[]).includes("pipeline:execute");
                const hasPipelineRead = (userContext.permissions as string[]).includes("pipeline:read");
                if (hasPipelineExecute || hasPipelineRead) {
                    if (!allowedTools.includes("list_pipelines")) {
                        allowedTools = [...allowedTools, "list_pipelines"];
                    }
                    if (!allowedTools.includes("resolve_intent_to_pipeline")) {
                        allowedTools = [...allowedTools, "resolve_intent_to_pipeline"];
                    }
                    if (hasPipelineExecute) {
                        if (!allowedTools.includes("trigger_pipeline")) {
                            allowedTools = [...allowedTools, "trigger_pipeline"];
                        }
                        if (!allowedTools.includes("get_pipeline_status")) {
                            allowedTools = [...allowedTools, "get_pipeline_status"];
                        }
                    }
                }

                // CRITICAL: Ensure 'show_pipeline_input_form' is always available if not present
                if (!allowedTools.includes("show_pipeline_input_form")) {
                    allowedTools = [...allowedTools, "show_pipeline_input_form"];
                }
            }

            // Optional: Override provider/model if configured in job
            if (jobConfig.provider) {
                provider = jobConfig.provider;
            }

            if (jobConfig.model) {
                model = jobConfig.model;
                // Auto-fix provider mismatch if model is gemini but provider is not google
                if (model.toLowerCase().includes('gemini') && provider !== 'google') {
                    console.log(`[Agent Service] Auto-switching provider to 'google' for model '${model}'`);
                    provider = 'google';
                }
                // Auto-fix provider mismatch if model is gpt but provider is not openai
                if (model.toLowerCase().includes('gpt') && provider !== 'openai') {
                    console.log(`[Agent Service] Auto-switching provider to 'openai' for model '${model}'`);
                    provider = 'openai';
                }
            }

            // Merge restriction IDs from job config if not already set (e.g. by public deployment)
            const topicIds = jobConfig.topicIds || jobConfig.allowedTopicIds || jobConfig.rbac?.topicIds;
            const datasetIds = jobConfig.datasetIds || jobConfig.rbac?.datasetIds;
            const pipelineIds = jobConfig.pipelineIds || jobConfig.allowedPipelineIds || jobConfig.rbac?.pipelineIds;

            if (!userContext.allowedTopicIds && topicIds) userContext.allowedTopicIds = topicIds;
            if (!userContext.allowedDatasetIds && datasetIds) userContext.allowedDatasetIds = datasetIds;
            if (!userContext.allowedPipelineIds && pipelineIds) {
                userContext.allowedPipelineIds = pipelineIds;
            }
            console.log(`[Agent Service DEBUG] Final allowedTools after jobConfig merge:`, allowedTools.length);
        }

        try {
            const fs = await import('fs');
            const logMsg = `[${new Date().toISOString()}] Agent Chat: jobId=${clientContext?.jobId}, Final AllowedTools: ${JSON.stringify(allowedTools)}\n`;
            fs.promises.appendFile('agent_debug_service.log', logMsg).catch(() => { });
        } catch (e) { }

        // Merge deployment-level tool overrides (e.g. http_request for embed)
        if (clientContext?.allowedToolsOverride?.length) {
            for (const t of clientContext.allowedToolsOverride) {
                if (!allowedTools.includes(t)) allowedTools = [...allowedTools, t];
            }
        }

        // --- NEW: Derive MCP Permissions from Allowed Tools ---
        if (allowedTools && Array.isArray(allowedTools)) {
            for (const tool of allowedTools) {
                const required = toolPermissionMap[tool];
                if (required) {
                    for (const perm of required) {
                        if (!(userContext.permissions as string[]).includes(perm)) {
                            (userContext.permissions as string[]).push(perm);
                        }
                    }
                }
            }
        }
        // ------------------------------------------------------

        // --- Tool subsetting (copilot perf prototype) ---
        // Trim the model-facing toolset to CORE ∪ top-K tools relevant to THIS
        // message, for the copilot (no job-bound agent) only. MCP permissions were
        // already derived from the full set above; discover_capabilities stays in
        // CORE so the agent can JIT-recover anything the filter drops. Env-gated
        // (COPILOT_TOOL_SUBSETTING=false disables) for easy A/B.
        if (!clientContext?.jobId && process.env.COPILOT_TOOL_SUBSETTING !== "false") {
            try {
                const { subsetToolsForQuery } = await import("./core/tool-subsetting.service.js");
                const sub = await subsetToolsForQuery(message, allowedTools, { topK: 20, minCandidates: 25 });
                if (sub.applied) {
                    console.log(`[Agent Service] Tool subsetting: ${sub.before} → ${sub.after} tools for this turn.`);
                    allowedTools = sub.tools;
                }
                if (isExplicitExternalResearchRequest(message)) {
                    const configuredTools = promptService.getTools(userContext.isAdmin);
                    for (const webTool of ["google_search", "browse_web"]) {
                        if (configuredTools.includes(webTool) && !allowedTools.includes(webTool)) {
                            allowedTools.push(webTool);
                        }
                    }
                }
            } catch (err) {
                console.warn("[Agent Service] Tool subsetting skipped (non-fatal):", err);
            }
        }
        // ------------------------------------------------------


        // ---------------------------------------------------------
        // 2-6. Parallel Context Resolution
        // ---------------------------------------------------------
        let feedbackContext = "";
        let blackboardContext = "";

        if (!isConversational) {
            try {
                const [pulseSummary, warnings, missionDetail] = await Promise.all([
                    (clientContext && clientContext.fingerprint)
                        ? import("@domain/knowledge/core/pulse.service.js").then(({ pulseService }) => 
                            pulseService.summarizeRecentActivity(clientContext.fingerprint!))
                        : Promise.resolve(""),
                    criticService.getRelevantCritiques(message),
                    missionId ? missionService.getMissionDetail(missionId) : Promise.resolve(null)
                ]);

                if (pulseSummary && clientContext) {
                    clientContext.nlp_summary = (clientContext.nlp_summary || "") + "\n\n" + pulseSummary;
                }

                if (warnings && (warnings as any[]).length > 0) {
                    console.log(`[Agent Service] Injecting ${(warnings as any[]).length} past critiques into context.`);
                    feedbackContext = `\n\nCRITICAL HISTORICAL CONTEXT:\n${(warnings as any[]).join("\n")}\n\n`;
                }

                if (missionDetail && missionDetail.blackboard && Object.keys(missionDetail.blackboard as object).length > 0) {
                    blackboardContext = `\n\n=== MISSION SHARED BLACKBOARD ===\n(Shared memory with other agents in "${missionDetail.name}")\n${JSON.stringify(missionDetail.blackboard, null, 2)}\n===================================\n`;
                }
            } catch (err) {
                console.warn("[Agent Service] Non-critical context resolution failure:", err);
            }
        }

        const { prompt: generatedSystemPrompt, scope } = await promptService.buildSystemPrompt(clientContext, userContext, allowedTools, provider, model, baseUrl, jobConfig, message, isConversational);
        
        const systemIdentity = generatedSystemPrompt;
        const richUiContract = `

ASSISTANT RICH UI CONTRACT:
When a user would be better served by an interactive UI instead of prose, return exactly one JSON object, with no surrounding explanation.

To collect structured input inline in the assistant, return:
{
  "type": "assistant_form",
  "title": "Short form title",
  "description": "Why this input is needed",
  "submitLabel": "Continue",
  "schema": {
    "fields": [
      { "key": "objective", "type": "textarea", "label": "Objective", "required": true },
      { "key": "priority", "type": "select", "label": "Priority", "options": ["Low", "Medium", "High"] },
      { "key": "confirm", "type": "boolean", "label": "I confirm this is ready" }
    ]
  }
}
Supported assistant_form field types: text, number, textarea, markdown, select, radio, rating, boolean, location (interactive map picker with address search & GPS), and computed. A "computed" field is a live read-only output whose formula chains off other field keys (math + string + logic — e.g. formula: "round(bill * tipPercent / 100, 2)", format: "currency"), which makes real CALCULATORS possible — put input fields first, then computed outputs. Formula language: + - * / %, comparisons (== != > < >= <=), logic (&& || !), and functions round/floor/ceil/abs/min/max/sum/avg/clamp/pow/sqrt, upper/lower/title/trim/concat/left/right/contains/replace, if(cond,a,b)/coalesce(...). (You may also call the render_intake_form tool instead of returning this JSON.)

To present a published app or workspace, use this two-step process:
1. FIRST call list_installed_apps — it returns installed apps, active Agent AI deployments, advertised marketplace apps, AND blueprint templates for this org. Each item has an exact slug, source ('app' | 'agent_ai' | 'blueprint'), availability ('installed' | 'advertised' | 'template'), and href.
2. THEN call render_app_surface with title, description, source (from step 1), href (from step 1), slug (from step 1), and actionLabel.
   - Agent AI deployments use source='agent_ai' and open at /a/:slug.
   - App Forge workbench apps use source='app' and open at /app/:slug.
   - Blueprint templates use source='blueprint' and href='/armory/new?blueprint=<slug>'. Use actionLabel="Create <App Name>" to scaffold a new app from the template.
   - Cycle-backed core workbenches may open at their supported cycle route, e.g. /pipeline/sessions?embed=cycle&orgId=<orgId>; always use the href returned by list_installed_apps.
   - Cycle-backed apps belong to a specific blueprint and operational cycle. Preserve that relationship exactly; do not swap in a similarly named app or route from another blueprint or cycle.
   - Advertised marketplace apps are not launchable yet; use their href to open the App Arsenal install/configure page and label the action as View or Install.

APP DISAMBIGUATION RULE: If list_installed_apps returns a _disambiguationHint, two or more apps have similar or overlapping names. You MUST present an assistant_form with a radio or select field listing the candidate apps before calling render_app_surface. Never silently pick one when the intent is ambiguous.

CLARIFY VAGUE REQUESTS (question engine): Before building ANY UI (instant app, form, calculator, dashboard, app surface), judge whether the request is specified enough to build something the user will actually want. If you would have to GUESS the purpose, the subject/data, or the interaction — e.g. "build me an app", "make a dashboard" (of what?), "a calculator" (calculating what?), "show me the data" (which data?) — do NOT guess. Instead ask ONE crisp clarifying question, OR present a small assistant_form (radio/select) offering the 2–4 most likely interpretations, BEFORE rendering. Proceed without asking ONLY when a CREDIBLE default assumption exists (a clear, obvious choice); in that case STATE the assumption in one short line ("Assuming a mission dashboard — say the word to change it.") so the user can correct it. Ask the minimum needed: stop as soon as a credible assumption can be made, and never interrogate the user with more than one round of clarification when a reasonable default is available.

Do NOT guess or hardcode slugs or hrefs. If list_installed_apps returns no results, tell the user no apps are installed, advertised, or available as blueprints.
Use render_app_surface only when a dedicated app surface genuinely serves the user better than a plain answer.
For published-agent workflow input requests, you may also return the existing input_request shape with type, nonce, pipelineName, and fields.
When the person should fill in one of this organization's published forms, call share_published_form with its name: the form renders in the chat, and its answers go to the form rather than to you.
Use rich UI only when it clearly improves the user experience; otherwise answer normally.

INSTANT APPS (live, ephemeral in-chat UI blocks — distinct from published apps):
When the user asks to "render an instant app", asks "what instant apps can you render", or wants a live UI surface assembled on the fly to help with the current task, use the instant-app tools — NOT render_app_surface (that launches an already-published app):
1. Call list_instant_app_components to see the renderable blocks, each block's KIND, and its prop interface.
2. Call render_instant_app with the chosen block name and props matching its interface. Many blocks are self-wiring (they fetch their own data) and need no props. The block renders live in the chat immediately.
3. When the task needs SEVERAL blocks together, call assemble_instant_app with a blocks array to compose them into one surface, instead of multiple render_instant_app calls.

BUILDING EXCEPTIONAL INSTANT APPS — plan the app first, then compose. Follow this playbook every time:

STEP 1 — IDENTIFY THE PATTERN from the user's goal, then use the matching blocks:
   • Live dashboard (monitor several areas at once) → assemble_instant_app with 2–4 self-wiring "Platform *" DISPLAY blocks. Curated themes compose automatically: "mission / pipeline / agent / data / operations dashboard".
   • Single data view (one resource in depth) → ONE self-wiring block (e.g. Platform Missions Table, Platform Dataset Table, Platform Pipeline Status).
   • Intake / form / CALCULATOR / LOCATION PICKER / LIVE DATA APPS (the user TYPES values, SELECTS a place/coordinates, or requests on-the-fly tools like weather apps or financial converters) → the render_intake_form tool. It supports "number" inputs, "location" inputs (with interactive map and address autocomplete), "query" fields that connect to live external APIs via Oddjob's secure HTTP connector (e.g. url: "https://api.open-meteo.com/v1/forecast", params: { latitude: "{{latitude}}", longitude: "{{longitude}}", current_weather: "true" }, jsonPath: "current_weather.temperature", unit: "°C"), and "computed" fields whose formula evaluates LIVE as the user types (field chaining), so REAL calculators and live weather/finance tools work — e.g. a tip calculator = number fields bill + tipPercent, then computed fields tip:{formula:"round(bill*tipPercent/100,2)",format:"currency"} and total:{formula:"round(bill+tip,2)",format:"currency"}. Formulas support math, comparisons, &&/||, and functions (round/min/max/sum/if/concat/upper/…). This is the primary path that captures typed input, queries live APIs, AND computes.
   • Action console (run / trigger / approve) → kind=action blocks (Platform Job Runner, Platform Pipeline Trigger, Human-in-the-Loop Approval).
   • KPIs / already-known numbers → Metric Grid with ≤ 4 SHORT-labeled metrics.
   • Landing / marketing → content blocks (Hero Slider, Feature Grid, Pricing Table).

STEP 2 — MATCH BLOCK KIND TO INTERACTION. Every block from list_instant_app_components has a kind: input | action | display | chat | content. NEVER use a display block (Metric Grid, table, timeline) for an input task — it cannot accept typed values, run a button, or calculate, and renders a dead UI of zeros (the classic "tip calculator shown as a Metric Grid" mistake). If the user will TYPE anything, use kind=input.

STEP 3 — MAKE IT EXCEPTIONAL, not just present:
   • Purposeful — lead with the single most useful block; add another only if it earns its place. One focused block usually beats four.
   • Populated — every tile must show REAL content. Prefer self-wiring blocks with live data; DROP any block that would render empty/zero in this context rather than shipping a blank tile.
   • Readable — the surface is a NARROW (~360px) single column. Use short human labels ("Bill", "Tip %", "Total", not "TIP PERCENTAGE AMOUNT"); give sensible defaults; avoid very wide tables when a compact block conveys the same.
   • Coherent — every block on one surface should serve the same task.

STEP 4 — BE HONEST. Only claim controls the chosen blocks actually have. Calculators and forms with live math ARE achievable via render_intake_form computed fields. But if the ideal app truly isn't achievable from these blocks (persisting data across sessions, bespoke multi-step workflows, external integrations), say so plainly, render the CLOSEST real thing, and offer to build a full app via App Forge — never fake it with a display block and describe buttons/fields that don't exist.

STEP 5 — SELF-CHECK BEFORE RENDERING. Confirm all four: (a) the block KIND matches what the user will DO (view / enter / act); (b) every tile will show real content, not zeros/empty; (c) labels are short enough for a ~360px column; (d) you are describing only controls that actually exist. If any is "no", pick a different block or state the limitation instead of rendering.

CRITICAL — NEVER FABRICATE JOB OR PIPELINE IDs:
Before triggering any pipeline, job, or agent action that requires a numeric job ID or pipeline ID, you MUST first call list_jobs or list_pipelines to resolve the real ID.
Never guess, hardcode, or invent a numeric ID (e.g., 123456789). If no matching job or pipeline is found after calling the list tool, tell the user clearly and stop — do not attempt execution with a fabricated ID. Fabricated IDs will fail and waste the user's approval.
`;

        const systemPromptAddition = feedbackContext + blackboardContext + richUiContract;

        const isOllama = provider.includes("ollama") ||
            provider === "local" ||
            model.includes("qwen") ||
            model.includes("llama") ||
            baseUrl?.includes("11434");

        if (isOllama) {
            console.log(`[Agent Service] Detected Ollama environment (Provider: ${provider}, Model: ${model}). Using optimized JSON profile.`);
        }

        // Prepare context from attachments
        let attachmentContext = "";
        const configAttachments: any[] = [];

        if (attachments && Array.isArray(attachments)) {
            for (const att of attachments) {
                const fileData = await getFileCache(att.id);
                if (fileData) {
                    if (fileData.type === "image") {
                        // Pass to multi-modal LLM if it's an image
                        const base64Data = fileData.content.startsWith("data:") 
                            ? fileData.content 
                            : `data:${fileData.metadata?.mimeType || 'image/jpeg'};base64,${fileData.content}`;
                        
                        configAttachments.push({
                            type: 'image_url',
                            url: base64Data,
                            detail: 'auto'
                        });
                        
                        attachmentContext += `\n[Attached Image: ${att.name || "Image"}] (Image data attached for vision analysis)\n`;
                    } else {
                        const contentStr = typeof fileData.content === 'object'
                            ? JSON.stringify(fileData.content, null, 2)
                            : fileData.content;

                        const truncatedContent = contentStr.length > 20000
                            ? contentStr.slice(0, 20000) + "\n...(truncated)..."
                            : contentStr;

                        attachmentContext += `\n\n=== ATTACHMENT: ${att.name || "File"} ===\n${fileData.summary}\nFull Content:\n${truncatedContent}\n================================\n`;
                    }
                }
            }
        }

        const config = {
            provider: provider,
            model: model,
            temperature: jobConfig?.temperature ?? 0.7,
            systemIdentity,
            systemPromptAddition,
            requestType: isOllama ? "json" : undefined,
            useCache: false,
            attachments: configAttachments,
        };

        const fullMessage = message + (attachmentContext ? `\n\n--- Context from Attachments ---${attachmentContext}` : "");

        // Initialize AI Client (with Multi-Model Fallback when configured)
        let aiClient = AIClientFactory.getClient({ provider, baseUrl } as any);
        if (aiConfigWithFallback?.fallbacks?.length) {
            aiClient = new FallbackAIClient(aiClient, aiConfigWithFallback.fallbacks);
        }

        // Retrieve or initialize chat history (Redis-backed)
        // Key on sessionId to isolate sessions/agents; fall back to userId for legacy requests
        const historyKey = clientContext?.sessionId || userContext.userId;
        let existingHistory = await getChatHistory(historyKey);

        // Prefer explicit history from client (works even without Redis)
        if (clientContext?.history && Array.isArray(clientContext.history) && clientContext.history.length > 0) {
            existingHistory = clientContext.history.map((h: any) => ({
                type: h.role === 'user' ? 'user' : 'system',
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.content
            }));
        }

        // Add user message to history
        const userMsg = { type: "user", content: fullMessage, role: "user" };

        // Limit history context (last 10 messages)
        const recentHistory = existingHistory.slice(-10);

        const initialContext = {
            ...userContext,
            jobId: clientContext?.jobId,
            sessionId: clientContext?.sessionId,
            screenContext: clientContext,
            screenHint: promptService.getScreenHint(clientContext?.currentUrl),
            mode: copilotMode,
            audience: clientContext?.audience,
            extra: clientContext,
            // Bridge orchestrator progress → SSE sink (best-effort; undefined when
            // the caller isn't streaming).
            onStatus: onEvent ? (status: any) => onEvent({ type: "status", data: status }) : undefined,
        };

        const isPlanningMode = copilotMode !== 'execute';
        const orgId = assertOrgId(initialContext.organizationId);

        // This used to also append to an `agent_debug_service.log` beside the
        // process cwd on every chat, duplicating what the logger already has.
        // The same pattern in SkillManager.pruneTools was removed with it.
        logger.info(
            `Starting agent loop — mode=${initialContext.mode}, org=${orgId}, ` +
            `tools=${allowedTools.length}, datasetTools=${allowedTools.includes('list_datasets')}`
        );

        // Conversational fast-path: trivial greetings / identity / small-talk don't need
        // the multi-iteration tool loop (which can take minutes). Answer in one LLM call.
        // Routing lives in chat-intent.ts (single source of truth, unit-tested).
        const trimmedMessage = fullMessage.trim();
        const isTrivialChat = isTrivialChatMessage(trimmedMessage, { hasJob: !!clientContext?.jobId });

        let agentResult: any;
        if (isTrivialChat) {
            logger.info(`[Agent Service] Conversational fast-path (bypassing agent loop) for: "${trimmedMessage.slice(0, 40)}"`);
            const historyText = recentHistory.map((h: any) => `${h.role}: ${h.content}`).join('\n');
            const fastPrompt = `You are Oddjob's in-app AI assistant — a concise, friendly copilot for an agentic automation platform (missions, pipelines, jobs, App Forge, knowledge graph). Answer the user directly and briefly. Do not invent specifics about their data.\n${historyText ? `Conversation so far:\n${historyText}\n` : ''}User: ${trimmedMessage}\nAssistant:`;
            // This fast-path is a single clean LLM call with no ReAct scaffolding,
            // so it can be streamed token-by-token for real first-token latency
            // when the caller is a streaming client. Non-streaming callers keep the
            // one-shot generateText path.
            const text = onEvent
                ? await systemAiService.streamText(fastPrompt, { temperature: 0.6, useCache: true }, (delta) => onEvent({ type: "token", data: { delta } }))
                : await systemAiService.generateText(fastPrompt, { temperature: 0.6, useCache: true });
            agentResult = {
                output: text || "Hi! I'm the Oddjob assistant. I can help you run missions, build and trigger pipelines, manage jobs, and explore your knowledge graph. What would you like to do?",
                history: [],
                usage: undefined,
            };
        } else {
            agentResult = await runAgentLoop(
                aiClient,
                config as any,
                fullMessage,
                allowedTools,
                maxIterations,
                apiKey,
                { ...initialContext, previousHistory: recentHistory, jobConfig, missionId },
                undefined, // traceContext
                isPlanningMode, // dryRun
                governorConfig,
                copilotMode === 'execute' ? "none" : (clientContext as any)?.supervisionLevel || "full"
            );
        }

        let response = agentResult.output;
        if (!clientContext?.jobId && /^Stopped after \d+ iterations\.?$/i.test(String(response || "").trim())) {
            const observations = Array.isArray(agentResult.history)
                ? agentResult.history.filter((step: any) => step?.type === "observation").slice(-3)
                : [];
            const hadToolErrors = observations.some((step: any) => /\berror\b/i.test(String(step?.content || "")));
            response = [
                "I couldn't complete this request within the tool-use limit.",
                hadToolErrors
                    ? "One or more tool calls failed or did not produce usable progress."
                    : "The agent repeated tool-selection steps without reaching a reliable final answer.",
                "Your request and available results were preserved. Retry with a narrower target, or ask me to render a form to collect the missing inputs.",
            ].join("\n\n");
            logger.warn("[Agent Service] Replaced raw iteration-limit output with a recoverable Copilot response", {
                historySteps: Array.isArray(agentResult.history) ? agentResult.history.length : 0,
                hadToolErrors,
            });
        }
        let messageId: number | undefined;

        // Assemble response metadata once so we can both stream it and return it.
        const responseMetadata = {
            mode: copilotMode,
            dryRun: isPlanningMode,
            scope,
            missionId,
            evidence: deriveEvidence(clientContext, scope, missionId),
            toolReceipts: (agentResult.history ?? []).flatMap((step: any) => step.type === 'observation' && step.metadata?.receipt ? [step.metadata.receipt] : []),
        };

        // Stream the final answer to a streaming client NOW — before the blocking
        // persistence/eval writes below — so first paint isn't delayed by DB I/O.
        // The persisted messageId (needed for feedback) follows in a `meta` event.
        if (onEvent) {
            onEvent({ type: "final", data: { response, scope, missionId, metadata: responseMetadata } });
        }

        // --- NEW: Save Agent Run Steps (Memory) ---
        const { persistAgentHistory } = await import("./core/persistence.js");
        await persistAgentHistory(agentResult.history, {
            jobId: clientContext?.jobId || null,
            userId: userContext.userId || 'anonymous',
            organizationId: userContext.organizationId,
            missionId: missionId || null
        });
        // ------------------------------------------

        // Capture a reusable skill from substantive, successful multi-tool sessions
        // (Hermes-style self-improvement) — for the conversational assistant too, not
        // just mission-bound agents. Fire-and-forget; distilled into
        // missionRetrospectives and reused via fetchRelevantExamples. Gated on real
        // execution + several tool calls to avoid capturing trivial or dry-run turns.
        try {
            const actionCount = Array.isArray(agentResult.history)
                ? agentResult.history.filter((h: any) => h?.type === 'action').length
                : 0;
            if (copilotMode === 'execute' && !isPlanningMode && actionCount >= 3 && userContext.organizationId) {
                import("./core/persistence.js").then(({ saveSuccessfulPlanAsSkill }) => {
                    saveSuccessfulPlanAsSkill(agentResult.history, {
                        missionId: missionId ?? null,
                        organizationId: userContext.organizationId as number,
                        goal: message,
                    }).catch(() => { });
                });
            }
        } catch { /* non-fatal: skill capture is best-effort */ }

        // Log AI usage for cost tracking
        if (agentResult.usage) {
            try {
                const { analyticsService } = await import("@domain/admin/core/analytics.service.js");
                const usage = agentResult.usage as any;
                await analyticsService.logAIUsage({
                    userId: userContext.userId || 'anonymous',
                    provider: provider,
                    model: model,
                    promptTokens: usage.promptTokens || usage.inputTokens || 0,
                    completionTokens: usage.completionTokens || usage.outputTokens || 0,
                    metadata: usage,
                    organizationId: userContext.organizationId || null,
                });
            } catch (e: any) {
                console.error("[Agent Service] Failed to log AI usage:", e);
            }
        }

        // Save Interactions (Always audit for telemetry/traceability)
        try {
            const jobId = clientContext?.jobId;
            // Save User Message
            await this.saveMessage(jobId, userContext.userId || 'anonymous', 'user', fullMessage, { context: clientContext }, clientContext?.sessionId, missionId, userContext.organizationId ?? undefined);

            // --- Sync to Workgroup Blackboard & Wake up Missions ---
            if (missionId) {
                try {
                    await missionService.updateBlackboard(
                        missionId,
                        {
                            lastUserGuidance: {
                                content: fullMessage,
                                timestamp: new Date().toISOString()
                            }
                        },
                        `user:${userContext.userId || 'anonymous'}`,
                        "user_chat_guidance"
                    );
                    logger.info(`[Agent Service] Synced guidance to Mission ${missionId} and woke up missions`);
                } catch (err) {
                    logger.error(`[Agent Service] Failed to sync guidance to Mission ${missionId}:`, err);
                }
            }

            // Save Agent Message
            const agentMsgId = await this.saveMessage(jobId, userContext.userId || 'system', 'agent', response, {
                ...responseMetadata,
                model,
                provider,
                triggerPrompt: fullMessage // Store the user prompt that triggered this response
            }, clientContext?.sessionId, missionId, userContext.organizationId ?? undefined);
            messageId = agentMsgId;

            // Stream the persisted id so a streaming client can wire up feedback
            // (thumbs up/down) on the message it already rendered from `final`.
            if (onEvent && messageId) {
                onEvent({ type: "meta", data: { messageId } });
            }

            // --- Sync to Python Sidecar (Phase 1) ---
            sidecarSyncService.syncMemory({
                content: response,
                sessionId: clientContext?.sessionId,
                workflowId: (clientContext?.jobConfig as any)?.pipelineId?.toString(),
                context: {
                    userPrompt: fullMessage,
                    model,
                    provider,
                    jobId
                }
            }, userContext.userId || 'system', userContext.organizationId || undefined).catch(() => { });

            // Trigger Asynchronous Evaluation (Fire & Forget)
            if (agentMsgId) {
                // 1. Rule-based Evaluation (Quantitative)
                import("@domain/knowledge/core/evaluation.service.js").then(({ evaluationService }) => {
                    evaluationService.evaluateResponse(agentMsgId, response, {
                        jobId: jobId,
                        userId: userContext.userId
                    });
                }).catch(err => logger.error("Failed to trigger evaluation:", err));

                // 2. Internal Critic (Qualitative)
                const interactionId = agentMsgId;
                criticService.assessInteraction(interactionId, fullMessage, response, undefined)
                    .then(async (assessment) => {
                        if (assessment && assessment.score >= 7) {
                            try {
                                const { skillAccretionService } = await import("./core/skill-accretion.service.js");
                                await skillAccretionService.accreteFromRun({
                                    goal: fullMessage,
                                    history: agentResult.history || [],
                                    response: response,
                                    organizationId: userContext.organizationId
                                });
                            } catch (accreteErr: any) {
                                logger.error(`[Agent Service] Skill accretion failed: ${accreteErr.message}`, accreteErr);
                            }
                        }
                    })
                    .catch(err => logger.error("[Agent Service] Critic Assessment Failed:", err));
            }

        } catch (e) {
            logger.error("[Agent Service] Failed to save chat interaction:", e);
        }

        const updatedHistory = [...existingHistory, userMsg, { type: "system", content: response, role: "assistant" }];
        await setChatHistory(clientContext?.sessionId || userContext.userId, updatedHistory);

        return {
            response,
            messageId,
            scope,
            missionId,
            metadata: responseMetadata,
        };
    },

    async submitFeedback(messageId: number, feedbackData: {
        rating?: number;
        feedback?: string;
        reason?: string;
        feedbackReason?: string;
        videoMetadata?: {
            videoId: string;
            segmentId?: number;
            topic?: string;
        }
    }, owner?: OrgContext) {
        if (owner) {
            const [message] = await db.select({ id: agentChatMessages.id }).from(agentChatMessages).where(and(
                eq(agentChatMessages.id, messageId),
                eq(agentChatMessages.userId, owner.userId),
                eq(agentChatMessages.role, 'agent'),
                ...getOrgConditions({ ...owner, isSuperAdmin: false }, agentChatMessages, false),
            )).limit(1);
            if (!message) throw Object.assign(new Error('Response not found.'), { statusCode: 404 });
        }
        await db.update(agentChatMessages)
            .set({
                rating: feedbackData.rating,
                feedback: feedbackData.feedback || undefined,
                feedbackReason: feedbackData.feedbackReason || feedbackData.reason || undefined,
            })
            .where(eq(agentChatMessages.id, messageId));

        // --- NEW: Video Content Critique ---
        if (feedbackData.videoMetadata) {
            try {
                const [msg] = await db.select({
                    organizationId: missions.organizationId,
                    userId: agentChatMessages.userId
                })
                    .from(agentChatMessages)
                    .leftJoin(missions, eq(agentChatMessages.missionId, missions.id))
                    .where(eq(agentChatMessages.id, messageId))
                    .limit(1);

                await videoFeedbackService.recordCritique({
                    videoId: feedbackData.videoMetadata.videoId,
                    segmentId: feedbackData.videoMetadata.segmentId,
                    topic: feedbackData.videoMetadata.topic,
                    rating: feedbackData.rating || 0,
                    feedback: feedbackData.feedback,
                    feedbackReason: feedbackData.feedbackReason || feedbackData.reason,
                    organizationId: msg?.organizationId,
                    createdBy: msg?.userId || 'system',
                    messageId: messageId
                });
            } catch (e) {
                console.warn('[Agent Service] Failed to record video critique:', e);
            }
        }

        // Track effectiveness: If this is positive feedback, boost the effectiveness
        // of examples that were used in the prompt for this response
        if (feedbackData.rating === 1) {
            try {
                // Get the message to find its jobId, timestamp, and usedExampleIds
                const [msg] = await db.select({
                    jobId: agentChatMessages.jobId,
                    createdAt: agentChatMessages.createdAt,
                    metadata: agentChatMessages.metadata
                })
                    .from(agentChatMessages)
                    .where(eq(agentChatMessages.id, messageId))
                    .limit(1);

                if (msg?.jobId) {
                    // Prefer precise usedExampleIds from metadata if available
                    const usedExampleIds = (msg.metadata as any)?._usedExampleIds as number[] | undefined;

                    if (usedExampleIds && usedExampleIds.length > 0) {
                        // Precise tracking: boost exactly the examples that were used
                        await db.update(agentChatMessages)
                            .set({
                                effectivenessScore: sql`COALESCE(${agentChatMessages.effectivenessScore}, 0) + 1`
                            })
                            .where(inArray(agentChatMessages.id, usedExampleIds));
                    } else {
                        // Fallback: boost recent positive examples (time-based estimation)
                        await db.execute(sql`
                            UPDATE agent_chat_messages
                            SET effectiveness_score = COALESCE(effectiveness_score, 0) + 1
                            WHERE job_id = ${msg.jobId}
                            AND role = 'agent'
                            AND rating = 1
                            AND id != ${messageId}
                            AND created_at < ${msg.createdAt}
                            ORDER BY created_at DESC
                            LIMIT 3
                        `);
                    }
                }
            } catch (e) {
                console.warn('[Agent Service] Failed to update effectiveness scores:', e);
            }
        }
    },


    async saveMessage(jobId: number | undefined, userId: string, role: string, content: string, metadata: any = {}, sessionId?: string, missionId?: number, organizationId?: number) {
        const { agentChatMessages } = await import("@shared/schema/index.js");
        const { eq, and, gt } = await import("drizzle-orm");

        // Deduplication check: Don't save if same message was saved within last 30 seconds
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        const [existingDupe] = await db.select({ id: agentChatMessages.id })
            .from(agentChatMessages)
            .where(and(
                jobId ? eq(agentChatMessages.jobId, jobId) : undefined,
                sessionId ? eq(agentChatMessages.sessionId, sessionId) : undefined,
                eq(agentChatMessages.userId, userId),
                eq(agentChatMessages.role, role as any),
                eq(agentChatMessages.content, content),
                gt(agentChatMessages.createdAt, thirtySecondsAgo)
            ))
            .limit(1);

        if (existingDupe) {
            console.log(`[Agent Service] Skipping duplicate message save (ID: ${existingDupe.id})`);
            return existingDupe.id;
        }

        const [result] = await db.insert(agentChatMessages).values({
            jobId,
            userId,
            sessionId,
            role: role as any,
            content,
            metadata,
            rating: 0,
            missionId: missionId || null,
            organizationId: organizationId ?? null,
        }).returning({ id: agentChatMessages.id });

        const messageId = result?.id;

        // Async generate embedding for agent responses (fire & forget)
        if (messageId && role === 'agent') {
            embeddingService.generateAndStoreEmbedding(messageId, content).catch(() => { });
        }

        // Bump the dialectic turn counter for user messages so the
        // reconciliation worker has accurate cadence. Fire-and-forget.
        if (messageId && role === 'user' && organizationId) {
            import("./core/user-representation.service.js")
                .then(({ userRepresentationService }) => userRepresentationService.recordTurn(organizationId, userId))
                .catch(() => { });
        }

        return messageId;
    },
    /**
     * Generate description for a scoring intervention
     */
    async generateScoringDescription(threshold: any, rules: any[] = []): Promise<string> {
        const prompt = `
        You are a scoring expert. Generate a human-readable description for a scoring intervention.
        Threshold: ${JSON.stringify(threshold)}
        Rules: ${JSON.stringify(rules)}
        
        The description should explain what conditions trigger this intervention.
        `;

        const aiConfig = await systemAiService.getAiConfig('copilot');
        if (!aiConfig) return "Intervention triggered by scoring rules.";

        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider as any });
        const res = await aiClient.execute({
            model: aiConfig.model,
            systemPrompt: "You are a helpful assistant.",
            userPrompt: prompt,
        } as any, undefined, aiConfig.apiKey ?? "");

        return res.output || "Intervention triggered by scoring rules.";
    },

    /**
     * Gets all agents that are currently considered idle.
     * TODO: This is a placeholder. A real implementation would need a more robust way to track agent status.
     */
    async getIdleAgents(): Promise<any[]> {
        const { agentDeployments } = await import("@shared/schema/agent-deployments.js");
        // For now, we consider all deployed agents as potentially idle.
        return db.select().from(agentDeployments).limit(100);
    }
};




