import { db } from "@server/database_service.js";
import {
    credentials, jobs, documentTemplates, missionTemplates, operationalCycles, apps,
} from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlueprintInspectionService");

/**
 * Read-only inspection of an installed blueprint: configuration-drift detection
 * and post-install health checks. Split out of OrgForgeService — these only
 * observe provisioned state, they never mutate it.
 */
export class BlueprintInspectionService {

    /**
     * Detect configuration drift between actual state and manifest
     */
    async detectConfigurationDrift(orgId: number, blueprintName: string): Promise<{
        hasDrift: boolean;
        drifts: Array<{ resource: string; type: string; description: string }>;
    }> {
        logger.info(`[OrgForge] Detecting configuration drift for org: ${orgId}, blueprint: ${blueprintName}`);

        const drifts: Array<{ resource: string; type: string; description: string }> = [];

        // Get the operational cycle metadata to compare against
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.organizationId, orgId),
                eq(operationalCycles.name, blueprintName)
            ))
            .limit(1);

        if (!cycle) {
            return { hasDrift: false, drifts: [] };
        }

        const metadata = cycle.metadata as any;
        if (!metadata || metadata.source !== "cycle_app") {
            return { hasDrift: false, drifts: [] };
        }

        // Compare agents
        const existingAgents = await db.select()
            .from(jobs)
            .where(eq(jobs.organizationId, orgId));

        const manifestAgentIds = new Set(metadata.blueprints?.map((b: any) => b.name) || []);
        const existingAgentIds = new Set(existingAgents.map((j: any) => j.name));

        for (const agentId of existingAgentIds) {
            if (!manifestAgentIds.has(agentId)) {
                drifts.push({
                    resource: `agent:${agentId}`,
                    type: "extra_resource",
                    description: "Agent exists but not in blueprint manifest",
                });
            }
        }

        for (const agentId of manifestAgentIds) {
            if (!existingAgentIds.has(agentId)) {
                drifts.push({
                    resource: `agent:${agentId}`,
                    type: "missing_resource",
                    description: "Agent defined in manifest but not provisioned",
                });
            }
        }

        // Compare templates
        const existingTemplates = await db.select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, orgId));

        const manifestTemplateIds = new Set(metadata.blueprints?.map((b: any) => b.name) || []);
        const existingTemplateIds = new Set(existingTemplates.map((t: any) => t.name));

        for (const templateId of existingTemplateIds) {
            if (!manifestTemplateIds.has(templateId)) {
                drifts.push({
                    resource: `template:${templateId}`,
                    type: "extra_resource",
                    description: "Template exists but not in blueprint manifest",
                });
            }
        }

        return {
            hasDrift: drifts.length > 0,
            drifts,
        };
    }

    /**
     * Perform health checks after blueprint installation
     */
    async performHealthChecks(orgId: number, blueprintName: string): Promise<{
        healthy: boolean;
        checks: Array<{ name: string; status: "pass" | "fail" | "warn"; message: string }>;
    }> {
        logger.info(`[OrgForge] Performing health checks for org: ${orgId}, blueprint: ${blueprintName}`);

        const checks: Array<{ name: string; status: "pass" | "fail" | "warn"; message: string }> = [];

        // Check 1: AI Provider Credential
        const [aiCred] = await db.select()
            .from(credentials)
            .where(and(
                eq(credentials.type, "ai_provider"),
                eq(credentials.organizationId, orgId)
            ))
            .limit(1);

        if (aiCred) {
            checks.push({
                name: "AI Provider Credential",
                status: "pass",
                message: "AI provider credential is configured"
            });
        } else {
            checks.push({
                name: "AI Provider Credential",
                status: "fail",
                message: "AI provider credential is missing"
            });
        }

        // Check 2: Required Integrations
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(eq(operationalCycles.name, blueprintName))
            .limit(1);

        if (cycle) {
            const requiredIntegrations = ["jira", "slack", "source_control"];

            for (const integration of requiredIntegrations) {
                const [cred] = await db.select()
                    .from(credentials)
                    .where(and(
                        eq(credentials.name, `${blueprintName} — ${integration}`),
                        eq(credentials.organizationId, orgId)
                    ))
                    .limit(1);

                if (cred) {
                    checks.push({
                        name: `Integration: ${integration}`,
                        status: "pass",
                        message: `${integration} is configured`
                    });
                } else {
                    checks.push({
                        name: `Integration: ${integration}`,
                        status: "warn",
                        message: `${integration} is not configured`
                    });
                }
            }
        }

        // Check 3: Agents
        const agents = await db.select()
            .from(jobs)
            .where(and(
                eq(jobs.type, "ai_agent"),
                eq(jobs.organizationId, orgId)
            ));

        if (agents.length > 0) {
            checks.push({
                name: "Agents",
                status: "pass",
                message: `${agents.length} agents are provisioned`
            });
        } else {
            checks.push({
                name: "Agents",
                status: "fail",
                message: "No agents are provisioned"
            });
        }

        // Check 4: Templates
        const templates = await db.select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, orgId));

        if (templates.length > 0) {
            checks.push({
                name: "Document Templates",
                status: "pass",
                message: `${templates.length} templates are provisioned`
            });
        } else {
            checks.push({
                name: "Document Templates",
                status: "warn",
                message: "No templates are provisioned"
            });
        }

        // Check 5: Mission Templates
        const missionTemplatesResult = await db.select()
            .from(missionTemplates)
            .where(eq(missionTemplates.organizationId, orgId));

        if (missionTemplatesResult.length > 0) {
            checks.push({
                name: "Mission Templates",
                status: "pass",
                message: `${missionTemplatesResult.length} missions are provisioned`
            });
        } else {
            checks.push({
                name: "Mission Templates",
                status: "fail",
                message: "No mission templates are provisioned"
            });
        }

        // Check 6: Apps
        const appList = await db.select()
            .from(apps)
            .where(eq(apps.organizationId, orgId));

        if (appList.length > 0) {
            checks.push({
                name: "Apps",
                status: "pass",
                message: `${appList.length} apps are provisioned`
            });
        } else {
            checks.push({
                name: "Apps",
                status: "warn",
                message: "No apps are provisioned"
            });
        }

        const hasFailures = checks.some(c => c.status === "fail");

        return {
            healthy: !hasFailures,
            checks,
        };
    }
}

export const blueprintInspectionService = new BlueprintInspectionService();
