import { db } from "@server/database_service.js";
import {
    orgSettings, missions, missionRuns,
    credentials, jobs, documentTemplates, missionTemplates, schedules, scheduledJobs,
    operationalCycles, cycleBlueprints, cycleDependencyGates, datasets, hilForms,
    pipelines, pipelineSteps, teams, teamMembers, users, apps, appDeployments, appInstances
} from "@shared/schema/index.js";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import yaml from "js-yaml";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { BlueprintSchemaValidator } from "./blueprint-schema.validator.js";
import { applyEnvironmentOverrides } from "./blueprint-yaml.util.js";
import { registerCrossAppEventHandlers } from "./event-handlers.js";
import { blueprintMigrationService } from "./blueprint-migration.service.js";
import { cycleDagService } from "@domain/mission/core/cycle-dag.service.js";
import { securityComplianceService } from "./security-compliance.service.js";
import { crossAppEventBus } from "./event-bus.service.js";
import { performanceOptimizationService } from "./performance-optimization.service.js";
import { enhancedObservabilityService } from "./enhanced-observability.service.js";
import { ensureAgentIdentityForBlueprintAgent } from "@domain/governance/core/agent-identity-backfill.service.js";
import { resolveAgentIntakeForm } from "./agent-intake-form.js";

const logger = createLogger("OrgForgeService");

// Initialize cross-app event handlers
registerCrossAppEventHandlers();

// Maps integration block name → credential type + which field holds the auth secret.
// Other fields in the integration block are stored in credentials.metadata.
const INTEGRATION_MAP: Record<string, { type: string; tokenField: string }> = {
    jira:             { type: "jira",           tokenField: "api_token" },
    confluence:       { type: "confluence",     tokenField: "api_token" },
    source_control:   { type: "api_key",        tokenField: "api_token" },
    database:         { type: "database",       tokenField: "dev_url" },
    package_registry: { type: "api_key",        tokenField: "npm_auth_token" },
    slack:            { type: "webhook",        tokenField: "workspace_id" },
    agentmail:        { type: "webhook",        tokenField: "domain" },
    ngrok:            { type: "webhook",        tokenField: "auth_token" },
    msteams:          { type: "webhook",        tokenField: "alerts_webhook_url" },
    sharepoint:       { type: "cloud_storage",  tokenField: "tenant_id" },
    google_drive:     { type: "cloud_storage",  tokenField: "shared_drive_id" },
    google_calendar:  { type: "cloud_storage",  tokenField: "calendar_id" },
    gcp:              { type: "cloud_storage",  tokenField: "project_id" },
};

function extractEnvVarName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = value.match(/^\$\{ENV\.([A-Z_][A-Z0-9_]*)\}$/);
    return match ? match[1] : null;
}

function isIntegrationActive(block: any): boolean {
    if (!block || typeof block !== "object") return false;
    if (block.required === true) return true;
    if (block.enabled === true) return true;
    // Default: skip blocks where neither required nor enabled is explicitly true
    return false;
}

/**
 * Safe reading of files, supports both memory archives and filesystem
 */
async function readFileSafe(filePath: string, archiveMap?: Map<string, string>): Promise<{ content: string | null; error?: string }> {
    try {
        const relativePath = filePath.replace(/^file:\/\//, "").replace(/\\/g, '/');

        if (archiveMap && archiveMap.has(relativePath)) {
            return { content: archiveMap.get(relativePath)! };
        }

        const absolutePath = path.resolve(process.cwd(), relativePath);
        try {
            const content = await fs.readFile(absolutePath, "utf-8");
            return { content };
        } catch {
            // Fall through to the dehydrated-apps lookup below.
        }

        // When a cycle is installed from YAML (no archive), bare names like
        // "file://pm-workbench" resolve to CWD/pm-workbench which doesn't exist.
        // Try server/storage/dehydrated-apps/<name_underscored>.forgeapp.json.
        const bareName = relativePath.split("/").pop() ?? relativePath;
        const dehydratedName = bareName.replace(/-/g, "_") + ".forgeapp.json";
        const dehydratedPath = path.resolve(process.cwd(), "server", "storage", "dehydrated-apps", dehydratedName);
        const content = await fs.readFile(dehydratedPath, "utf-8");
        return { content };
    } catch (e: any) {
        return { content: null, error: e.message };
    }
}

// Rollback is no longer state-based. The prior in-memory snapshot pattern only
// restored 2 of ~13 tables on failure (leaving orphaned credentials, agents,
// pipelines, etc.) AND leaked memory because the snapshot map was never pruned.
// Replaced by cleanupFailedInstall() — a deterministic delete-by-predicate that
// uses the _cycleAppName marker we stamp at install time.

/**
 * State threaded through installCycleApp's provisioning steps.
 *
 * installCycleApp was a single ~1250-line method whose 14 numbered steps
 * communicated through locals: counters each step incremented, and id maps built
 * by one step and read by a later one (agents → pipeline steps → schedules).
 * Extracting a step means making that dependency explicit rather than implicit,
 * so each provision* method takes this context and returns only its own count.
 *
 * `warnings` is shared by reference on purpose — every step appends to the one
 * list that ends up in the install summary.
 */
interface InstallContext {
    orgId: number;
    manifest: any;
    cycleAppSlug: string;
    warnings: string[];
    /** Files bundled with an archive install, keyed by manifest-relative path. */
    archiveMap?: Map<string, string>;
    /** Row id of the org's AI provider credential. Produced by step 1. */
    credentialId: number;
    /** Row id of the operational cycle. Produced by step 11. */
    cycleId: number;
    /** agent id → agent name. Built by step 3, read by steps 7b and 8. */
    agentNameById: Record<string, string>;
    /** agent id → agent job row id. Built by step 3, read by step 7b. */
    agentJobIdById: Record<string, number>;
    /** mission id → mission name. Built by step 7, read by step 13. */
    missionNameById: Record<string, string>;
    /** mission string id → mission row id. Built by step 7b, read by steps 8 and 13. */
    dbMissionIdByStringId: Record<string, number>;
    /** mission string id → pipeline row id. Built by step 7b, read by step 7c. */
    pipelineIdByMissionId: Record<string, number>;
}

export class OrgForgeService {

    /**
     * Generate a preview of what will be provisioned during installation
     */
    private generatePreview(manifest: any) {
        const preview = {
            blueprint: {
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
            },
            integrations: [] as string[],
            agents: [] as string[],
            templates: [] as string[],
            datasets: [] as string[],
            forms: [] as string[],
            missions: [] as string[],
            schedules: [] as string[],
            escalations: [] as string[],
            humanRoles: [] as string[],
            apps: [] as string[],
            configurations: {
                aiProvider: manifest.ai_provider ? "Yes" : "No",
                knowledgeGraph: manifest.knowledge_graph ? "Yes" : "No",
                mcpServers: manifest.mcp_servers ? Object.keys(manifest.mcp_servers).length : 0,
                observability: manifest.observability ? "Yes" : "No",
                qualityGates: manifest.quality_gates ? "Yes" : "No",
                deployment: manifest.deployment ? "Yes" : "No",
                notifications: manifest.notifications ? "Yes" : "No",
            },
            estimatedResources: {
                agents: manifest.agents?.length || 0,
                missions: manifest.missions?.length || 0,
                templates: manifest.templates?.length || 0,
                forms: manifest.forms?.length || 0,
                schedules: manifest.schedules?.length || 0,
                humanRoles: manifest.human_roles?.members?.length || 0,
                apps: manifest.apps?.length || 0,
            }
        };

        if (manifest.integrations) {
            for (const [name, block] of Object.entries(manifest.integrations as Record<string, any>)) {
                if (block.required === true || block.enabled === true) {
                    preview.integrations.push(name);
                }
            }
        }

        if (manifest.agents) {
            preview.agents = manifest.agents.map((a: any) => a.name || a.id);
        }

        if (manifest.templates) {
            preview.templates = manifest.templates.map((t: any) => t.id);
        }

        if (manifest.knowledge_datasets) {
            preview.datasets = manifest.knowledge_datasets.map((d: any) => d.id);
        }

        if (manifest.forms) {
            preview.forms = manifest.forms.map((f: any) => f.name || f.id);
        }

        if (manifest.missions) {
            preview.missions = manifest.missions.map((m: any) => m.name);
        }

        if (manifest.schedules) {
            preview.schedules = manifest.schedules.map((s: any) => s.id);
        }

        if (manifest.escalations) {
            preview.escalations = manifest.escalations.map((e: any) => e.mission_ref);
        }

        if (manifest.human_roles && manifest.human_roles.members) {
            preview.humanRoles = manifest.human_roles.members.map((m: any) => `${m.role} (${m.user_id})`);
        }

        if (manifest.apps) {
            preview.apps = manifest.apps.map((a: any) => a.name || a.id);
        }

        return preview;
    }

    /**
     * Clean up any partially-provisioned rows from a failed install. Called from
     * installCycleApp's catch block. Uses the _cycleAppName marker stamped into
     * credentials.metadata + cycle metadata + pipeline labels + dataset tags so
     * we only delete what this install would have created — never another app's
     * data, never another org's data. Idempotent.
     */
    async cleanupFailedInstall(orgId: number, cycleAppName: string): Promise<void> {
        logger.warn(`[OrgForge] Cleaning up failed install for org=${orgId} cycleApp="${cycleAppName}"`);
        try {
            const cycleAppSlug = cycleAppName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");

            const cycleIds = (await db.select({ id: operationalCycles.id })
                .from(operationalCycles)
                .where(and(eq(operationalCycles.organizationId, orgId), eq(operationalCycles.name, cycleAppName)))
            ).map(r => r.id);

            if (cycleIds.length) {
                await db.delete(cycleDependencyGates).where(inArray(cycleDependencyGates.cycleId, cycleIds));
                await db.delete(cycleBlueprints).where(inArray(cycleBlueprints.cycleId, cycleIds));
                await db.delete(operationalCycles).where(inArray(operationalCycles.id, cycleIds));
            }

            const pipelineIds = (await db.select({ id: pipelines.id })
                .from(pipelines)
                .where(and(eq(pipelines.organizationId, orgId), sql`labels->>'cycleApp' = ${cycleAppName}`))
            ).map(r => r.id);

            if (pipelineIds.length) {
                await db.update(missionRuns).set({ currentPipelineId: null }).where(inArray(missionRuns.currentPipelineId, pipelineIds));
                await db.update(appDeployments).set({ nextPipelineId: null }).where(inArray(appDeployments.nextPipelineId, pipelineIds));
                await db.delete(pipelineSteps).where(inArray(pipelineSteps.pipelineId, pipelineIds));
                await db.delete(pipelines).where(inArray(pipelines.id, pipelineIds));
            }

            await db.delete(credentials).where(and(
                eq(credentials.organizationId, orgId),
                sql`metadata->>'_cycleAppName' = ${cycleAppName}`,
            ));

            // Tag-marked datasets created by THIS install
            await db.delete(datasets).where(and(
                eq(datasets.organizationId, orgId),
                sql`${cycleAppName} = ANY(tags)`,
            ));

            // Delete app instances, deployments, and apps associated with this failed install
            const appIds = (await db.select({ id: apps.id })
                .from(apps)
                .where(and(
                    eq(apps.organizationId, orgId),
                    or(
                        sql`runtime_metadata->'cycleApp'->>'sourceCycleSlug' = ${cycleAppSlug}`,
                        sql`runtime_metadata->'cycleApp'->>'sourceCycleSlug' = ${cycleAppName}`
                    )
                ))
            ).map(r => r.id);

            if (appIds.length) {
                const depIds = (await db.select({ id: appDeployments.id })
                    .from(appDeployments)
                    .where(inArray(appDeployments.appId, appIds))
                ).map(r => r.id);

                if (depIds.length) {
                    await db.delete(appInstances).where(inArray(appInstances.deploymentId, depIds));
                    await db.delete(appDeployments).where(inArray(appDeployments.id, depIds));
                }
                await db.delete(apps).where(inArray(apps.id, appIds));
            }

            // Delete agent jobs associated with this failed install
            await db.delete(jobs).where(and(
                eq(jobs.organizationId, orgId),
                or(
                    sql`config->>'sourceCycleSlug' = ${cycleAppSlug}`,
                    sql`config->>'sourceCycleSlug' = ${cycleAppName}`
                )
            ));

            logger.info(`[OrgForge] Cleanup complete for org=${orgId} cycleApp="${cycleAppName}"`);
        } catch (cleanupErr: any) {
            logger.error(`[OrgForge] Cleanup itself failed for org=${orgId}: ${cleanupErr.message}`);
            // Don't re-throw — the original install error is what matters
        }
    }

    /**
     * Installs a full Operational Cycle app from an in-memory Zip archive buffer
     */
    async installCycleFromArchive(orgId: number, archiveBuffer: Buffer, options: { dryRun?: boolean; validateOnly?: boolean; environment?: string } = {}) {
        logger.info(`[OrgForge] Installing Cycle from archive buffer for org: ${orgId}`);
        const zip = new AdmZip(archiveBuffer);
        const entries = zip.getEntries();
        
        const archiveMap = new Map<string, string>();
        let manifestContent: string | null = null;

        for (const entry of entries) {
            if (!entry.isDirectory) {
                // normalize slashes for map keys
                const entryName = entry.entryName.replace(/\\/g, '/');
                const content = entry.getData().toString('utf8');
                archiveMap.set(entryName, content);

                if (entryName === 'manifest.yaml' || entryName.endsWith('.cycle.yaml') || entryName.endsWith('.cycle.yml')) {
                    if (!manifestContent) {
                        manifestContent = content;
                    }
                }
            }
        }

        if (!manifestContent) {
            throw new Error("No manifest.yaml or *.cycle.yaml found in archive");
        }

        return this.installCycleApp(orgId, manifestContent, { ...options, archiveMap });
    }

    /**
     * Primary entrypoint: Parses a Cycle YAML, resolves all artifacts, 
     * and atomically writes them into the organization's datastore.
     */
    async installCycleApp(orgId: number, yamlContent: string, options: { dryRun?: boolean; validateOnly?: boolean; environment?: string; archiveMap?: Map<string, string>; skipAppLaunch?: boolean } = {}) {
        const { dryRun = false, validateOnly = false, environment = "default", archiveMap } = options;
        logger.info(`[OrgForge] Installing Cycle App Manifest for org: ${orgId} (dryRun=${dryRun}, validateOnly=${validateOnly}, environment=${environment})`);

        // Start observability span for this operation
        const spanId = `install_${orgId}_${Date.now()}`;
        enhancedObservabilityService.startSpan(spanId, spanId, "installCycleApp");

        const warnings: string[] = [];

        // Validate schema first
        const validation = BlueprintSchemaValidator.validate(yamlContent);
        if (!validation.valid) {
            const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`).join("; ");
            throw new Error(`Blueprint validation failed: ${errorMessages}`);
        }

        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => warnings.push(`Validation warning: ${w.path} - ${w.message}`));
        }

        enhancedObservabilityService.addSpanTag(spanId, "validation_errors", validation.errors.length.toString());
        enhancedObservabilityService.addSpanTag(spanId, "validation_warnings", validation.warnings.length.toString());

        if (validateOnly) {
            return {
                success: true,
                validationOnly: true,
                validationErrors: validation.errors,
                validationWarnings: validation.warnings,
                warnings
            };
        }

        // Apply environment-specific overrides if specified
        const processedYaml = applyEnvironmentOverrides(yamlContent, environment);

        if (dryRun) {
            logger.info("[OrgForge] Dry run mode - returning preview without provisioning");
            const manifest = yaml.load(processedYaml) as any;
            return {
                success: true,
                dryRun: true,
                preview: this.generatePreview(manifest),
                warnings
            };
        }

        try {
            const manifest = yaml.load(processedYaml) as any;
            if (!manifest || !manifest.name) {
                throw new Error("Invalid Cycle App Manifest: Missing 'name'");
            }
            const cycleAppSlug = (manifest.id || manifest.slug || manifest.name || "cycle-app")
                .toString()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");

            logger.info(`[OrgForge] Parsed manifest: ${manifest.name} v${manifest.version}`);

            // Shared state for the provisioning steps below. Steps that have been
            // extracted take this; the ones still inline read the same objects, so
            // there is exactly one copy of each id map during the migration.
            const ctx: InstallContext = {
                orgId,
                manifest,
                cycleAppSlug,
                warnings,
                archiveMap,
                credentialId: 0,
                cycleId: 0,
                agentNameById: {},
                agentJobIdById: {},
                missionNameById: {},
                dbMissionIdByStringId: {},
                pipelineIdByMissionId: {},
            };

            // Aliases for the steps still inline below. They point at ctx's objects,
            // so a step that has been extracted and one that has not still share the
            // same maps.
            const agentNameById = ctx.agentNameById;
            const agentJobIdById = ctx.agentJobIdById;
            const missionNameById = ctx.missionNameById;
            const dbMissionIdByStringId = ctx.dbMissionIdByStringId;

            // ─── Blueprint Migration Check ────────────────────────────────────────
            const currentVersion = await blueprintMigrationService.getCurrentVersion(orgId, manifest.name);
            const targetVersion = manifest.version || "1.0.0";

            if (currentVersion && currentVersion !== targetVersion) {
                logger.info(`[OrgForge] Migration needed from ${currentVersion} to ${targetVersion}`);
                const needsMigration = await blueprintMigrationService.needsMigration(orgId, manifest.name, targetVersion);

                if (needsMigration) {
                    try {
                        await blueprintMigrationService.migrate(orgId, manifest.name, targetVersion);
                        warnings.push(`Blueprint migrated from ${currentVersion} to ${targetVersion}`);
                    } catch (migrationError: any) {
                        logger.error(`[OrgForge] Blueprint migration failed: ${migrationError.message}`);
                        throw new Error(`Blueprint migration failed: ${migrationError.message}`);
                    }
                }
            }

            // On failure, the catch block at the end calls cleanupFailedInstall()
            // to delete every row this install would have created. No in-memory
            // snapshot needed — the cleanup uses provenance markers (cycleApp name)
            // we stamp into credentials.metadata, pipelines.labels, etc.

            // ─── 1. AI provider credential (org-scoped) ─────────────────────────
            const credentialId = await this.provisionAiProviderCredential(ctx);
            ctx.credentialId = credentialId;

            // ─── 2. Integration credentials ──────────────────────────────────────
            const integrationsProvisioned = await this.provisionIntegrationCredentials(ctx);

            // ─── 3. Agents — load system prompt content, persist full profile ────
            const agentsProvisioned = await this.provisionAgents(ctx);

            // ─── 4. Document templates ───────────────────────────────────────────
            const templatesProvisioned = await this.provisionDocumentTemplates(ctx);

            // ─── 6. Knowledge datasets ───────────────────────────────────────────
            const datasetsProvisioned = await this.provisionKnowledgeDatasets(ctx);

            // ─── 6b. Dynamic Forms Ingestion ─────────────────────────────────────
            const formsProvisioned = await this.provisionDynamicForms(ctx);

            // ─── 7. Mission templates ────────────────────────────────────────────
            const missionsProvisioned = await this.provisionMissionTemplates(ctx);

            // ─── 7b. Pipelines + Steps (one pipeline per mission) ────────────────
            const { pipelinesProvisioned, pipelineStepsProvisioned } = await this.provisionPipelines(ctx);

            // ─── 7c. Agent deployments for blueprint-declared public agents ─────
            // `agents[].publish_as_public_agent` declares an agentDeployments row;
            // the form manifest + fallbacks are built here so intake_form is live
            // on first contact.
            const agentDeploymentsProvisioned = await this.provisionAgentDeployments(ctx);

            // ─── 8. Schedules (with agent linkage) ───────────────────────────────
            await this.provisionSchedules(ctx);

            // ─── 9. orgSettings (budget guardrail + knowledge graph + observability) ─────
            await this.provisionOrgSettings(ctx);

            // ─── 10. Human Roles configuration ────────────────────────────────────
            const humanRolesProvisioned = await this.provisionHumanRoles(ctx);

            // ─── 11a. MCP Servers configuration ────────────────────────────────────
            await this.provisionMcpServers(ctx);

            // ─── 11b. OperationalCycle with full manifest metadata ────────────────
            const cycleId = await this.provisionOperationalCycle(ctx);
            ctx.cycleId = cycleId;

            // ─── Validate the full dependency DAG at install (all trigger formats) ──
            await this.validateDependencyDag(ctx);

            // ─── 13a. Cycle dependency gates from all structural dependencies ───────
            const gatesProvisioned = await this.provisionDependencyGates(ctx);

            // ─── 13b. Provision & launch App Forge apps (see provisionApps) ───────
            const { appsProvisioned, appsRunning, appsQueued, appsFailedToLaunch, appLaunchDetails } =
                await this.provisionApps({
                    orgId, manifest, warnings, archiveMap, cycleAppSlug,
                    dbMissionIdByStringId, missionNameById,
                    skipAppLaunch: options.skipAppLaunch,
                });

            // ─── 14. Publish blueprint installation event ─────────────────────────
            await crossAppEventBus.publish({
                type: "BLUEPRINT_INSTALLED" as any,
                organizationId: orgId,
                sourceApp: "org_forge",
                payload: {
                    blueprintName: manifest.name,
                    version: manifest.version,
                    agentsProvisioned,
                    missionsProvisioned,
                    appsProvisioned,
                    appsRunning,
                    appsQueued,
                    appsFailedToLaunch,
                },
            });

            const summary = {
                success: true,
                installedApp: manifest.name,
                agentsProvisioned,
                missionsProvisioned,
                templatesProvisioned,
                datasetsProvisioned,
                integrationsProvisioned,
                formsProvisioned,
                gatesProvisioned,
                pipelinesProvisioned,
                pipelineStepsProvisioned,
                agentDeploymentsProvisioned,
                humanRolesProvisioned,
                appsProvisioned,
                appsRunning,
                appsQueued,
                appsFailedToLaunch,
                appLaunchDetails,
                cycleId,
                warnings,
            };
            logger.info(`[OrgForge] Install complete: ${JSON.stringify({
                ...summary,
                warningCount: warnings.length,
                warnings: undefined,
            })}`);
            
            // Finish observability span
            enhancedObservabilityService.finishSpan(spanId, "ok");
            
            return summary;

        } catch (error: any) {
            logger.error(`[OrgForge] Failed to install Cycle App: ${error.message}`);
            // Best-effort cleanup of anything we managed to provision before failing.
            // Uses the cycle-app name as the predicate — won't touch other apps or other orgs.
            try {
                const manifestName = ((yaml.load(yamlContent) as any) || {}).name;
                if (manifestName) {
                    await this.cleanupFailedInstall(orgId, manifestName);
                }
            } catch (cleanupErr: any) {
                logger.warn(`[OrgForge] Cleanup after failed install also threw: ${cleanupErr.message}`);
            }
            enhancedObservabilityService.finishSpan(spanId, "error");
            throw error;
        }
    }

    /**
     * Step 13: rehydrate App Forge apps from the manifest, wire mission/module
     * bindings, and launch them in bounded batches. Extracted verbatim from
     * installCycleApp; consumes the mission-id maps built by earlier steps.
     */
    /**
     * Step 1: the org-scoped ai_provider credential. Updated in place when one
     * already exists so re-installing a blueprint does not mint duplicates.
     * Returns the credential row id, which step 3 stamps onto every agent job.
     */
    private async provisionAiProviderCredential(ctx: InstallContext): Promise<number> {
        const { orgId, manifest } = ctx;
        let cred = await db.select().from(credentials)
            .where(and(eq(credentials.type, "ai_provider"), eq(credentials.organizationId, orgId)))
            .limit(1);
        let credentialId: number;
        
        // Read ai_provider configuration from manifest if present
        const aiProviderConfig = manifest.ai_provider || {};
        const aiProvider = aiProviderConfig.provider || "anthropic";
        const aiEnvVarName = aiProviderConfig.api_key || "${ENV.AI_API_KEY}";
        const aiEnvVar = extractEnvVarName(aiEnvVarName) || "AI_API_KEY";
        
        if (cred.length > 0) {
            credentialId = cred[0].id;
            // Update existing credential with new configuration
            await db.update(credentials)
                .set({
                    envVarName: aiEnvVar,
                    metadata: {
                        provider: aiProvider,
                        default_model: aiProviderConfig.default_model || "claude-3.5-sonnet",
                        fallback_model: aiProviderConfig.fallback_model || "gpt-4o-mini",
                        temperature: aiProviderConfig.temperature || 0.7,
                        max_tokens: aiProviderConfig.max_tokens || 4096,
                        timeout_ms: aiProviderConfig.timeout_ms || 120000,
                    }
                })
                .where(eq(credentials.id, credentialId));
        } else {
            const [newCred] = await db.insert(credentials).values({
                name: `${manifest.name} — AI Provider`,
                type: "ai_provider",
                envVarName: aiEnvVar,
                metadata: {
                    provider: aiProvider,
                    default_model: aiProviderConfig.default_model || "claude-3.5-sonnet",
                    fallback_model: aiProviderConfig.fallback_model || "gpt-4o-mini",
                    temperature: aiProviderConfig.temperature || 0.7,
                    max_tokens: aiProviderConfig.max_tokens || 4096,
                    timeout_ms: aiProviderConfig.timeout_ms || 120000,
                },
                organizationId: orgId,
                createdBy: "system"
            }).returning();
            credentialId = newCred.id;
        }
        return credentialId;
    }

    /**
     * Step 3: agent jobs, with system prompt content inlined rather than stored as
     * a path. Populates ctx.agentNameById and ctx.agentJobIdById, which steps 7b
     * (pipeline steps) and 8 (schedules) read to wire their agent references.
     */
    private async provisionAgents(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, archiveMap, cycleAppSlug, credentialId, agentNameById, agentJobIdById } = ctx;
        let agentsProvisioned = 0;
        if (manifest.agents && Array.isArray(manifest.agents)) {
            for (const agent of manifest.agents) {
                const agentName = agent.name || agent.id;
                agentNameById[agent.id] = agentName;

                // Inline system prompt content (don't just store the path)
                let systemPromptContent: string | null = null;
                if (typeof agent.system_prompt === "string") {
                    if (agent.system_prompt.startsWith("file://")) {
                        const { content, error } = await readFileSafe(agent.system_prompt, archiveMap);
                        if (content) {
                            systemPromptContent = content;
                        } else {
                            warnings.push(`Agent "${agent.id}" system prompt could not be loaded from ${agent.system_prompt}: ${error}`);
                            systemPromptContent = `# ${agent.name}\n\n${agent.soul_profile?.legend ?? agent.description ?? "No system prompt available."}`;
                        }
                    } else {
                        systemPromptContent = agent.system_prompt;
                    }
                }

                // Per-agent max_iterations takes precedence over global guardrail
                const effectiveMaxIterations = agent.max_iterations
                    ?? manifest.guardrails?.max_thrashing_iterations
                    ?? 10;

                // Per-agent token_budget takes precedence over global budget
                const effectiveTokenBudget = agent.token_budget
                    ?? manifest.guardrails?.token_budget_per_ticket
                    ?? manifest.guardrails?.token_budget_per_launch
                    ?? 500000;

                // Blueprint-declared intake form: agents[].intake_form names a
                // manifest.forms[] entry. Carried onto the job config so the
                // deployment form manifest (and its deterministic initial-turn
                // path) serves it — same ownership model as assetForms below.
                const intakeFormResolution = resolveAgentIntakeForm(agent, manifest.forms);
                if (intakeFormResolution.warning) warnings.push(intakeFormResolution.warning);

                const agentConfig = {
                    credentialId,
                    provider: "openai",
                    model: agent.model || "claude-3.5-sonnet",
                    goal: agent.soul_profile?.legend || agent.description || "Execute SDLC activities",
                    persona: "generic",
                    systemPrompt: systemPromptContent,
                    systemPromptSource: typeof agent.system_prompt === "string" ? agent.system_prompt : null,
                    temperature: agent.temperature ?? 0.7,
                    allowedTools: agent.tools || [],
                    permissions: agent.permissions || [],
                    allowedDelegations: agent.allowed_delegations || [],
                    boundaries: agent.boundaries || [],
                    role: agent.role || "worker",
                    soulProfile: {
                        archetype: agent.soul_profile?.archetype ?? null,
                        legend: agent.soul_profile?.legend ?? null,
                        traits: agent.soul_profile?.traits ?? {},
                    },
                    maxIterations: effectiveMaxIterations,
                    tokenBudget: effectiveTokenBudget,
                    executionStrategy: agent.execution_strategy ?? null,
                    // Blueprint-owned input form definitions (asset triage etc.).
                    // Carried through so the deployment form manifest is built from
                    // the blueprint rather than hardcoded defaults.
                    assetForms: agent.asset_forms ?? null,
                    intakeForm: intakeFormResolution.config,
                    // Blueprint-owned live grounding directive: { app_slug,
                    // collections[], max_rows_per_collection }. The agent chat
                    // endpoint reads these collections from the named app's org
                    // namespace and injects them so answers cite real rows.
                    grounding: agent.grounding ?? null,
                    // Parent-cycle tag mirrors the one stamped on cycle apps
                    // (see appDependencyMetadata). Without it, org-scoped agent
                    // jobs have no link to the blueprint that created them, so the
                    // App Arsenal can't group them under their cycle.
                    sourceCycleSlug: cycleAppSlug,
                    sourceCycleName: manifest.name,
                };

                const [existingJob] = await db.select()
                    .from(jobs)
                    .where(and(eq(jobs.name, agentName), eq(jobs.organizationId, orgId)))
                    .limit(1);

                if (existingJob) {
                    // First-owner-wins: agent jobs are a shared pool keyed by
                    // name, so the same job is often reused across cycles. Keep
                    // the cycle tag of whichever cycle created it rather than
                    // letting the most recent installer reclaim it — otherwise
                    // shared agents would churn between Arsenal groups.
                    const existingCfg: any = existingJob.config ?? {};
                    if (existingCfg.sourceCycleSlug) {
                        agentConfig.sourceCycleSlug = existingCfg.sourceCycleSlug;
                        agentConfig.sourceCycleName = existingCfg.sourceCycleName ?? existingCfg.sourceCycleSlug;
                    }
                    await db.update(jobs)
                        .set({
                            config: agentConfig,
                            description: agent.description || existingJob.description,
                            updatedAt: new Date()
                        })
                        .where(eq(jobs.id, existingJob.id));
                    agentJobIdById[agent.id] = existingJob.id;
                } else {
                    const [newJob] = await db.insert(jobs).values({
                        name: agentName,
                        type: "ai_agent",
                        tool: "None",
                        description: agent.description || `AI Agent: ${agentName}`,
                        config: agentConfig,
                        organizationId: orgId,
                        createdBy: "system",
                        isActive: true
                    }).returning({ id: jobs.id });
                    agentJobIdById[agent.id] = newJob.id;
                }

                try {
                    await ensureAgentIdentityForBlueprintAgent({
                        organizationId: orgId,
                        agentId: String(agentJobIdById[agent.id]),
                        displayName: agentName,
                        ownerId: "system",
                        environment: "prod",
                        status: "active",
                        tools: Array.isArray(agent.tools) ? agent.tools : [],
                        permissions: Array.isArray(agent.permissions) ? agent.permissions : [],
                        metadata: {
                            principalType: "job",
                            source: "cycle_blueprint",
                            cycleSlug: cycleAppSlug,
                            cycleName: manifest.name,
                            blueprintAgentId: agent.id,
                            role: agent.role || "worker",
                        },
                        createdBy: "system",
                    });
                } catch (error: any) {
                    warnings.push(`Agent "${agent.id}" governance identity could not be provisioned: ${error?.message ?? error}`);
                }
                agentsProvisioned++;
            }
        }
        return agentsProvisioned;
    }

    /**
     * Step 7: mission templates. Populates ctx.missionNameById, which step 13
     * reads when building the cycle dependency gates.
     */
    private async provisionMissionTemplates(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, missionNameById } = ctx;
        let missionsProvisioned = 0;
        if (manifest.missions && Array.isArray(manifest.missions)) {
            for (const mission of manifest.missions) {
                missionNameById[mission.id] = mission.name;

                const [existingTemplate] = await db.select()
                    .from(missionTemplates)
                    .where(and(eq(missionTemplates.name, mission.name), eq(missionTemplates.organizationId, orgId)))
                    .limit(1);

                const config = {
                    id: mission.id,
                    environment: mission.environment || "planning",
                    trigger: mission.trigger || { type: "manual" },
                    primaryAgent: mission.primary_agent,
                    executionStrategy: mission.execution_strategy ?? (mission.sequence?.length ? "pre_planned" : "rolling_wave"),
                    estimatedDurationHours: mission.estimated_duration_hours ?? null,
                    inputs: mission.inputs ?? [],
                    outputs: mission.outputs ?? [],
                    sequence: (mission.sequence || []).map((step: any, idx: number) => ({
                        order: idx,
                        stepCode: step.step_code ?? `STEP-${idx + 1}`,
                        action: step.action,
                        description: step.description ?? null,
                        template: step.template ?? null,
                        tool: step.tool ?? null,
                        agentOverride: step.agent ?? null,
                        requiresHuman: step.requires_human === true,
                        formRef: step.form_ref ?? null,
                        routingChannel: step.routing_channel ?? null,
                        onReject: step.on_reject ?? null,
                        onFail: step.on_fail ?? null,
                        input: step.input ?? null,
                        inputs: step.inputs ?? null,
                        output: step.output ?? null,
                        outputs: step.outputs ?? null,
                        estimatedDurationMinutes: step.estimated_duration_minutes ?? null,
                        tokenBudget: step.token_budget ?? null,
                    })),
                };

                if (existingTemplate) {
                    await db.update(missionTemplates)
                        .set({
                            config,
                            description: mission.description || existingTemplate.description,
                            version: manifest.version || existingTemplate.version
                        })
                        .where(eq(missionTemplates.id, existingTemplate.id));
                } else {
                    await db.insert(missionTemplates).values({
                        name: mission.name,
                        description: mission.description || `Mission: ${mission.name}`,
                        config,
                        version: manifest.version || "1.0.0",
                        organizationId: orgId,
                        createdBy: "system"
                    });
                }
                missionsProvisioned++;
            }
        }
        return missionsProvisioned;
    }

    /**
     * Step 10: human roles — teams and their memberships.
     */
    private async provisionHumanRoles(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings } = ctx;
        let humanRolesProvisioned = 0;
        if (manifest.human_roles && typeof manifest.human_roles === "object") {
            const teamName = manifest.human_roles.team || "Default Team";
            
            // Find or create the team
            const [existingTeam] = await db.select()
                .from(teams)
                .where(and(
                    eq(teams.name, teamName),
                    eq(teams.organizationId, orgId)
                ))
                .limit(1);

            let teamId: number;
            if (existingTeam) {
                teamId = existingTeam.id;
            } else {
                const [newTeam] = await db.insert(teams).values({
                    name: teamName,
                    description: `Team for ${manifest.name}`,
                    organizationId: orgId,
                    metadata: {
                        source: "cycle_app",
                        blueprint: manifest.name,
                    },
                    createdBy: "system"
                }).returning({ id: teams.id });
                teamId = newTeam.id;
            }

            // Provision team members
            if (manifest.human_roles.members && Array.isArray(manifest.human_roles.members)) {
                for (const member of manifest.human_roles.members) {
                    if (!member.user_id || !member.role) {
                        warnings.push(`Human role member missing user_id or role - skipped`);
                        continue;
                    }

                    const userId = extractEnvVarName(member.user_id) || member.user_id;

                    // Validate user exists AND is a member of this org. Otherwise we'd be
                    // granting cross-org access by assigning a foreign user to an org's team.
                    const { userOrgs } = await import("@shared/schema/index.js");
                    const [orgMember] = await db.select({ userId: users.id })
                        .from(users)
                        .leftJoin(userOrgs, eq(userOrgs.userId, users.id))
                        .where(and(
                            eq(users.id, userId),
                            or(eq(users.defaultOrgId, orgId), eq(userOrgs.orgId, orgId))
                        ))
                        .limit(1);

                    if (!orgMember) {
                        warnings.push(`User "${userId}" is not a member of org ${orgId} - skipping role assignment for ${member.role}`);
                        continue;
                    }
                    
                    const [existingMember] = await db.select()
                        .from(teamMembers)
                        .where(and(
                            eq(teamMembers.teamId, teamId),
                            eq(teamMembers.userId, userId)
                        ))
                        .limit(1);

                    if (existingMember) {
                        await db.update(teamMembers)
                            .set({
                                role: member.role,
                                permissions: member.permissions || [],
                            })
                            .where(eq(teamMembers.id, existingMember.id));
                    } else {
                        await db.insert(teamMembers).values({
                            teamId,
                            userId,
                            role: member.role,
                            permissions: member.permissions || [],
                        });
                    }
                    humanRolesProvisioned++;
                }
            }
        }
        return humanRolesProvisioned;
    }

    /**
     * Step 7b: one pipeline per mission, with each mission step becoming a
     * pipelineSteps row pointing at the agent that should run it. Reads the agent
     * maps from step 3 and populates ctx.dbMissionIdByStringId for steps 8 and 13.
     */
    private async provisionPipelines(ctx: InstallContext): Promise<{ pipelinesProvisioned: number; pipelineStepsProvisioned: number }> {
        const { orgId, manifest, warnings, cycleAppSlug, agentNameById, agentJobIdById, dbMissionIdByStringId, pipelineIdByMissionId } = ctx;
        let pipelinesProvisioned = 0;
        let pipelineStepsProvisioned = 0;
        if (manifest.missions && Array.isArray(manifest.missions)) {
            for (const mission of manifest.missions) {
                const pipelineName = `${manifest.name} — ${mission.name}`;
                const triggerType = (() => {
                    const t = mission.trigger;
                    if (typeof t === "string") return "event"; // on_success(...)
                    if (t?.type === "schedule") return "schedule";
                    if (t?.type === "webhook") return "webhook";
                    if (t?.type === "manual") return "manual";
                    return "manual";
                })();

                const [existingPipeline] = await db.select({ id: pipelines.id })
                    .from(pipelines)
                    .where(and(eq(pipelines.name, pipelineName), eq(pipelines.organizationId, orgId)))
                    .limit(1);

                let pipelineId: number;
                if (existingPipeline) {
                    pipelineId = existingPipeline.id;
                    // Wipe existing steps so re-install gives a clean ordering
                    await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId));
                } else {
                    const [newPipeline] = await db.insert(pipelines).values({
                        name: pipelineName,
                        description: mission.description || `Pipeline backing mission: ${mission.name}`,
                        triggerType,
                        labels: {
                            cycleApp: manifest.name,
                            missionId: mission.id,
                            environment: mission.environment ?? null,
                        },
                        organizationId: orgId,
                        createdBy: "system",
                        isActive: true,
                    }).returning({ id: pipelines.id });
                    pipelineId = newPipeline.id;
                    pipelinesProvisioned++;
                }

                pipelineIdByMissionId[mission.id] = pipelineId;

                const sequence = mission.sequence || [];
                if (sequence.length === 0) continue;

                const stepRows = sequence.map((step: any, idx: number) => {
                    const agentRef = step.agent ?? mission.primary_agent;
                    const jobId = agentRef ? agentJobIdById[agentRef] : null;
                    if (agentRef && !jobId) {
                        warnings.push(`Mission "${mission.id}" step ${idx} references agent "${agentRef}" but no matching agent job exists`);
                    }
                    return {
                        pipelineId,
                        jobId: jobId ?? null,
                        order: idx,
                        outputName: step.output ?? null,
                        runOnCondition: "on_success" as const,
                        onFailureAction: step.on_fail ? "Execute Fallback Job" as const : "Stop Pipeline" as const,
                        toolName: step.tool ?? null,
                        moduleType: step.tool ? "tool" as const : null,
                        toolArguments: {
                            stepCode: step.step_code ?? `STEP-${idx + 1}`,
                            action: step.action,
                            template: step.template ?? null,
                            input: step.input ?? null,
                            requiresHuman: step.requires_human === true,
                            routingChannel: step.routing_channel ?? null,
                            onReject: step.on_reject ?? null,
                            onFail: step.on_fail ?? null,
                        },
                    };
                });
                await db.insert(pipelineSteps).values(stepRows);
                pipelineStepsProvisioned += stepRows.length;

                // Pre-create (or reuse) a "draft" mission instance so it's visible
                // on the dashboard immediately. Idempotency: each mission backs
                // exactly one pipeline (reused idempotently above), so we key the
                // mission off workflowBlueprint.pipelineId. Without this, every
                // re-install minted a NEW mission row — orphaning the prior install's
                // bindings/runs and desyncing the cycle→app wiring (bindings and
                // cycleBlueprints would point at a different mission id than the one
                // the mission-bindings endpoint resolves), so apps stopped showing.
                const missionFields = {
                    name: mission.name,
                    objective: mission.description || mission.name,
                    executionStrategy: mission.execution_strategy ?? (mission.sequence?.length ? "pre_planned" : "rolling_wave"),
                    workflowBlueprint: { pipelineId },
                };
                const [existingMission] = await db.select({ id: missions.id })
                    .from(missions)
                    .where(and(
                        eq(missions.organizationId, orgId),
                        sql`${missions.workflowBlueprint}->>'pipelineId' = ${String(pipelineId)}`,
                    ))
                    .limit(1);
                let dbMissionId: number;
                if (existingMission) {
                    await db.update(missions).set(missionFields).where(eq(missions.id, existingMission.id));
                    dbMissionId = existingMission.id;
                } else {
                    const [newMission] = await db.insert(missions).values({
                        ...missionFields,
                        organizationId: orgId,
                        createdBy: "system",
                        status: "draft",
                        isScheduled: false,
                    }).returning({ id: missions.id });
                    dbMissionId = newMission.id;
                }
                dbMissionIdByStringId[mission.id] = dbMissionId;
            }
        }
        return { pipelinesProvisioned, pipelineStepsProvisioned };
    }

    /**
     * Step 7c: agent deployments for blueprint-declared public agents.
     *
     * `agents[].publish_as_public_agent` declares an agentDeployments row —
     * the standalone chat surface (/a/<slug>) where the deployment form
     * manifest's servesInitialTurn entry is the agent's first contact. Without
     * this step the YAML key was inert: agent jobs existed but no deployment
     * ever carried their intakeForm/assetForms into a live surface.
     *
     * Runs after provisionPipelines so allowedPipelineIds can bind the
     * pipelines whose mission names this agent as primary (or a step agent).
     * The manifest + fallback derivation order matches the deploy route and
     * the rescue-dispatch seed: upsert → updateManifest → derive, because
     * fallback routes are read off the persisted formManifest.
     */
    private async provisionAgentDeployments(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, agentJobIdById, agentNameById, pipelineIdByMissionId } = ctx;
        if (!Array.isArray(manifest.agents)) return 0;
        let deployed = 0;
        for (const agent of manifest.agents) {
            const pub = agent.publish_as_public_agent;
            if (!pub || typeof pub !== "object") continue;
            const jobId = agentJobIdById[agent.id];
            if (!jobId) {
                warnings.push(`Agent "${agent.id}" declares publish_as_public_agent but has no provisioned job — skipped`);
                continue;
            }
            const slug = typeof pub.slug === "string" ? pub.slug.trim().toLowerCase() : "";
            if (!/^[a-z0-9-]{3,}$/.test(slug)) {
                warnings.push(`Agent "${agent.id}" publish_as_public_agent needs a slug matching /^[a-z0-9-]{3,}$/ — skipped`);
                continue;
            }
            try {
                const { AgentDeploymentService } = await import("@domain/agents/agent-deployment.service.js");
                const { agentFallbackService } = await import("@domain/agents/agent-fallback.service.js");

                // Slugs are globally unique, not org-scoped: never take over a
                // deployment that belongs to a different job.
                const bySlug = await AgentDeploymentService.getBySlug(slug);
                if (bySlug && bySlug.jobId !== jobId) {
                    warnings.push(`publish_as_public_agent slug "${slug}" is owned by another deployment — skipped for agent "${agent.id}"`);
                    continue;
                }

                const pipelineIds = new Set<number>();
                for (const mission of manifest.missions ?? []) {
                    const involved = mission.primary_agent === agent.id
                        || (Array.isArray(mission.sequence) && mission.sequence.some((s: any) => s?.agent === agent.id));
                    const pipelineId = pipelineIdByMissionId[mission.id];
                    if (involved && pipelineId) pipelineIds.add(pipelineId);
                }

                // Opening an agent to the internet must be declared, never implied.
                const accessPolicy = ["public", "password", "internal_only"].includes(pub.access_policy)
                    ? pub.access_policy
                    : "internal_only";
                const existing = await AgentDeploymentService.getByJobId(jobId, orgId);
                const deployment = await AgentDeploymentService.upsert({
                    jobId,
                    organizationId: orgId,
                    slug,
                    title: typeof pub.title === "string" && pub.title.trim() ? pub.title.trim() : (agentNameById[agent.id] ?? slug),
                    description: pub.description ?? agent.description ?? agent.soul_profile?.legend ?? null,
                    welcomeMessage: pub.welcome_message ?? null,
                    accessPolicy,
                    isActive: true,
                    allowedPipelineIds: [...pipelineIds],
                    allowedTools: Array.isArray(agent.tools) ? agent.tools : [],
                    soulArchetype: agent.soul_profile?.archetype ?? undefined,
                    legend: agent.soul_profile?.legend ?? null,
                    createdBy: existing ? undefined : "system",
                });

                // updateManifest reads the job's intakeForm/assetForms and the
                // deployment's allowedPipelineIds; derive() then rebuilds the
                // fallback routes off the persisted manifest.
                await AgentDeploymentService.updateManifest(deployment.id);
                await agentFallbackService.derive(deployment.id);
                deployed++;
            } catch (err: any) {
                warnings.push(`publish_as_public_agent for agent "${agent.id}" failed: ${err.message}`);
            }
        }
        return deployed;
    }

    /**
     * Step 8: schedules, linked to the mission a "trigger_mission:<id>" action
     * names. The schedule executor only launches a mission when missionId is
     * set, so the linkage is resolved here from ctx.dbMissionIdByStringId.
     */
    private async provisionSchedules(ctx: InstallContext): Promise<void> {
        const { orgId, manifest, warnings, agentNameById, dbMissionIdByStringId } = ctx;
        if (manifest.schedules && Array.isArray(manifest.schedules)) {
            for (const schedule of manifest.schedules) {
                const patternString = {
                    cron: schedule.cron,
                    action: schedule.action ?? "mission-trigger",
                    agent: schedule.agent ?? null,
                };

                // Resolve a target mission when the schedule action encodes one
                // (e.g. "trigger_mission:mission-ingest"). The schedule executor
                // launches a mission only when scheduledJob.missionId is set, so we
                // link it here using the mission-id map built above. Bare actions
                // like "mission-trigger" leave missionId null (unchanged behavior).
                let scheduleMissionId: number | null = null;
                const scheduleActionStr = typeof schedule.action === "string" ? schedule.action : "";
                const missionRefMatch = scheduleActionStr.match(/^trigger_mission:(.+)$/);
                if (missionRefMatch) {
                    const missionStringId = missionRefMatch[1].trim();
                    const resolvedMissionId = dbMissionIdByStringId[missionStringId];
                    if (resolvedMissionId) {
                        scheduleMissionId = resolvedMissionId;
                    } else {
                        warnings.push(`Schedule "${schedule.id}" references unknown mission "${missionStringId}" - missionId not linked`);
                    }
                }

                const [existingSchedule] = await db.select()
                    .from(schedules)
                    .where(and(eq(schedules.name, schedule.id), eq(schedules.organizationId, orgId)))
                    .limit(1);

                let dbScheduleId: number;
                if (existingSchedule) {
                    await db.update(schedules)
                        .set({ patternString })
                        .where(eq(schedules.id, existingSchedule.id));
                    dbScheduleId = existingSchedule.id;
                } else {
                    const [newSchedule] = await db.insert(schedules).values({
                        name: schedule.id,
                        description: `Auto-generated schedule for ${schedule.id}`,
                        pattern: 4, // Cron
                        patternString,
                        organizationId: orgId,
                        createdBy: "system"
                    }).returning();
                    dbScheduleId = newSchedule.id;
                }

                const [existingJob] = await db.select()
                    .from(scheduledJobs)
                    .where(and(eq(scheduledJobs.name, `Trigger ${schedule.id}`), eq(scheduledJobs.organizationId, orgId)))
                    .limit(1);

                if (!existingJob) {
                    await db.insert(scheduledJobs).values({
                        name: `Trigger ${schedule.id}`,
                        scheduleId: dbScheduleId,
                        missionId: scheduleMissionId,
                        triggerType: "Schedule",
                        isActive: true,
                        parameterValues: { agent: schedule.agent ?? null, action: schedule.action ?? "mission-trigger" },
                        organizationId: orgId,
                        createdBy: "system"
                    });
                } else if (scheduleMissionId && existingJob.missionId !== scheduleMissionId) {
                    // Idempotent reinstall: backfill/repair the mission linkage.
                    await db.update(scheduledJobs)
                        .set({ missionId: scheduleMissionId })
                        .where(eq(scheduledJobs.id, existingJob.id));
                }
            }
        }
    }

    /**
     * Step 9: org settings — budget guardrail, knowledge graph and
     * observability configuration merged onto the org's settings row.
     */
    private async provisionOrgSettings(ctx: InstallContext): Promise<void> {
        const { orgId, manifest, warnings } = ctx;
        const [existingSettings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, orgId))
            .limit(1);

        const settingsUpdate: Record<string, any> = {
            knowledgeStoreEnabled: true,
            knowledgeGraphEnabled: true,
        };

        // Budget guardrail
        if (manifest.guardrails) {
            const rawBudget = manifest.guardrails.token_budget_per_ticket
                ?? manifest.guardrails.token_budget_per_launch
                ?? null;
            const budgetLimit = rawBudget
                ? String(rawBudget / 1000)
                : "100.00";
            settingsUpdate.monthlyBudgetUsd = budgetLimit;
        }

        // Knowledge graph configuration
        if (manifest.knowledge_graph) {
            const kgConfig = manifest.knowledge_graph;
            settingsUpdate.knowledgeGraphConfig = {
                vectorDb: kgConfig.vector_db || {},
                embedding: kgConfig.embedding || {},
                similarityThreshold: kgConfig.similarity_threshold || 0.7,
                maxResults: kgConfig.max_results || 10,
            };
        }

        // Observability configuration
        if (manifest.observability) {
            const obsConfig = manifest.observability;
            settingsUpdate.observabilityConfig = {
                logging: obsConfig.logging || { level: "info", format: "json", structured: true },
                metrics: obsConfig.metrics || { enabled: true, interval_seconds: 60 },
                tracing: obsConfig.tracing || { enabled: true, sample_rate: 0.1 },
            };
        }

        // Quality gates configuration
        if (manifest.quality_gates) {
            const qgConfig = manifest.quality_gates;
            settingsUpdate.qualityGatesConfig = {
                testCoverage: qgConfig.test_coverage || { minimum: 80, threshold: "warning" },
                securityScan: qgConfig.security_scan || { enabled: true, severity_threshold: "high" },
                dependencyAudit: qgConfig.dependency_audit || { enabled: true, fail_on_vulnerabilities: true },
                codeQuality: qgConfig.code_quality || { enabled: true, lint_rules: "strict", max_complexity: 15 },
            };
        }

        // Notification configuration
        if (manifest.notifications) {
            const notifConfig = manifest.notifications;
            settingsUpdate.notificationConfig = {
                email: notifConfig.email || { enabled: true, rate_limit_per_minute: 10 },
                slack: notifConfig.slack || { thread_responses: true, mention_on_critical: true },
                escalationTimeoutMinutes: notifConfig.escalation_timeout_minutes || 30,
                digestEnabled: notifConfig.digest_enabled || true,
                digestIntervalHours: notifConfig.digest_interval_hours || 4,
            };
        }

        // Deployment configuration
        if (manifest.deployment) {
            const deployConfig = manifest.deployment;
            settingsUpdate.deploymentConfig = {
                environments: deployConfig.environments || {},
                rollback: deployConfig.rollback || { enabled: true, automatic_on_failure: true, max_rollback_attempts: 3 },
                blueGreen: deployConfig.blue_green || { enabled: false },
            };
        }

        // Security & Compliance configuration
        if (manifest.org_customizations?.security) {
            const securityConfig = manifest.org_customizations.security;
            await securityComplianceService.enableSecurityFeatures(orgId, {
                auditLogging: securityConfig.audit_logging_enabled ?? true,
                encryptionEnabled: securityConfig.encryption_enabled ?? true,
                mfaRequired: securityConfig.mfa_required_for_critical ?? true,
                sessionTimeoutMinutes: securityConfig.session_timeout_minutes ?? 60,
                dataResidencyEnabled: securityConfig.data_residency_enabled ?? false,
                consentManagementEnabled: securityConfig.consent_management_enabled ?? false,
                rightToBeForgottenEnabled: securityConfig.right_to_be_forgotten_enabled ?? false,
                breachNotificationEnabled: securityConfig.breach_notification_enabled ?? false,
                phiEncryptionEnabled: securityConfig.phi_encryption_enabled ?? false,
                minimumNecessaryAccessEnabled: securityConfig.minimum_necessary_access_enabled ?? true,
                securityPolicyEnabled: securityConfig.security_policy_enabled ?? true,
                riskManagementEnabled: securityConfig.risk_management_enabled ?? true,
                assetManagementEnabled: securityConfig.asset_management_enabled ?? true,
                accessControlEnabled: securityConfig.access_control_enabled ?? true,
                businessContinuityEnabled: securityConfig.business_continuity_enabled ?? true,
            });
            logger.info(`[OrgForge] Security & Compliance features enabled for org ${orgId}`);
        }

        if (existingSettings) {
            await db.update(orgSettings)
                .set({ ...settingsUpdate, updatedAt: new Date() })
                .where(eq(orgSettings.id, existingSettings.id));
        } else {
            await db.insert(orgSettings).values({
                organizationId: orgId,
                ...settingsUpdate,
            });
        }
    }

    /**
     * Step 11a: MCP server configuration declared by the manifest.
     *
     * WARNING — this step currently has NO EFFECT, and did not before this method
     * was extracted either. It writes into the `settingsUpdate` object that step 9
     * builds, but step 9 has already persisted that object by the time this runs,
     * and nothing writes it again. `mcpServersConfig` also has zero readers
     * anywhere in the codebase.
     *
     * The local object below therefore reproduces the existing behaviour exactly:
     * the computed config is discarded. Kept rather than deleted so the manifest
     * key stays visible pending a decision to either persist and consume it, or
     * drop `mcp_servers` from the blueprint schema.
     */
    private async provisionMcpServers(ctx: InstallContext): Promise<void> {
        const { orgId, manifest, warnings } = ctx;
        const settingsUpdate: Record<string, any> = {};
        if (manifest.mcp_servers && typeof manifest.mcp_servers === "object") {
            for (const [serverName, serverConfig] of Object.entries(manifest.mcp_servers as Record<string, any>)) {
                if (!serverConfig || typeof serverConfig !== "object") continue;
                if (serverConfig.enabled === false) continue;

                // Store MCP server configuration in org settings metadata
                if (!settingsUpdate.mcpServersConfig) {
                    settingsUpdate.mcpServersConfig = {};
                }
                settingsUpdate.mcpServersConfig[serverName] = {
                    endpoint: serverConfig.endpoint,
                    tools: serverConfig.tools || [],
                    timeoutMs: serverConfig.timeout_ms || 30000,
                    allowedPaths: serverConfig.allowed_paths || [],
                };
            }
        }
    }

    /**
     * Step 11b: the operationalCycle row and its cycleBlueprints wiring, carrying
     * the manifest metadata, execution policy and schedule. Returns the cycle id,
     * which the DAG validation and dependency gates below both key off.
     */
    private async provisionOperationalCycle(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, cycleAppSlug, missionNameById, dbMissionIdByStringId } = ctx;
        let cycleId: number;
        const cycleMetadata: Record<string, any> = {
            source: "cycle_app",
            version: manifest.version || "1.0.0",
            recurrence: manifest.recurrence ?? null,
            durationDays: manifest.duration_days ?? manifest.durationDays ?? null,
            excludeWeekends: manifest.exclude_weekends ?? manifest.excludeWeekends ?? null,
            techStack: manifest.tech_stack ?? null,
            portfolioClassification: manifest.portfolio_classification ?? null,
            vsmTelemetry: manifest.vsm_telemetry ?? null,
            predictionIntelligence: manifest.prediction_intelligence ?? null,
            directories: manifest.directories ?? null,
            organizationalGuidelines: manifest.organizational_guidelines ?? null,
            guardrails: manifest.guardrails ?? null,
            escalations: manifest.escalations ?? null,
            mcpServers: manifest.mcp_servers ?? null,
            observability: manifest.observability ?? null,
            qualityGates: manifest.quality_gates ?? null,
            deployment: manifest.deployment ?? null,
            notifications: manifest.notifications ?? null,
            // Preserve UI metadata for cycle management interface
            uiMetadata: manifest.ui_metadata ?? null,
            follow_up_cycle: manifest.follow_up_cycle ?? null,
            follow_up_cycle_template_id: manifest.follow_up_cycle_template_id ?? null,
            blueprints: manifest.missions?.map((m: any) => {
                const canonicalDeps = cycleDagService.normalizeManifestMission(m, missionNameById);
                const dependencies = canonicalDeps
                    .filter(d => d.type !== "event_trigger" && !d.external)
                    .map(d => ({
                        blueprintName: d.upstream,
                        type: d.type,
                    }));

                return {
                    name: m.name,
                    objective: m.objective || m.description || m.name,
                    type: m.type || "mission",
                    dependencies,
                    environment: m.environment ?? null,
                    estimatedDurationHours: m.estimated_duration_hours ?? null,
                    inputs: m.inputs ?? null,
                    outputs: m.outputs ?? null,
                    dataFlows: m.data_flows ?? m.dataFlows ?? null,
                    resourcesRequired: m.resources_required ?? null,
                    uiMetadata: m.ui_metadata ?? null,
                    primaryAgent: m.primary_agent ?? null,
                    trigger: m.trigger ?? null,
                    sequence: m.sequence?.map((step: any) => ({
                        stepCode: step.step_code,
                        action: step.action,
                        description: step.description ?? null,
                        estimatedDurationMinutes: step.estimated_duration_minutes ?? null,
                        uiMetadata: step.ui_metadata ?? null,
                        agent: step.agent ?? null,
                        tool: step.tool ?? null,
                        template: step.template ?? null,
                        requiresHuman: step.requires_human ?? null,
                    })) ?? null,
                };
            }) ?? [],
        };

        // Normalize the optional concurrency policy (YAML snake_case → dispatcher
        // camelCase), mapping pool mission ids → resolved blueprint names.
        const ep = manifest.execution_policy;
        const executionPolicy = ep ? {
            ...(ep.max_parallel_missions != null ? { maxParallelMissions: ep.max_parallel_missions } : {}),
            ...(Array.isArray(ep.resource_pools) ? {
                resourcePools: ep.resource_pools.map((p: any) => ({
                    name: p.name,
                    capacity: p.capacity,
                    missions: (Array.isArray(p.missions) ? p.missions : []).map((m: string) => missionNameById[m] || m),
                })),
            } : {}),
        } : {};

        const durationDays = Number(manifest.duration_days ?? manifest.durationDays ?? 5);
        const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
        const recurrence = manifest.recurrence ?? "once";

        const [existingCycle] = await db
            .select({ id: operationalCycles.id })
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.organizationId, orgId),
                eq(operationalCycles.name, manifest.name)
            ))
            .limit(1);

                    if (existingCycle) {
            cycleId = existingCycle.id;
            await db.update(operationalCycles)
                .set({ 
                    metadata: cycleMetadata, 
                    executionPolicy, 
                    recurrence,
                    endDate,
                    updatedAt: new Date() 
                })
                .where(eq(operationalCycles.id, cycleId));
            logger.info(`[OrgForge] Cycle "${manifest.name}" exists (id=${cycleId}) — metadata refreshed`);
        } else {
            const [newCycle] = await db.insert(operationalCycles).values({
                name: manifest.name,
                description: manifest.description || null,
                objective: manifest.description || `Run the ${manifest.name} program`,
                status: "pending_approval",
                organizationId: orgId,
                createdBy: "system",
                priority: 3,
                budgetLimitUsd: "500.00",
                metadata: cycleMetadata,
                executionPolicy,
                recurrence,
                endDate,
            }).returning();
            cycleId = newCycle.id;
            logger.info(`[OrgForge] Created OperationalCycle "${manifest.name}" (id=${cycleId})`);
        }
        return cycleId;
    }

    /**
     * Validates the full mission dependency DAG at install time, across all
     * supported trigger formats, so a cyclic or dangling blueprint is rejected
     * before its gates are written.
     */
    private async validateDependencyDag(ctx: InstallContext): Promise<void> {
        const { orgId, manifest, warnings, cycleId, missionNameById, dbMissionIdByStringId } = ctx;
        // Catches cycles and self-dependencies before the cycle is ever launched,
        // and surfaces undeclared-upstream warnings across every trigger format
        // (string on_success(...) AND object {type:on_success, mission_ref:...}).
        if (manifest.missions && Array.isArray(manifest.missions)) {
            try {
                const dagBlueprints = manifest.missions.map((m: any) => ({
                    name: missionNameById[m.id] || m.name || String(m.id),
                    dependencies: cycleDagService.normalizeManifestMission(m, missionNameById),
                }));
                const dagReport = cycleDagService.validateDag(dagBlueprints);
                for (const e of dagReport.errors) {
                    warnings.push(`Cycle dependency error: ${e}`);
                    logger.warn(`[OrgForge] ${manifest.name}: ${e}`);
                }
                for (const w of dagReport.warnings) {
                    warnings.push(`Cycle dependency warning: ${w}`);
                    logger.warn(`[OrgForge] ${manifest.name}: ${w}`);
                }
            } catch (e: any) {
                logger.warn(`[OrgForge] DAG validation failed for ${manifest.name}: ${e.message}`);
            }
        }

        // Replace any existing blueprints + gates for this cycle to keep things deterministic on re-install
        await db.delete(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycleId));
        await db.delete(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, cycleId));

        if (manifest.missions && Array.isArray(manifest.missions)) {
            const blueprintRows = manifest.missions.map((m: any, idx: number) => {
                const canonicalDeps = cycleDagService.normalizeManifestMission(m, missionNameById);
                const dependencies = canonicalDeps
                    .filter(d => d.type !== "event_trigger" && !d.external)
                    .map(d => ({
                        blueprintName: d.upstream,
                        type: d.type,
                    }));

                return {
                    cycleId,
                    name: m.name,
                    objective: m.objective || m.description || m.name,
                    type: "mission" as const,
                    estimatedDays: 5,
                    dependencies,
                    config: {
                        missionId: dbMissionIdByStringId[m.id] ?? m.id,
                        environment: m.environment ?? null,
                        trigger: m.trigger ?? null,
                        primaryAgent: m.primary_agent ?? null,
                    },
                    metadata: { order: idx },
                };
            });
            if (blueprintRows.length > 0) {
                await db.insert(cycleBlueprints).values(blueprintRows);
            }
        }
    }

    /**
     * Step 13a: cycle dependency gates derived from every structural dependency
     * declared across the manifest's missions.
     */
    private async provisionDependencyGates(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, cycleId, missionNameById, dbMissionIdByStringId } = ctx;
        let gatesProvisioned = 0;
        const names = new Set(Object.values(missionNameById));
        if (manifest.missions && Array.isArray(manifest.missions)) {
            for (const m of manifest.missions) {
                const canonicalDeps = cycleDagService.normalizeManifestMission(m, missionNameById);
                const structuralDeps = canonicalDeps.filter(d => d.type !== "event_trigger" && !d.external);

                for (const dep of structuralDeps) {
                    const downstreamName = missionNameById[m.id];
                    const upstreamName = dep.upstream;

                    if (!downstreamName) {
                        warnings.push(`Dependency gate skipped: downstream mission "${m.id}" not declared in manifest`);
                        continue;
                    }
                    if (!names.has(upstreamName)) {
                        warnings.push(`Dependency gate skipped: upstream mission "${upstreamName}" (referenced by "${downstreamName}") not declared in manifest — downstream will run without waiting`);
                        continue;
                    }

                    await db.insert(cycleDependencyGates).values({
                        cycleId,
                        upstreamBlueprintName: upstreamName,
                        downstreamBlueprintName: downstreamName,
                        dependencyType: dep.type || "finish_to_start",
                        status: "waiting",
                    });
                    gatesProvisioned++;
                }
            }
        }

        // Pre-calculate the execution plan (topological waves + CPM critical path)
        try {
            const [freshCycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
            const freshBlueprints = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycleId));
            if (freshCycle && freshBlueprints.length > 0) {
                const { CycleManagerService } = await import("@domain/mission/core/cycle-manager.service.js");
                await CycleManagerService.prepareExecutionPlan(cycleId, freshBlueprints, freshCycle, orgId);
                logger.info(`[OrgForge] Pre-calculated execution plan for cycle ${cycleId}`);
            }
        } catch (err: any) {
            logger.warn(`[OrgForge] Failed to pre-calculate execution plan for cycle ${cycleId}: ${err.message}`);
        }
        return gatesProvisioned;
    }

    /**
     * Steps 4 and 5: document templates from the manifest, plus organizational
     * guidelines persisted as additional templates. Both feed one counter, so
     * they stay one unit.
     */
    private async provisionDocumentTemplates(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, archiveMap } = ctx;
        let templatesProvisioned = 0;
        if (manifest.templates && Array.isArray(manifest.templates)) {
            for (const template of manifest.templates) {
                const { content, error } = await readFileSafe(template.path, archiveMap);
                let finalContent: string;
                if (content) {
                    finalContent = content;
                } else {
                    warnings.push(`Template "${template.id}" could not be loaded from ${template.path}: ${error}`);
                    finalContent = `# ${template.id}\nPlaceholder — original at ${template.path} not found.`;
                }

                const [existingTemplate] = await db.select()
                    .from(documentTemplates)
                    .where(and(eq(documentTemplates.name, template.id), eq(documentTemplates.organizationId, orgId)))
                    .limit(1);

                if (existingTemplate) {
                    await db.update(documentTemplates)
                        .set({ content: finalContent, updatedAt: new Date() })
                        .where(eq(documentTemplates.id, existingTemplate.id));
                } else {
                    await db.insert(documentTemplates).values({
                        name: template.id,
                        description: `Document template for ${template.id}`,
                        source: "direct",
                        type: "markdown",
                        content: finalContent,
                        organizationId: orgId,
                        createdBy: "system"
                    });
                }
                templatesProvisioned++;
            }
        }

        // ─── 5. Organizational guidelines as additional templates ────────────
        if (manifest.organizational_guidelines && typeof manifest.organizational_guidelines === "object") {
            for (const [name, block] of Object.entries(manifest.organizational_guidelines as Record<string, any>)) {
                if (!block || typeof block !== "object" || !block.path) continue;
                if (block.required === false) continue; // Skip optional guidelines

                const { content, error } = await readFileSafe(block.path, archiveMap);
                if (!content) {
                    warnings.push(`Guideline "${name}" could not be loaded from ${block.path}: ${error}`);
                    continue;
                }

                const templateName = `guideline:${name}`;
                const [existing] = await db.select()
                    .from(documentTemplates)
                    .where(and(eq(documentTemplates.name, templateName), eq(documentTemplates.organizationId, orgId)))
                    .limit(1);

                if (existing) {
                    await db.update(documentTemplates)
                        .set({ content, updatedAt: new Date() })
                        .where(eq(documentTemplates.id, existing.id));
                } else {
                    await db.insert(documentTemplates).values({
                        name: templateName,
                        description: `Organizational guideline: ${name}`,
                        source: "direct",
                        type: "markdown",
                        content,
                        organizationId: orgId,
                        createdBy: "system"
                    });
                }
            }
        }
        return templatesProvisioned;
    }

    /**
     * Step 6: knowledge datasets declared by the manifest.
     */
    private async provisionKnowledgeDatasets(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, archiveMap } = ctx;
        let datasetsProvisioned = 0;
        if (manifest.knowledge_datasets && Array.isArray(manifest.knowledge_datasets)) {
            for (const ds of manifest.knowledge_datasets) {
                const [existing] = await db.select()
                    .from(datasets)
                    .where(and(eq(datasets.name, ds.id), eq(datasets.organizationId, orgId)))
                    .limit(1);

                const knowledgeConfig = {
                    source: ds.source,
                    vectorize: ds.vectorize === true,
                    primaryKey: ds.primary_key ?? null,
                    updateFrequency: ds.update_frequency ?? "manual",
                };
                const schemaMapping = ds.schema ?? {};

                if (existing) {
                    await db.update(datasets)
                        .set({ knowledgeConfig, schemaMapping, updatedAt: new Date() })
                        .where(eq(datasets.id, existing.id));
                } else {
                    await db.insert(datasets).values({
                        name: ds.id,
                        description: `Auto-provisioned dataset: ${ds.id}`,
                        organizationId: orgId,
                        tags: ["cycle_app", manifest.name],
                        knowledgeConfig,
                        schemaMapping,
                    });
                }
                datasetsProvisioned++;
            }
        }
        return datasetsProvisioned;
    }

    /**
     * Step 6b: dynamic HIL form definitions ingested from the manifest.
     */
    private async provisionDynamicForms(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings, archiveMap } = ctx;
        let formsProvisioned = 0;
        if (manifest.forms && Array.isArray(manifest.forms)) {
            for (const formDef of manifest.forms) {
                const formName = formDef.name || formDef.id;
                const fields = (formDef.fields || []).map((f: any) => ({
                    key: f.name,
                    label: f.label,
                    type: f.type,
                    required: f.required ?? true,
                    placeholder: f.placeholder ?? null,
                    options: f.options ?? null,
                }));

                const [existingForm] = await db.select()
                    .from(hilForms)
                    .where(and(
                        eq(hilForms.name, formName),
                        eq(hilForms.organizationId, orgId),
                        // Never overwrite a request or stored response that shares the name.
                        eq(hilForms.kind, "template")
                    ))
                    .limit(1);

                if (existingForm) {
                    const { reconcileTemplateForm } = await import("@shared/form-studio.js");
                    const reconciled = reconcileTemplateForm(existingForm, {
                        key: String(formDef.id ?? formName),
                        description: formDef.description || null,
                        fields,
                    });
                    if (reconciled.action === "overwrite") {
                        await db.update(hilForms)
                            .set({
                                description: formDef.description || null,
                                schema: { fields },
                                status: "active",
                                updatedAt: new Date(),
                            })
                            .where(eq(hilForms.id, existingForm.id));
                    } else if (reconciled.action === "hold") {
                        // Overwriting `schema` with `{ fields }` deleted a Form Studio
                        // form's pages, rules, results and tests. The template's
                        // changes are held on the form for its owner to apply instead.
                        const config = (existingForm.config ?? {}) as Record<string, any>;
                        await db.update(hilForms)
                            .set({
                                config: { ...config, formStudio: { ...(config.formStudio ?? {}), templateUpdate: reconciled.templateUpdate } },
                                updatedAt: new Date(),
                            })
                            .where(eq(hilForms.id, existingForm.id));
                        warnings.push(`Form "${formName}" was edited in Form Studio, so this template's changes to it were held for review instead of replacing it.`);
                    }
                } else {
                    await db.insert(hilForms).values({
                        name: formName,
                        description: formDef.description || null,
                        schema: { fields },
                        organizationId: orgId,
                        status: "active",
                        config: { formId: formDef.id }
                    });
                }
                formsProvisioned++;
            }
        }
        return formsProvisioned;
    }

    /**
     * Step 2: one credential row per active integration block. Fields other than
     * the auth token are stored on credentials.metadata, stamped with the cycle
     * app name so cleanupFailedInstall can find them again.
     */
    private async provisionIntegrationCredentials(ctx: InstallContext): Promise<number> {
        const { orgId, manifest, warnings } = ctx;
        let integrationsProvisioned = 0;
            if (manifest.integrations && typeof manifest.integrations === "object") {
                for (const [name, block] of Object.entries(manifest.integrations as Record<string, any>)) {
                    if (!isIntegrationActive(block)) continue;
                    const mapping = INTEGRATION_MAP[name];
                    if (!mapping) {
                        warnings.push(`Integration "${name}" has no known credential type mapping — skipped`);
                        continue;
                    }
                    const envVarName = extractEnvVarName(block[mapping.tokenField]);
                    if (!envVarName) {
                        warnings.push(`Integration "${name}" is active but its ${mapping.tokenField} field has no ${'${ENV.X}'} reference — credential not provisioned`);
                        continue;
                    }

                    // metadata = all fields except the token + the required/enabled flags
                    const metadata: Record<string, any> = {
                        _cycleAppName: manifest.name,
                        _integrationName: name,
                    };
                    for (const [k, v] of Object.entries(block)) {
                        if (k === mapping.tokenField || k === "required" || k === "enabled") continue;
                        const envName = extractEnvVarName(v);
                        metadata[k] = envName ? { envVarName: envName } : v;
                    }

                    const credName = `${manifest.name} — ${name}`;
                    const [existing] = await db.select().from(credentials)
                        .where(and(
                            eq(credentials.name, credName),
                            eq(credentials.organizationId, orgId)
                        )).limit(1);

                    if (existing) {
                        await db.update(credentials)
                            .set({ envVarName, metadata })
                            .where(eq(credentials.id, existing.id));
                    } else {
                        await db.insert(credentials).values({
                            name: credName,
                            type: mapping.type,
                            description: `Auto-provisioned by ${manifest.name} install`,
                            envVarName,
                            metadata,
                            organizationId: orgId,
                            createdBy: "system",
                        });
                    }
                    integrationsProvisioned++;
                }
            }
        return integrationsProvisioned;
    }

    private async provisionApps(args: {
        orgId: number;
        manifest: any;
        warnings: string[];
        archiveMap?: Map<string, string>;
        cycleAppSlug: string;
        dbMissionIdByStringId: Record<string, number>;
        missionNameById: Record<string, string>;
        skipAppLaunch?: boolean;
    }) {
        const { orgId, manifest, warnings, archiveMap, cycleAppSlug, dbMissionIdByStringId, missionNameById, skipAppLaunch } = args;
            let appsProvisioned = 0;
            // Collect app-launch THUNKS (deferred, not running). Executed in
            // bounded batches after the loop so concurrent next-build runs
            // can't collide on shared resources (npm cache, fs, CPU). The
            // user requirement is "operational on install"; the cost is a
            // bit more wall-clock time vs the original fire-and-forget pattern.
            const appLaunchTasks: Array<() => Promise<{ appId: number; slug: string; status: 'running' | 'queued' | 'failed'; error?: string }>> = [];
            if (manifest.apps && Array.isArray(manifest.apps)) {
                for (const appBlock of manifest.apps) {
                    if (!appBlock.id) {
                        warnings.push(`App block is missing 'id' - skipped`);
                        continue;
                    }

                    let rawSchemaStr: string | null = null;
                    let isSharedServer = false;
                    
                    if (appBlock.path) {
                        // Check if path is a shared server directory
                        if (appBlock.interaction_model === "shared-server" || appBlock.path.endsWith('/sdlc-workbench') || appBlock.path.includes('sdlc-workbench')) {
                            isSharedServer = true;
                            // Generate a basic schema for the shared server
                            const blueprintName = appBlock.blueprint || appBlock.id || "shared-workbench";
                            const sharedModules = Array.isArray(appBlock.workbench_modules) ? appBlock.workbench_modules : [];
                            const routes = sharedModules.length
                                ? sharedModules.map((m: any) => m.route || `/${m.id}`)
                                : ["/"];
                            // Derive a screen/slug manifest + a baseline development plan from the
                            // workbench_modules so the installed app is editable in the App Builder
                            // (the Developer tab renders the plan; refine uses it as its baseline;
                            // forge planning treats the manifest as the screen-structure override).
                            const screens = sharedModules.map((m: any) => ({
                                id: m.id,
                                name: m.name || m.id,
                                route: m.route || `/${m.id}`,
                                purpose: m.purpose || "",
                                editable: m?.cycle_manager?.app_builder_editable !== false,
                            }));
                            const vNextManifest = {
                                name: appBlock.name || blueprintName,
                                slug: appBlock.id || blueprintName,
                                version: "1.0.0",
                                description: appBlock.description || "",
                                framework: "nextjs",
                                screens,
                            };
                            const developmentPlan = {
                                overview: appBlock.description || `${appBlock.name || blueprintName} workbench`,
                                phases: [{
                                    name: "Installed baseline",
                                    description: "Scaffolded from the committed blueprint; edit any screen below via the App Builder.",
                                    tasks: screens.map((s: any) => `Screen: ${s.name} (${s.route})`),
                                }],
                                techStack: ["Next.js", "React", "TypeScript", "Tailwind CSS", "Recharts"],
                                integrationStrategy: "Reads/writes Oddjob datasets via the /api/oddjob proxy, triggers cycle missions, and routes human decisions through platform HIL forms.",
                                uxDescription: `Multi-surface workbench with persistent navigation across ${screens.length} screen(s): ${screens.map((s: any) => s.name).join(", ")}.`,
                                mockStrategy: {},
                            };
                            rawSchemaStr = JSON.stringify({
                                app: {
                                    name: appBlock.name || blueprintName,
                                    slug: appBlock.id || blueprintName,
                                    description: appBlock.description || `Shared workbench server for ${appBlock.name || blueprintName}`,
                                    framework: "nextjs",
                                    version: "1.0.0",
                                    organizationId: orgId,
                                    developerOrgId: orgId,
                                    isPublic: true,
                                    blueprint: blueprintName,
                                    vNextManifest,
                                    developmentPlan,
                                    config: {
                                        sharedServer: true,
                                        routes
                                    }
                                },
                                deployment: {
                                    buildCommand: "npm run build",
                                    startCommand: "npm run start",
                                    environment: "production",
                                    port: 3000
                                }
                            });
                        } else {
                            const { content, error } = await readFileSafe(appBlock.path, archiveMap);
                            if (error || !content) {
                                warnings.push(`App "${appBlock.id}" failed to load schema from path ${appBlock.path}: ${error}`);
                                continue;
                            }
                            rawSchemaStr = content;
                        }
                    } else if (appBlock.schema) {
                        if (typeof appBlock.schema === 'string') {
                            rawSchemaStr = appBlock.schema;
                        } else {
                            rawSchemaStr = JSON.stringify(appBlock.schema);
                        }
                    } else {
                        warnings.push(`App "${appBlock.id}" is missing 'schema' or 'path' - skipped`);
                        continue;
                    }
                    
                    if (!rawSchemaStr) continue;

                    // Templating
                    let templatedSchemaStr = rawSchemaStr.replace(/\{\{ORG_ID\}\}/g, orgId.toString());
                    
                    let dehydratedApp: any;
                    try {
                        dehydratedApp = JSON.parse(templatedSchemaStr);
                    } catch (e) {
                        warnings.push(`App "${appBlock.id}" contains invalid JSON schema - skipped`);
                        continue;
                    }

                    const appData = dehydratedApp.app;
                    const deploymentData = dehydratedApp.deployment;
                    const appCustomizations = appBlock.customizations || {};
                    const appDependencyMetadata = {
                        source: "cycle_app",
                        sourceCycleSlug: cycleAppSlug,
                        sourceCycleName: manifest.name,
                        sourceAppId: appBlock.id ?? appData?.slug,
                        sourceAppName: appBlock.name ?? appData?.name,
                        editableInAppBuilder: true,
                        dependentMissionIds: Array.isArray(appBlock.dependent_missions) ? appBlock.dependent_missions : [],
                        requiredRoles: Array.isArray(appBlock.required_roles) ? appBlock.required_roles : [],
                        environmentVariables: appBlock.environment_variables ?? {},
                        blueprint: appBlock.blueprint || null,
                        interactionModel: appBlock.interaction_model || "form-workbench",
                        appContract: appBlock.app_contract ?? null,
                        workbenchModules: Array.isArray(appBlock.workbench_modules) ? appBlock.workbench_modules : [],
                        blueprintBaselineVersion: appData?.version || "1.0.0",
                        // Set below, once the pre-copy author has been read off the manifest.
                        sourceDeveloperOrgId: null as number | null,
                    };

                    if (!appData || !appData.slug) {
                        warnings.push(`App "${appBlock.id}" schema is missing valid 'app' payload - skipped`);
                        continue;
                    }

                    // Capture who the manifest says built this BEFORE the copy claims
                    // authorship below. The id comes from whichever database exported
                    // the archive, so it is provenance rather than a usable reference —
                    // but losing it entirely is what makes an installed app
                    // indistinguishable from one this org wrote, and once a market
                    // exists that difference is who gets paid.
                    appDependencyMetadata.sourceDeveloperOrgId = appData.developerOrgId ?? null;

                    // Ensure app data belongs to the target org. This path deliberately
                    // creates a per-org COPY (see the org-suffixed slug below), so the
                    // installing org does own the row it gets. A marketplace purchase
                    // must NOT reuse this path: buying an app should add an
                    // app_deployments row against the seller's app, not fork it.
                    appData.organizationId = orgId;
                    appData.developerOrgId = orgId;
                    // A Forge copy is the org's own app — never a built-in, never a listing.
                    appData.distribution = "custom";
                    appData.blueprint = appBlock.blueprint || null;
                    appData.blueprintSlug = appBlock.blueprint || null;
                    // Always mark cycle-provisioned apps as public so they
                    // appear in the Global Market tab (listAvailableApps filters
                    // on isPublic = true). Individual orgs can make them private
                    // afterwards via the App Builder developer tab.
                    appData.isPublic = true;

                    // Store cycle provenance so App Arsenal and App Builder can
                    // treat these workbenches as editable members of a suite.
                    appData.config = {
                        ...(appData.config || {}),
                        cycleApp: appDependencyMetadata,
                        customizations: appCustomizations,
                    };

                    const blueprintSlug = appBlock.blueprint || manifest.id;
                    if (blueprintSlug) {
                        try {
                            const { knowledgeNodes } = await import("@shared/schema/index.js");
                            const [kgNode] = await db
                                .select()
                                .from(knowledgeNodes)
                                .where(
                                    and(
                                        eq(knowledgeNodes.label, "AppBlueprint"),
                                        eq(knowledgeNodes.externalId, `blueprint-${blueprintSlug}`)
                                    )
                                )
                                .limit(1);
                            if (kgNode && (kgNode.data as any)?.tokenizedUI) {
                                appData.config.tokenizedUI = (kgNode.data as any).tokenizedUI;
                                appData.dockerImage = null; // Bypass container flow
                                logger.info(`[OrgForge] Successfully loaded Tokenized UI layout for blueprint: ${blueprintSlug}`);
                            } else if (isSharedServer) {
                                const appName = appBlock.name || blueprintSlug || "Workbench";
                                appData.config.tokenizedUI = {
                                    type: "Dashboard",
                                    props: {
                                        title: `${appName} - Overview`,
                                        description: appBlock.description || `Dynamic Tokenized UI dashboard for ${appName}.`
                                    },
                                    layout: {
                                        type: "Grid",
                                        props: { columns: 3 },
                                        children: [
                                            {
                                                type: "StatCard",
                                                props: {
                                                    title: "Operational Status",
                                                    value: "Active",
                                                    description: "Systems online and healthy",
                                                    trend: "up"
                                                }
                                            },
                                            {
                                                type: "StatCard",
                                                props: {
                                                    title: "Pending Tasks",
                                                    value: "0",
                                                    description: "Awaiting review or decision",
                                                    trend: "neutral"
                                                }
                                            },
                                            {
                                                type: "StatCard",
                                                props: {
                                                    title: "Weekly Throughput",
                                                    value: "100%",
                                                    description: "Task completion rate",
                                                    trend: "up"
                                                }
                                            },
                                            {
                                                type: "Card",
                                                props: {
                                                    title: "Platform Overview",
                                                    description: "Activity log and compliance monitoring."
                                                },
                                                children: [
                                                    {
                                                        type: "DataTable",
                                                        props: {
                                                            columns: ["Task ID", "Assigned Agent", "Compliance Status"],
                                                            data: [
                                                                ["TASK-001", "ai-specialist", "Compliant"],
                                                                ["TASK-002", "ai-analyst", "Compliant"]
                                                            ]
                                                        }
                                                    }
                                                ]
                                            },
                                            {
                                                type: "Card",
                                                props: {
                                                    title: "Control Deck",
                                                    description: "Direct action interface for the workbench."
                                                },
                                                children: [
                                                    {
                                                        type: "FormInput",
                                                        props: {
                                                            id: "action_notes",
                                                            label: "Action Notes",
                                                            placeholder: "Enter details..."
                                                        }
                                                    },
                                                    {
                                                        type: "ActionButton",
                                                        props: {
                                                            label: "Dispatch Decision",
                                                            endpoint: "/api/pipelines",
                                                            method: "GET"
                                                        }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                };
                                appData.dockerImage = null; // Bypass container flow
                                logger.info(`[OrgForge] Dynamically generated Tokenized UI layout for shared-server app: ${blueprintSlug}`);
                            }
                        } catch (kgErr: any) {
                            logger.warn(`[OrgForge] Failed to retrieve tokenized UI from KG: ${kgErr.message}`);
                        }
                    }

                    appData.runtimeMetadata = {
                        ...(appData.runtimeMetadata || {}),
                        cycleApp: appDependencyMetadata,
                    };

                    // Look up an existing app for THIS org under either the original slug
                    // or the org-suffixed variant we'd have created on a prior conflict.
                    // No global probe → no cross-tenant slug enumeration.
                    const orgSuffixedSlug = `${appData.slug}-org${orgId}`;
                    const [existingApp] = await db.select().from(apps)
                        .where(and(
                            or(eq(apps.slug, appData.slug), eq(apps.slug, orgSuffixedSlug)),
                            eq(apps.organizationId, orgId)
                        )).limit(1);

                    let targetAppId: number;
                    if (existingApp) {
                        // Preserve whichever slug we'd already committed to
                        appData.slug = existingApp.slug;
                        // `apps.name` carries a GLOBAL unique constraint, and the INSERT
                        // branch below dodges cross-org collisions by suffixing the name
                        // with " (Org N)". Mirror that here: an app stored under the
                        // org-suffixed slug must keep the org-suffixed name, otherwise the
                        // update reverts it to the bare base name and collides with another
                        // org's install (apps_name_unique). A bare-slug app (the first org
                        // to claim the slug) keeps the unsuffixed name.
                        if (existingApp.slug === orgSuffixedSlug) {
                            appData.name = `${appData.name} (Org ${orgId})`;
                        }
                        await db.update(apps)
                            .set({
                                name: appData.name,
                                isPublic: true,
                                config: appData.config,
                                dockerImage: appData.config.tokenizedUI ? null : appData.dockerImage,
                                runtimeMetadata: appData.runtimeMetadata,
                                developmentPlan: appData.developmentPlan,
                                vNextManifest: appData.vNextManifest,
                                blueprint: appData.blueprint,
                                blueprintSlug: appData.blueprintSlug,
                                updatedAt: new Date()
                            })
                            .where(eq(apps.id, existingApp.id));
                        targetAppId = existingApp.id;
                    } else {
                        if (!appData.dockerImage && !appData.config.tokenizedUI) {
                            appData.dockerImage = `oddjob-app/${appData.slug}:v1`;
                        }
                        appData.slug = orgSuffixedSlug;
                        appData.name = `${appData.name} (Org ${orgId})`;
                        
                        try {
                            const [newApp] = await db.insert(apps).values(appData).returning();
                            targetAppId = newApp.id;
                        } catch (err: any) {
                            throw err;
                        }
                    }

                    if (deploymentData) {
                        deploymentData.appId = targetAppId;
                        deploymentData.organizationId = orgId;
                        deploymentData.config = {
                            ...(deploymentData.config || {}),
                            cycleApp: appDependencyMetadata,
                        };

                        // Inherit from YAML manifest with system-generated unique suffix
                        if (appBlock.id) {
                            const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                            deploymentData.publicSlug = `${appBlock.id}-${uniqueSuffix}`;
                        }
                        if (appBlock.name) deploymentData.title = appBlock.name;

                        // Automatically spin up the app
                        deploymentData.status = "active";
                        deploymentData.isPublished = true;
                        
                        const [existingDeployment] = await db.select().from(appDeployments)
                            .where(eq(appDeployments.appId, targetAppId)).limit(1);
                        if (existingDeployment) {
                            if (existingDeployment.publicSlug) {
                                deploymentData.publicSlug = existingDeployment.publicSlug;
                            }
                            try {
                                await db.update(appDeployments)
                                    .set(deploymentData)
                                    .where(eq(appDeployments.id, existingDeployment.id));
                            } catch (err: any) {
                                if (err.code === '23505' || err.cause?.code === '23505') { // Postgres unique_violation
                                    const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                                    deploymentData.publicSlug = `${appBlock.id || "app"}-${uniqueSuffix}`;
                                    await db.update(appDeployments)
                                        .set(deploymentData)
                                        .where(eq(appDeployments.id, existingDeployment.id));
                                } else {
                                    throw err;
                                }
                            }
                        } else {
                            if (!deploymentData.publicSlug) {
                                const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                                deploymentData.publicSlug = `${appData.slug}-pub-${uniqueSuffix}`;
                            }
                            try {
                                await db.insert(appDeployments).values(deploymentData);
                            } catch (err: any) {
                                // If publicSlug constraint fails, fallback to fresh random suffix
                                if (err.code === '23505' || err.cause?.code === '23505') { // Postgres unique_violation
                                    const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                                    deploymentData.publicSlug = `${appBlock.id || appData.slug}-${uniqueSuffix}`;
                                    await db.insert(appDeployments).values(deploymentData);
                                } else {
                                    throw err;
                                }
                            }
                        }

                        // Actually hydrate the app (spin up the Docker container via Mach 3).
                        // We collect the launch as a tracked promise instead of firing it
                        // and forgetting — the install must not return until every app
                        // has reached a terminal state. Each promise resolves with the
                        // outcome (running / queued / failed) so the caller can report it.
                        const launchAppId = targetAppId;
                        const launchSlug = appData.slug;
                        // Note: NOT invoked yet — pushed as a thunk and executed
                        // in batches below to cap concurrent next-build runs.
                        const launchTask = async (): Promise<{ appId: number; slug: string; status: 'running' | 'queued' | 'failed'; error?: string }> => {
                            // Imports hoisted so both the initial-launch and the
                            // post-forge retry paths have them in scope.
                            const { appRegistryService } = await import("../../apps/app-registry.service.js");
                            const { appForgeService } = await import("../../apps/app-forge.service.js");

                            // Check if it is a Tokenized UI app
                            const [appRecord] = await db.select().from(apps).where(eq(apps.id, launchAppId)).limit(1);
                            if (appRecord?.config && (appRecord.config as any).tokenizedUI) {
                                logger.info(`[OrgForge] App ${launchSlug} uses Tokenized UI framework. Marking active without container launch.`);
                                await db.update(appDeployments)
                                    .set({ status: "active", url: null })
                                    .where(eq(appDeployments.appId, launchAppId));
                                await db.update(apps)
                                    .set({ runtimeMetadata: { ...(appRecord.runtimeMetadata || {}), status: "running" } })
                                    .where(eq(apps.id, launchAppId));
                                return { appId: launchAppId, slug: launchSlug, status: 'running' };
                            }

                            try {
                                await appRegistryService.startApp(launchAppId, orgId);
                                return { appId: launchAppId, slug: launchSlug, status: 'running' };
                            } catch (err: any) {
                                if (err.message?.includes('not found') || err.message?.includes('Build required')) {
                                    logger.info(`[OrgForge] Image not found for app ${launchAppId}, queuing forge job...`);
                                    try {
                                        await db.update(appDeployments)
                                            .set({ status: "queued" })
                                            .where(eq(appDeployments.appId, launchAppId));
                                        await db.update(apps)
                                            .set({ runtimeMetadata: { ...(appData.runtimeMetadata || {}), status: "queued" } })
                                            .where(eq(apps.id, launchAppId));

                                        const resolvedBlueprint = appBlock.blueprint || manifest.id || "blueprint-import";
                                        // Await the forge so the install only returns once
                                        // the build is at least queued and scaffolding done.
                                        await appForgeService.forgeApp(resolvedBlueprint, {
                                            name: appData.name,
                                            slug: appData.slug,
                                            description: appData.description || `Auto-imported from ${manifest.name}`,
                                            organizationId: orgId,
                                            oddjobMissionId: 0,
                                            vNextManifest: appData.vNextManifest,
                                            interactionModel: appDependencyMetadata.interactionModel
                                        });
                                        // Try one more time to start now that the workspace exists.
                                        try {
                                            await appRegistryService.startApp(launchAppId, orgId);
                                            return { appId: launchAppId, slug: launchSlug, status: 'running' };
                                        } catch (retryErr: any) {
                                            return { appId: launchAppId, slug: launchSlug, status: 'queued', error: retryErr.message };
                                        }
                                    } catch (forgeErr: any) {
                                        logger.error(`[OrgForge] Forge queue failed for ${launchAppId}: ${forgeErr.message}`);
                                        return { appId: launchAppId, slug: launchSlug, status: 'queued', error: forgeErr.message };
                                    }
                                }
                                logger.error(`[OrgForge] Failed to auto-hydrate app ${launchAppId}: ${err.message}`);
                                try {
                                    await db.update(appDeployments)
                                        .set({ status: "failed" })
                                        .where(eq(appDeployments.appId, launchAppId));
                                    await db.update(apps)
                                        .set({ runtimeMetadata: { ...(appData.runtimeMetadata || {}), status: "stopped", error: err.message } })
                                        .where(eq(apps.id, launchAppId));
                                } catch { /* swallow */ }
                                return { appId: launchAppId, slug: launchSlug, status: 'failed', error: err.message };
                            }
                        };
                        appLaunchTasks.push(launchTask);
                    }

                    appsProvisioned++;

                    // ─── Mission bindings (Phase 1 of mission-first SDLC apps) ───────
                    // YAML supports three shapes for the bindings list:
                    //   bindings: ["mission-2-requirements"]          // manifest IDs (preferred — stable)
                    //   bindings: ["Requirements & Design Analysis"]  // display names (also accepted)
                    //   bindings: [                                    // explicit role + label
                    //     { mission: "mission-4-qa", role: "primary", label: "Triage" },
                    //     { mission: "Core Application Development", role: "reference" }
                    //   ]
                    // Each becomes a mission_app_bindings row so Cycle Manager can
                    // show this app inline on those mission rows.
                    const rawBindings: any[] = Array.isArray(appBlock.bindings) ? appBlock.bindings : [];
                    if (rawBindings.length > 0) {
                        const { missionAppBindings } = await import("@shared/schema/index.js");
                        const defaultRole = (appBlock.bindingRole as string) ?? "primary";
                        const defaultOpenMode = (appBlock.openMode as string) ?? "modal";
                        let bindingsWritten = 0;
                        for (let idx = 0; idx < rawBindings.length; idx++) {
                            const entry = rawBindings[idx];
                            // Normalize shorthand string vs object form
                            const target = typeof entry === "string" ? entry : entry?.mission;
                            const entryRole = typeof entry === "object" ? (entry?.role ?? defaultRole) : defaultRole;
                            const entryLabel = typeof entry === "object" ? (entry?.label ?? appBlock.bindingLabel ?? null) : (appBlock.bindingLabel ?? null);
                            const entryOpenMode = typeof entry === "object" ? (entry?.openMode ?? defaultOpenMode) : defaultOpenMode;
                            if (!target || typeof target !== "string") {
                                warnings.push(`App "${appBlock.id}" binding[${idx}] missing 'mission' — skipped`);
                                continue;
                            }
                            // Resolve to DB mission id: try manifest ID first (stable),
                            // then display name (developer convenience).
                            let dbMissionId = dbMissionIdByStringId[target];
                            if (!dbMissionId) {
                                const byName = Object.entries(missionNameById).find(([, n]) => n === target);
                                if (byName) dbMissionId = dbMissionIdByStringId[byName[0]];
                            }
                            if (!dbMissionId) {
                                warnings.push(`App "${appBlock.id}" binding skipped: mission "${target}" not in manifest`);
                                continue;
                            }
                            try {
                                await db.insert(missionAppBindings).values({
                                    organizationId: orgId,
                                    missionId: dbMissionId,
                                    appId: targetAppId,
                                    role: entryRole,
                                    label: entryLabel,
                                    openModeDefault: entryOpenMode,
                                    sortOrder: idx,
                                    source: "blueprint",
                                }).onConflictDoNothing();
                                bindingsWritten++;
                            } catch (err: any) {
                                warnings.push(`App "${appBlock.id}" binding to "${target}" failed: ${err.message}`);
                            }
                        }
                        if (bindingsWritten > 0) {
                            logger.info(`[OrgForge] Wrote ${bindingsWritten} mission bindings for app ${appBlock.id}`);
                        }
                    }

                    // ─── workbench_modules-derived bindings (shared-server fan-out) ──
                    // When an app is a shared-server suite (sdlc-workbench), each
                    // workbench_module declares its own dependent_missions. Treat the
                    // parent app as bound to the union of all modules' missions so the
                    // dropdown surfaces it for every relevant mission.
                    const modules: any[] = Array.isArray(appBlock.workbench_modules) ? appBlock.workbench_modules : [];
                    if (modules.length > 0) {
                        const { missionAppBindings } = await import("@shared/schema/index.js");
                        const seen = new Set<string>(); // dedupe (mission, role) tuples
                        let moduleBindingsWritten = 0;
                        
                        // Store workbench metadata in runtimeMetadata for App Builder
                        const workbenchMetadata = modules.map(mod => ({
                            id: mod.id,
                            name: mod.name,
                            routePath: mod.id, // Use id as route path by default
                            description: mod.description || mod.purpose,
                            embedMode: mod.embed_mode,
                            dependentMissions: Array.isArray(mod.dependent_missions) ? mod.dependent_missions : [],
                            editable: mod.app_builder_editable !== false // Default to editable
                        }));
                        
                        // Update app runtimeMetadata with workbench modules
                        await db.update(apps)
                            .set({ 
                                runtimeMetadata: { 
                                    ...(appData.runtimeMetadata || {}), 
                                    workbenchModules: workbenchMetadata,
                                    isSharedServer: true
                                } 
                            })
                            .where(eq(apps.id, targetAppId));
                        
                        logger.info(`[OrgForge] Stored ${workbenchMetadata.length} workbench modules in runtimeMetadata for app ${appBlock.id}`);
                        
                        for (const mod of modules) {
                            const role = (mod?.role as string) ?? "primary";
                            const missionRefs: string[] = Array.isArray(mod?.dependent_missions) ? mod.dependent_missions : [];
                            for (let i = 0; i < missionRefs.length; i++) {
                                const ref = missionRefs[i];
                                let dbMissionId = dbMissionIdByStringId[ref];
                                if (!dbMissionId) {
                                    const byName = Object.entries(missionNameById).find(([, n]) => n === ref);
                                    if (byName) dbMissionId = dbMissionIdByStringId[byName[0]];
                                }
                                if (!dbMissionId) continue;
                                const tupleKey = `${dbMissionId}:${role}`;
                                if (seen.has(tupleKey)) continue;
                                seen.add(tupleKey);
                                try {
                                    await db.insert(missionAppBindings).values({
                                        organizationId: orgId,
                                        missionId: dbMissionId,
                                        appId: targetAppId,
                                        role,
                                        label: mod?.name ?? mod?.id ?? null,
                                        openModeDefault: (mod?.embed_mode === "cycle-modal" ? "modal" : "page"),
                                        sortOrder: i,
                                        source: "blueprint",
                                    }).onConflictDoNothing();
                                    moduleBindingsWritten++;
                                } catch { /* swallow — onConflictDoNothing handles dupes */ }
                            }
                        }
                        if (moduleBindingsWritten > 0) {
                            logger.info(`[OrgForge] Wrote ${moduleBindingsWritten} module-derived bindings for app ${appBlock.id}`);
                        }
                    }

                    // Publish event bus notification for app provisioning
                    await crossAppEventBus.publish({
                        type: "APP_PROVISIONED" as any,
                        organizationId: orgId,
                        sourceApp: "org_forge",
                        payload: {
                            appId: targetAppId,
                            appName: appData.name,
                            appSlug: appData.slug,
                            customizations: appCustomizations,
                        },
                    });
                }
            }

            // ─── 13.5. Execute app launches in bounded batches ────────────────────
            // Each launch may trigger a fresh `next build` which is CPU- and
            // I/O-heavy. Running all 5+ in parallel was observed to corrupt
            // `.next/` (missing prerender-manifest.json) on real installs.
            // BLUEPRINT_INSTALL_PARALLELISM env (default 2) caps concurrency.
            const parallelism = Math.max(1, Number(process.env.BLUEPRINT_INSTALL_PARALLELISM) || 2);
            const launchResults: PromiseSettledResult<{ appId: number; slug: string; status: 'running' | 'queued' | 'failed'; error?: string }>[] = [];
            if (skipAppLaunch) {
                // Caller (e.g. a one-shot CLI script) will hand app startup to the
                // long-running server instead. Launching here would spawn the app
                // processes as children of the caller, which die when it exits.
                logger.info(`[OrgForge] skipAppLaunch=true — deferring ${appLaunchTasks.length} app launch(es) to the live server`);
            } else {
                for (let i = 0; i < appLaunchTasks.length; i += parallelism) {
                    const batch = appLaunchTasks.slice(i, i + parallelism);
                    logger.info(`[OrgForge] App launch batch ${Math.floor(i / parallelism) + 1}/${Math.ceil(appLaunchTasks.length / parallelism)} (${batch.length} apps, parallelism=${parallelism})`);
                    const batchResults = await Promise.allSettled(batch.map(task => task()));
                    launchResults.push(...batchResults);
                }
            }
            const appsRunning = launchResults.filter(r => r.status === 'fulfilled' && r.value.status === 'running').length;
            const appsQueued = launchResults.filter(r => r.status === 'fulfilled' && r.value.status === 'queued').length;
            const appsFailedToLaunch = launchResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')).length;
            const appLaunchDetails = launchResults.map(r =>
                r.status === 'fulfilled' ? r.value : { status: 'failed', error: String(r.reason) }
            );
            // Surface launch failures as warnings so the caller's UI/log
            // shows what didn't come up.
            for (const detail of appLaunchDetails) {
                if (detail.status !== 'running') {
                    warnings.push(`App launch ${detail.status}: ${(detail as any).slug ?? '?'} - ${(detail as any).error ?? 'no error message'}`);
                }
            }
            logger.info(`[OrgForge] App launches: running=${appsRunning} queued=${appsQueued} failed=${appsFailedToLaunch} (total=${appLaunchTasks.length})`);

            return { appsProvisioned, appsRunning, appsQueued, appsFailedToLaunch, appLaunchDetails };
    }
}

export const orgForgeService = new OrgForgeService();
