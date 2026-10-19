import { db } from "@server/database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError } from "@server/utils/errors.js";
import { buildPersonalityModifier } from "@domain/agents/core/app-personality.service.js";

const logger = createLogger("AppShadowAuditService");

export interface AuditFinding {
    category: "Prompt Safety" | "Budget Risk" | "Data Exposure" | "Persona Drift" | "Code Health";
    severity: "critical" | "warning" | "info";
    issue: string;
    recommendation: string;
}

export const appShadowAuditService = {
    async runAudit(appId: number, orgId: number): Promise<{ findings: AuditFinding[] }> {
        const [row] = await db.select({ app: apps, deployment: appDeployments })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)))
            .limit(1);

        if (!row) throw new NotFoundError("App deployment not found");

        const { deployment, app } = row;

        const personalityModifier = buildPersonalityModifier(
            deployment.oceanTraits as any,
            deployment.soulArchetype ?? undefined
        );
        const effectiveSystemPrompt = personalityModifier
            ? `${personalityModifier}\n\n${deployment.systemPrompt ?? ""}`
            : deployment.systemPrompt;

        const auditConfig = JSON.stringify({
            systemPrompt: effectiveSystemPrompt?.slice(0, 500),
            accessPolicy: deployment.accessPolicy,
            budgetLimitUsd: deployment.budgetLimitUsd,
            userBudgetLimit: deployment.userBudgetLimit,
            hilEnabled: deployment.hilEnabled,
            appMemoryEnabled: deployment.appMemoryEnabled,
            oceanTraits: deployment.oceanTraits,
            soulArchetype: deployment.soulArchetype,
            webhookUrl: deployment.webhookUrl,
            defaultModel: deployment.defaultModel,
        }, null, 2);

        // Fetch X-Ray Structural Metrics for deeper codebase insight
        let codebaseHealth = "X-Ray Metrics Unavailable";
        try {
            const { podRegistry } = await import("@domain/core/infrastructure/pod-registry.service.js");
            if (podRegistry.hasPod('xray')) {
                const xray = podRegistry.getPodSync<any>('xray');
                const metrics = await xray.getMetrics(app.slug);
                codebaseHealth = JSON.stringify(metrics, null, 2);
            }
        } catch (err) {
            logger.warn(`X-Ray metric fetch failed for ${app.slug}: ${err}`);
        }

        const auditPrompt = `You are a security and alignment auditor for agentic AI apps.
Analyze this app deployment configuration and its codebase health metrics to produce findings JSON.

App: ${app.name} (${app.slug})
Config Metadata:
${auditConfig}

Codebase Structural Health (X-Ray):
${codebaseHealth}

Return ONLY a JSON array of findings. Each finding must have:
- category: one of "Prompt Safety", "Budget Risk", "Data Exposure", "Persona Drift", "Code Health"
- severity: "critical", "warning", or "info"
- issue: brief description of the problem
- recommendation: concrete action to fix it

When analyzing X-Ray metrics:
- High "parseErrors" is CRITICAL (the app logic is broken).
- High "callEdgeCount" relative to "functionCount" may indicate complex spaghetti logic.
- High "exportedFunctions" in a secure app might indicate "Data Exposure" risks.

Be thorough but fair. Return [] if no issues found.`;

        try {
            const { systemAiService } = await import("../ai/core/system-ai.service.js");
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const aiConfig = await systemAiService.getAiConfig('copilot', orgId);
            if (!aiConfig?.apiKey) {
                logger.warn("No AI config available for shadow audit");
                return { findings: [] };
            }

            const client = AIClientFactory.getClient({
                provider: aiConfig.provider,
                baseUrl: aiConfig.baseUrl
            } as any);

            const result = await client.execute({
                model: aiConfig.model,
                systemPrompt: "You are a JSON-only AI security auditor. Only output valid JSON arrays.",
                userPrompt: auditPrompt,
                temperature: 0.3,
                useCache: false,
                saveOutputToFile: false,
                credentialId: aiConfig.credentialId || 0
            }, undefined, aiConfig.apiKey);

            const raw = result.output?.trim() || "[]";
            const jsonStart = raw.indexOf("[");
            const jsonEnd = raw.lastIndexOf("]");
            const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : "[]";

            const findings: AuditFinding[] = JSON.parse(jsonStr);

            // Persist findings to database for historical tracking (cap at 50 per run)
            if (findings.length > 0) {
                const { appAuditLogs } = await import("@shared/schema/index.js");
                await db.insert(appAuditLogs).values(
                    findings.slice(0, 50).map(f => ({
                        appId,
                        orgId,
                        findingType: f.category,
                        severity: f.severity,
                        description: f.issue,
                        recommendation: f.recommendation,
                        qaTrace: []
                    }))
                );
            }

            return { findings };
        } catch (err: any) {
            logger.error(`Shadow audit failed for app ${appId}: ${err.message}`);
            return { findings: [] };
        }
    }
};
