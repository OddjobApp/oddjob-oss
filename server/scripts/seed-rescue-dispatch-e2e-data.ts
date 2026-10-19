import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../database_service.js";
import { orgs, users, adminRoles, datasets, datasetItems, agentDeployments, appDeployments, apps, jobs, operationalCycles, pipelines, eventPrimitives, ruleSuites, ruleSpecifications, ruleExecutionAudits } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { passwordService } from "../domain/auth/core/password-service.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { rescueGeoService } from "../domain/rescue/core/geo-service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("SeedRescueDispatchE2E");

async function main() {
    logger.info("🚀 Starting Rescue Dispatch E2E Data Setup for Acme Corp (Default)...");

    // 1. Ensure Acme Corp (Default) Org exists
    const orgName = "Acme Corp (Default)";
    let [org] = await db.select().from(orgs).where(eq(orgs.name, orgName)).limit(1);

    if (!org) {
        logger.info(`Creating organization "${orgName}"...`);
        [org] = await db.insert(orgs).values({ name: orgName }).returning();
    }
    logger.info(`✅ Org ready: "${org.name}" (ID: ${org.id})`);

    // 2. Ensure Admin User (admin@example.com) exists and belongs to Acme Corp (Default)
    const adminEmail = "admin@example.com";
    const adminUsername = "admin";
    const passwordHash = await passwordService.hashPassword("password123");

    let [adminUser] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);

    if (!adminUser) {
        logger.info(`Creating user ${adminEmail}...`);
        [adminUser] = await db.insert(users).values({
            username: adminUsername,
            email: adminEmail,
            password: passwordHash,
            defaultOrgId: org.id,
        }).returning();
    } else {
        logger.info(`Updating user ${adminEmail} organizationId to ${org.id}...`);
        await db.update(users).set({
            password: passwordHash,
            defaultOrgId: org.id,
        }).where(eq(users.id, adminUser.id));
    }

    // Ensure super admin role
    const [existingRole] = await db.select().from(adminRoles).where(eq(adminRoles.userId, adminUser.id)).limit(1);
    if (!existingRole) {
        await db.insert(adminRoles).values({
            userId: adminUser.id,
            role: "super_admin",
        });
    }

    logger.info(`✅ User ready: "${adminUser.email}" linked to Org ${org.id}`);

    // 3. Install Cycle App via Org Forge
    const yamlPath = path.resolve("server/cycles/asset-service-dispatch.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    logger.info(`Installing Service Dispatch cycle for Org ${org.id}...`);
    
    await orgForgeService.installCycleApp(org.id, yamlContent, { skipAppLaunch: true }).catch((err) => {
        logger.warn(`Cycle install warning (non-fatal): ${err.message}`);
    });

    // Find installed pipelines for Org
    const orgPipelines = await db.select().from(pipelines).where(eq(pipelines.organizationId, org.id));
    const pipelineIds = orgPipelines.map(p => p.id);
    logger.info(`Found ${pipelineIds.length} pipelines for Org ${org.id}: [${pipelineIds.join(", ")}]`);

    // Activate pipelines
    if (pipelineIds.length > 0) {
        await db.update(pipelines).set({ isActive: true }).where(eq(pipelines.organizationId, org.id));
    }

    // 4. Seed Managed Assets Dataset
    let [assetsDataset] = await db.select().from(datasets).where(and(eq(datasets.name, "Managed Assets"), eq(datasets.organizationId, org.id))).limit(1);
    if (!assetsDataset) {
        [assetsDataset] = await db.insert(datasets).values({
            name: "Managed Assets",
            description: "Physical assets linked via QR codes for triage and service dispatch.",
            organizationId: org.id,
            tags: ["platform:asset-dispatch", "utility:assets"],
        }).returning();
    }

    const generatorAsset = {
        assetId: "AST-8842",
        name: "Commercial Generator #4",
        target: "Commercial Generator #4",
        type: "generator",
        manufacturer: "Caterpillar",
        make: "CAT",
        model: "C15 ACERT",
        serialNumber: "GEN-8842-X",
        address: "200 N Spring St, Los Angeles, CA",
        lat: 34.0522,
        lng: -118.2437,
        floor: "Ground",
        building: "Site 4 Power Station",
        room: "Generator Enclosure #4",
        accessInstructions: "Keypad code 8842 required for outer gate.",
        lastServiceDate: "2025-12-01",
        warrantyExpiry: "2028-12-31",
        maintenanceContract: "Active Maintenance Contract #MC-8842",
        contractStatus: "Verified"
    };

    const existingItems = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, assetsDataset.id));
    const genMatch = existingItems.find(i => (i.data as any)?.serialNumber === "GEN-8842-X");
    if (!genMatch) {
        await db.insert(datasetItems).values({
            datasetId: assetsDataset.id,
            data: generatorAsset,
        });
        logger.info("✅ Seeded GEN-8842-X in Managed Assets dataset.");
    } else {
        await db.update(datasetItems).set({ data: generatorAsset }).where(eq(datasetItems.id, genMatch.id));
        logger.info("✅ Updated GEN-8842-X in Managed Assets dataset.");
    }

    // 5. Seed Service Providers Dataset + Geo Index
    let [providersDataset] = await db.select().from(datasets).where(and(eq(datasets.name, "Service Providers"), eq(datasets.organizationId, org.id))).limit(1);
    if (!providersDataset) {
        [providersDataset] = await db.insert(datasets).values({
            name: "Service Providers",
            description: "Active service technicians and companies for proximity-based dispatch.",
            organizationId: org.id,
            tags: ["platform:asset-dispatch", "utility:providers"],
        }).returning();
    }

    const apexProvider = {
        providerId: "PRO-ALPHA",
        name: "Apex Field Response",
        lat: 34.0522,
        lng: -118.2437,
        rating: 4.9,
        specialties: ["generator", "Emergency response", "Technical recovery"],
        availability: "24_7",
    };

    const providerItems = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, providersDataset.id));
    const apexMatch = providerItems.find(i => (i.data as any)?.name === "Apex Field Response");
    if (!apexMatch) {
        await db.insert(datasetItems).values({
            datasetId: providersDataset.id,
            data: apexProvider,
        });
        logger.info("✅ Seeded Apex Field Response in Service Providers dataset.");
    } else {
        await db.update(datasetItems).set({ data: apexProvider }).where(eq(datasetItems.id, apexMatch.id));
        logger.info("✅ Updated Apex Field Response in Service Providers dataset.");
    }

    // Geo index registration
    await rescueGeoService.updateHelperLocation("PRO-ALPHA", 34.0522, -118.2437).catch(() => {});
    await rescueGeoService.updateHelperLocation("PROV-001", 34.0522, -118.2437).catch(() => {});
    logger.info("✅ Geo index updated in Redis for Apex Field Response.");

    // 6. Ensure Service Requests Dataset exists
    let [requestsDataset] = await db.select().from(datasets).where(and(eq(datasets.name, "Service Requests"), eq(datasets.organizationId, org.id))).limit(1);
    if (!requestsDataset) {
        await db.insert(datasets).values({
            name: "Service Requests",
            description: "Runtime-populated dataset for service requests, restock logs, and feedback entries.",
            organizationId: org.id,
            tags: ["platform:asset-dispatch", "utility:service-requests"],
        });
        logger.info("✅ Service Requests dataset initialized.");
    }

    // 7. Ensure Agent Job & Deployment for rescue-dispatcher
    // The intake form is blueprint-owned data on the job config, not a literal in
    // the chat route. updateManifest merges it into the form manifest, which is
    // what both the deterministic initial-turn path and the derived fallback
    // routes read from.
    const { RESCUE_INTAKE_FORM } = await import("@domain/rescue/core/intake-form.js");

    let [job] = await db.select().from(jobs).where(and(eq(jobs.name, "Rescue Dispatch AI Coordinator"), eq(jobs.organizationId, org.id))).limit(1);
    if (!job) {
        [job] = await db.insert(jobs).values({
            name: "Rescue Dispatch AI Coordinator",
            description: "Autonomous AI agent for Rescue & Service Dispatch",
            organizationId: org.id,
            type: "agent",
            tool: "None",
            config: { intakeForm: RESCUE_INTAKE_FORM },
            createdBy: "system",
        } as any).returning();
    } else {
        await db.update(jobs)
            .set({ config: { ...((job.config as any) ?? {}), intakeForm: RESCUE_INTAKE_FORM } as any })
            .where(eq(jobs.id, job.id));
        logger.info("✅ Attached intake form to existing Rescue Dispatch agent job config");
    }

    let [agentDep] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, "rescue-dispatcher")).limit(1);
    if (!agentDep) {
        [agentDep] = await db.insert(agentDeployments).values({
            jobId: job.id,
            organizationId: org.id,
            slug: "rescue-dispatcher",
            title: "Rescue Dispatch AI Coordinator",
            description: "Autonomous AI agent with direct access to execute, monitor, and manage the Rescue & Service Dispatch Pipelines.",
            welcomeMessage: "Welcome to Rescue Dispatch AI. I am ready to process emergency intake, match nearest field service providers, and execute the Service Dispatch Pipeline.",
            isActive: true,
            accessPolicy: "public",
            allowedPipelineIds: pipelineIds,
            allowedTools: ["trigger_pipeline", "get_pipeline_status", "resolve_intent_to_pipeline", "list_pipelines", "show_pipeline_input_form", "search_unified_knowledge"],
            createdBy: "system",
        } as any).returning();
        logger.info(`✅ Created agent deployment "rescue-dispatcher" (ID: ${agentDep.id})`);
    } else {
        await db.update(agentDeployments).set({
            organizationId: org.id,
            jobId: job.id,
            isActive: true,
            accessPolicy: "public",
            allowedPipelineIds: pipelineIds,
        }).where(eq(agentDeployments.id, agentDep.id));
        logger.info(`✅ Updated agent deployment "rescue-dispatcher" (ID: ${agentDep.id})`);
    }

    // This seed inserts the deployment directly rather than through
    // AgentDeploymentService.upsert, so it bypasses the hook that normally gives
    // every agent its deterministic fallbacks at synthesis time. Derive them here
    // so the E2E environment degrades the same way production does — otherwise the
    // suite would pass against an agent that has no limp mode at all.
    try {
        const { AgentDeploymentService } = await import("@domain/agents/agent-deployment.service.js");
        const { agentFallbackService } = await import("@domain/agents/agent-fallback.service.js");
        await AgentDeploymentService.updateManifest(agentDep.id);
        const manifest = await agentFallbackService.derive(agentDep.id);
        logger.info(`✅ Derived ${manifest.routes.length} deterministic fallback route(s) for "rescue-dispatcher"`);
    } catch (err: any) {
        logger.warn(`⚠️  Could not derive fallbacks for "rescue-dispatcher": ${err.message}`);
    }

    let [dispatchApp] = await db.select().from(apps).where(eq(apps.slug, "rescue-dispatch")).limit(1);
    if (!dispatchApp) {
        [dispatchApp] = await db.select().from(apps).where(eq(apps.slug, "service-dispatch")).limit(1);
    }
    if (!dispatchApp) {
        [dispatchApp] = await db.insert(apps).values({
            organizationId: org.id,
            name: "Rescue Dispatch",
            slug: "rescue-dispatch",
            description: "Rescue Dispatch Control Portal",
            source: "blueprint",
            blueprintId: "rescue-dispatch",
            isSystem: false,
        } as any).returning();
        logger.info("✅ Inserted app record for rescue-dispatch.");
    }

    if (dispatchApp) {
        const [existingBySlug] = await db.select().from(appDeployments).where(eq(appDeployments.publicSlug, "rescue-dispatch")).limit(1);
        if (existingBySlug) {
            await db.update(appDeployments).set({
                appId: dispatchApp.id,
                organizationId: org.id,
                status: "active",
                isPublished: true,
            }).where(eq(appDeployments.id, existingBySlug.id));
            logger.info("✅ Re-linked existing app deployment for rescue-dispatch.");
        } else {
            await db.insert(appDeployments).values({
                appId: dispatchApp.id,
                organizationId: org.id,
                status: "active",
                isPublished: true,
                publicSlug: "rescue-dispatch",
                config: {},
            } as any);
            logger.info("✅ Created app deployment for rescue-dispatch.");
        }
    }

    // 8. Seed Signal Intelligence Telemetry Anomaly for Commercial Generator #4 (Los Angeles, CA)
    const anomalySourceEntryId = "telemetry:ast-8842:temp-breach";
    const [existingSignal] = await db.select().from(eventPrimitives).where(
        and(
            eq(eventPrimitives.organizationId, org.id),
            eq(eventPrimitives.sourceEntryId, anomalySourceEntryId)
        )
    ).limit(1);

    const signalData = {
        organizationId: org.id,
        sourceEntryId: anomalySourceEntryId,
        eventType: "Operational_Disruption",
        targetSector: "Infrastructure",
        jurisdiction: "Los Angeles, CA",
        severity: "Critical",
        sourceUrl: "telemetry://power-station-site-4/gen-8842-x",
        extractionTimestamp: new Date(),
        confidenceScore: 0.99,
        rawText: "Commercial Generator #4 (GEN-8842-X) reports critical temperature threshold exceedance (104.2°C > 95°C limit) at Site 4 Power Station, 200 N Spring St, Los Angeles, CA. Telemetry breach detected in H3 hex cluster 8828308281fffff. Emergency cooling loop service required.",
        flags: ["operator_injected", "anomaly_critical"],
        contentHash: "ast-8842-gen-8842-x-temp-exceedance-la",
        latitude: 34.0522,
        longitude: -118.2437,
        h3Index: "8828308281fffff",
        previousH3Index: "8828308281fffff",
        dwellMinutes: 14.5,
        subjectId: "AST-8842",
        spatialSource: "telemetry",
        precisionM: 5,
    };

    if (!existingSignal) {
        const [inserted] = await db.insert(eventPrimitives).values(signalData as any).returning();
        logger.info("✅ Seeded Commercial Generator #4 critical telemetry signal in event_primitives (Los Angeles, CA).");
    } else {
        await db.update(eventPrimitives).set(signalData as any).where(eq(eventPrimitives.id, existingSignal.id));
        logger.info("✅ Updated Commercial Generator #4 critical telemetry signal in event_primitives (Los Angeles, CA).");
    }

    // 9. Seed Governed Rule Suite and Rule Specification for Commercial Generator #4 (H3 Geofence & Dwell SLA)
    const suiteId = "signal-routing-triage";
    let [suite] = await db.select().from(ruleSuites).where(
        and(
            eq(ruleSuites.organizationId, org.id),
            eq(ruleSuites.suiteId, suiteId)
        )
    ).limit(1);

    if (!suite) {
        [suite] = await db.insert(ruleSuites).values({
            organizationId: org.id,
            suiteId,
            suiteName: "Signal Routing Triage",
            category: "Energy & Power Infrastructure",
            version: "1.0.0",
            owner: "Incident Response Squad",
            description: "Governed H3 spatial geofences and telemetry threshold escalation rules.",
            executionPolicy: "HIGHEST_PRIORITY_MAUF",
            enabled: true,
            createdBy: "operator",
        }).returning();
        logger.info(`✅ Seeded Rule Suite '${suiteId}' (ID: ${suite.id})`);
    }

    const geoRuleId = "critical-generator-geo-spatial-anomaly-dwell-policy";
    const geoRulePayload = {
        ruleId: geoRuleId,
        ruleName: "Critical Generator Geo-Spatial Anomaly & Dwell Policy",
        enabled: true,
        priorityWeight: 85,
        ifBranch: {
            branchId: "IF_BRANCH",
            branchName: "Primary match",
            matchStrategy: "ALL",
            conditions: [
                {
                    type: "spatial",
                    mode: "geofence_trigger",
                    trigger: "ON_DWELL",
                    dwellSlaMinutes: 10,
                    predicate: "there",
                    conditionId: "cond-geo-h3-fence",
                    label: "H3 Res-9 Geofence & Dwell SLA (>10m)",
                    geometry: {
                        regionName: "Site 4 Power Station (Los Angeles, CA)",
                        h3Cells: ["8828308281fffff"],
                        centerLat: 34.0522,
                        centerLng: -118.2437,
                    },
                },
                {
                    type: "crisp",
                    field: "dwellMinutes",
                    operator: ">=",
                    value: 10.0,
                },
                {
                    type: "crisp",
                    field: "severity",
                    operator: "equals",
                    value: "Critical",
                },
                {
                    type: "crisp",
                    field: "eventType",
                    operator: "equals",
                    value: "Operational_Disruption",
                },
                {
                    type: "crisp",
                    field: "rawText",
                    operator: "contains",
                    value: "104.2°C",
                },
            ],
            thenAction: {
                deliveryMode: "trigger",
                receiverBinding: {
                    targetType: "cycle",
                    targetId: "asset-service-dispatch",
                    recipientName: "CREW Incident Squad",
                },
            },
        },
    };

    const [existingRule] = await db.select().from(ruleSpecifications).where(
        and(
            eq(ruleSpecifications.suiteDbId, suite.id),
            eq(ruleSpecifications.ruleId, geoRuleId)
        )
    ).limit(1);

    let ruleSpecDbId: number;
    if (!existingRule) {
        const [insertedRule] = await db.insert(ruleSpecifications).values({
            suiteDbId: suite.id,
            ruleId: geoRuleId,
            ruleName: "Critical Generator Geo-Spatial Anomaly & Dwell Policy",
            enabled: true,
            priorityWeight: 85,
            specification: geoRulePayload as any,
        }).returning();
        ruleSpecDbId = insertedRule.id;
        logger.info(`✅ Seeded Rule Specification: ${geoRuleId}`);
    } else {
        await db.update(ruleSpecifications).set({
            specification: geoRulePayload as any,
            enabled: true,
            priorityWeight: 85,
        }).where(eq(ruleSpecifications.id, existingRule.id));
        ruleSpecDbId = existingRule.id;
        logger.info(`✅ Updated Rule Specification: ${geoRuleId}`);
    }

    // Seed execution audit for telemetry breach to show active history in Evaluation Logs
    const [existingAudit] = await db.select().from(ruleExecutionAudits).where(
        and(
            eq(ruleExecutionAudits.organizationId, org.id),
            eq(ruleExecutionAudits.ruleId, geoRuleId)
        )
    ).limit(1);

    const targetSignal = existingSignal || await db.select().from(eventPrimitives).where(eq(eventPrimitives.sourceEntryId, anomalySourceEntryId)).limit(1).then(r => r[0]);

    if (!existingAudit) {
        await db.insert(ruleExecutionAudits).values({
            organizationId: org.id,
            ruleSpecificationId: ruleSpecDbId,
            suiteId,
            ruleId: geoRuleId,
            eventPrimitiveId: targetSignal ? targetSignal.id : undefined,
            masterPriorityScore: 98,
            matchedBranch: "IF_BRANCH",
            disposition: "trigger",
            outcome: "matched",
            actionTaken: {
                deliveryMode: "trigger",
                target: "CREW Incident War Room",
            },
            executedAt: new Date(),
        } as any);
        logger.info(`✅ Seeded Rule Execution Audit for ${geoRuleId}`);
    }

    logger.info("\n✨ Rescue Dispatch E2E Data Setup Complete for Acme Corp (Default)!\n");
    process.exit(0);
}

main().catch((err) => {
    logger.error("❌ Setup failed:", err);
    process.exit(1);
});
