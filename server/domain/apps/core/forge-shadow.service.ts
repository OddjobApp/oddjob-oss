
import { db } from "@server/database_service.js";
import { apps, appAuditLogs } from "@shared/schema/index.js";

import { eq, lt, or, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { appForgeService } from "../app-forge.service.js";
import { seleniumRunnerService } from "./selenium-runner.service.js";
import { forgeCodegenService } from "./forge-codegen.service.js";
import path from "node:path";
import { FORGE_WORKSPACE_ROOT, getForgeWorkspacePath } from "./forge-paths.js";

const logger = createLogger("ForgeShadowService");

export const forgeShadowService = {
    /**
     * Run a "Shadow Audit" on an existing app.
     * This is an autonomous QA pass that detects regressions and auto-heals them.
     */
    async auditApp(appId: number) {
        const [app] = await db.select().from(apps).where(eq(apps.id, appId));
        if (!app) throw new Error("App not found");

        // apps.developer_org_id is nullable but app_audit_logs.org_id is NOT NULL,
        // which is what the `|| 1` below used to paper over -- filing one app's QA
        // findings into org 1's audit log. Findings we cannot attribute are not
        // worth writing to the wrong tenant, so bail the way the missing-port
        // check below does.
        const orgId = app.developerOrgId;
        if (orgId == null) {
            logger.warn(`[ShadowRun] No developer org for ${app.slug}. Skipping audit.`);
            return;
        }

        logger.info(`[ShadowRun] Starting autonomous audit for ${app.slug} (${app.name})`);

        // 1. Resolve Launch URL
        // In Mach 3, we assume the app is running in the warm pool or a production container.
        // We'll try to find its active port.
        const runtimeMetadata = (app.runtimeMetadata || {}) as any;
        const port = runtimeMetadata.activePort;
        if (!port) {
            logger.warn(`[ShadowRun] No active port found for ${app.slug}. Skipping audit.`);
            return;
        }

        const startUrl = `http://localhost:${port}`;
        const goal = `Verify that the application "${app.name}" is healthy. 
                     Check for:
                     - Blank pages or 404s
                     - JavaScript runtime errors in console
                     - Broken images or broken layout
                     - Missing core features described as: "${app.description}"`;

        try {
            // 2. Execute Real Selenium Browser Audit
            const audit = await seleniumRunnerService.runAudit(
                app.id,
                app.slug,
                startUrl,
                { browser: "chrome", headless: true }
            );

            // 3. Persist Audit Logs based on results
            const hasErrors = audit.status === "failed";
            const consoleErrors = audit.results.flatMap(r => r.consoleErrors || []);
            const brokenImages = audit.results.flatMap(r => r.brokenImages || []);
            const layoutIssues = audit.results.flatMap(r => r.layoutIssues || []);

            if (hasErrors || consoleErrors.length > 0 || brokenImages.length > 0 || layoutIssues.length > 0) {
                const auditRows = [
                    ...consoleErrors.filter(e => e.level === "SEVERE").map(error => ({
                        appId: app.id, orgId,
                        findingType: "console_error",
                        severity: "warning",
                        description: error.message,
                        recommendation: "Check browser console for JavaScript errors",
                        qaTrace: { type: "console", error, auditId: audit.runId }
                    })),
                    ...brokenImages.map(img => ({
                        appId: app.id, orgId,
                        findingType: "broken_image",
                        severity: "warning",
                        description: `Broken image: ${img.src}`,
                        recommendation: `Check image at ${img.selector || "unknown selector"}`,
                        qaTrace: { type: "image", img, auditId: audit.runId }
                    })),
                    ...layoutIssues.map(issue => ({
                        appId: app.id, orgId,
                        findingType: "layout_issue",
                        severity: "warning",
                        description: issue.details,
                        recommendation: `Check element: ${issue.element}`,
                        qaTrace: { type: "layout", issue, auditId: audit.runId }
                    })),
                    ...(audit.results.some(r => r.error) ? [{
                        appId: app.id, orgId,
                        findingType: "audit_failure",
                        severity: "critical",
                        description: "Selenium audit failed",
                        recommendation: "Review audit results and fix critical issues",
                        qaTrace: { type: "failure", results: audit.results, auditId: audit.runId }
                    }] : []),
                ];
                if (auditRows.length > 0) {
                    await db.insert(appAuditLogs).values(auditRows);
                }
            } else {
                 await db.insert(appAuditLogs).values({
                    appId: app.id,
                    orgId,
                    findingType: "health_check",
                    severity: "info",
                    description: `Shadow audit passed: ${audit.results.length} tests completed`,
                    recommendation: "No action required",
                    qaTrace: { type: "success", auditId: audit.runId, results: audit.results }
                });
            }

            // 4. Trigger Self-Healing if defects detected
            if (hasErrors) {
                logger.warn(`[ShadowRun] Defects detected in ${app.slug}. Initiating surgical self-healing...`);
                
                await forgeCodegenService.refineBlueprintFiles(
                    app.slug,
                    (app as any).blueprintSlug || 'analytics-dashboard',
                    {
                        name: app.name,
                        slug: app.slug,
                        description: app.description || "",
                        organizationId: app.developerOrgId || undefined,
                        oddjobMissionId: 0
                    } as any,
                    audit.results, // Pass audit results for refinement context

                    getForgeWorkspacePath(app.slug),
                    async (msg) => { logger.info(`[ShadowHeal:${app.slug}] ${msg}`); }
                );

                logger.info(`[ShadowRun] Self-healing pass completed for ${app.slug}.`);
            } else {
                logger.info(`[ShadowRun] Audit passed for ${app.slug}.`);
            }

            // 5. Update Audit Timestamp
            await db.update(apps)
                .set({ 
                    runtimeMetadata: { 
                        ...runtimeMetadata, 
                        lastShadowRunAt: new Date().toISOString(),
                        shadowRunPassed: !hasErrors
                    }
                })
                .where(eq(apps.id, appId));


        } catch (err: any) {
            logger.error(`[ShadowRun] Audit failed for ${app.slug}: ${err.message}`);
        }
    },

    /**
     * Run shadow audits on all eligible apps.
     */
    async auditAll(limit: number = 5) {
        // Query for apps that haven't been audited in 24 hours
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // This is a bit tricky with JSONB fields in Drizzle, so we'll do a simple fetch for now
        const allApps = await db.select().from(apps);
        
        const eligible = allApps.filter(app => {
            const meta = (app.runtimeMetadata || {}) as any;
            if (!meta.activePort) return false;
            if (!meta.lastShadowRunAt) return true;
            return new Date(meta.lastShadowRunAt) < yesterday;
        }).slice(0, limit);

        logger.info(`[ShadowRun] Found ${eligible.length} apps eligible for audit.`);

        for (const app of eligible) {
            await this.auditApp(app.id);
        }
    },

    /**
     * Executes a "Challenger" shadow forge in the background.
     * Compares the live forge result with an alternative version.
     */
    async runChallengerShadow(
        liveAppSlug: string,
        options: any,
        liveFiles: Record<string, string>,
        liveBlueprintSlug: string,
        traceContext?: any
    ) {
        const shadowId = `shadow-${liveAppSlug}-${Date.now()}`;
        logger.info(`[ShadowChallenger] Starting REAL shadow forge for ${liveAppSlug} (ID: ${shadowId})`);

        try {
            // Lazy import to avoid circular dependencies
            const { forgeWowService } = await import("./forge-wow.service.js");
            const { redis } = await import("@server/domain/core/infrastructure/redis/redis-client.js");
            const { forgeCodegenService } = await import("./forge-codegen.service.js");
            const { generateSlug } = await import("../utils/slug-generator.js");

            const liveScore = forgeWowService.calculateWowScore(liveFiles, options.description);
            const liveTokenCount = JSON.stringify(liveFiles).length;
            const liveStartTime = Date.now();

            // 1. Pick a "Challenger" Blueprint/Strategy
            // Rotate through alternatives based on the live blueprint
            const blueprintRotations: Record<string, string> = {
                'industrial-dashboard': 'analytics-dashboard',
                'analytics-dashboard': 'industrial-dashboard',
                'crud-app': 'spa',
                'spa': 'crud-app',
                'chat-assistant': 'chat-assistant-v2',
                'chat-assistant-v2': 'chat-assistant',
                'mission-supervisor': 'rescue-dispatch',
                'rescue-dispatch': 'mission-supervisor',
            };
            
            const shadowBlueprintSlug = blueprintRotations[liveBlueprintSlug] || 'analytics-dashboard';

            // 2. Run the ACTUAL shadow forge codegen in workspace
            const shadowSlug = generateSlug(`shadow-${liveAppSlug}`);
            const shadowWorkspace = path.join(FORGE_WORKSPACE_ROOT, shadowSlug);
            
            logger.info(`[ShadowChallenger] Running shadow forge with blueprint: ${shadowBlueprintSlug}`);
            
            const shadowStartTime = Date.now();
            let shadowFiles: Record<string, string> = {};
            let shadowError: string | null = null;
            
            try {
                // Execute real codegen in isolated workspace
                const result = await forgeCodegenService.generateBlueprintFiles(
                    shadowSlug,
                    shadowBlueprintSlug,
                    {
                        name: `${options?.name || "Shadow App"} (Shadow)`,
                        slug: shadowSlug,
                        description: options?.description || "Shadow forge evaluation",
                        organizationId: options?.organizationId,
                        oddjobMissionId: options?.oddjobMissionId || 0,
                    },
                    undefined, // jobId
                    traceContext,
                    shadowWorkspace
                );
                if (result.success && result.files) {
                    shadowFiles = result.files;
                }
            } catch (err: any) {
                shadowError = err.message;
                logger.error(`[ShadowChallenger] Shadow forge failed: ${err.message}`);
            }
            
            const shadowDuration = Date.now() - shadowStartTime;
            const shadowTokenCount = JSON.stringify(shadowFiles).length;
            
            // 3. Calculate shadow score
            const shadowScore = shadowError 
                ? 0 
                : forgeWowService.calculateWowScore(shadowFiles, options.description);

            // 4. Build comparison result
            const comparison = {
                shadowId,
                live: {
                    blueprint: liveBlueprintSlug,
                    score: liveScore,
                    tokens: liveTokenCount,
                    duration: Date.now() - liveStartTime,
                },
                shadow: {
                    blueprint: shadowBlueprintSlug,
                    score: shadowScore,
                    tokens: shadowTokenCount,
                    duration: shadowDuration,
                    error: shadowError,
                },
                winner: shadowScore > liveScore ? 'shadow' : 'live',
                improvement: shadowScore - liveScore,
                timestamp: new Date().toISOString(),
                filesGenerated: Object.keys(shadowFiles).length,
            };

            // 5. Store result in Redis for the Dashboard
            await redis.set(`forge:shadow:result:${liveAppSlug}`, JSON.stringify(comparison), 'EX', 86400 * 7);
            
            // 6. Persist shadow app record for analysis
            try {
                const [shadowApp] = await db.insert(apps).values({
                    name: `${options.name} (Shadow: ${shadowBlueprintSlug})`,
                    slug: shadowSlug,
                    description: `Shadow forge comparing ${liveBlueprintSlug} vs ${shadowBlueprintSlug}`,
                    blueprintSlug: shadowBlueprintSlug,
                    developerOrgId: options.organizationId,
                    status: shadowError ? 'failed' : 'draft',
                    runtimeMetadata: {
                        isShadowForge: true,
                        parentAppSlug: liveAppSlug,
                        comparison,
                        generatedFiles: Object.keys(shadowFiles),
                    },
                }).returning();
                
                logger.info(`[ShadowChallenger] Shadow app created: ${shadowApp.id} (${shadowSlug})`);
            } catch (err) {
                logger.warn(`[ShadowChallenger] Failed to persist shadow app record: ${(err as any).message}`);
            }
            
            logger.info(`[ShadowChallenger] REAL shadow forge complete for ${liveAppSlug}. Winner: ${comparison.winner}, Improvement: ${comparison.improvement}pts`);

        } catch (err: any) {
            logger.error(`[ShadowChallenger] Shadow forge failed: ${err.message}`);
        }
    }
};
