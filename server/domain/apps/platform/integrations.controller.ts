import { type Request, type Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { credentials, appRecords, missions, saasConnectors } from "@shared/schema/index.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { recordAppOutbox } from "../apps-platform.helpers.js";

const logger = createLogger("AppPlatformIntegrationsController");

export class IntegrationsController {
    public static async createBug(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const {
            provider = "jira",
            projectKey,
            title,
            severity,
            reproSteps,
            expectedResult,
            actualResult,
            evidenceUrl,
            suiteName,
            releaseCandidate,
            requirementKey,
            labels = [],
        } = req.body || {};

        if (!title || typeof title !== "string")
            throw new BadRequestError("'title' is required");

        const normalizedSeverity = typeof severity === "string" ? severity : "High";
        const issueDescription = [
            `QA Defect from Oddjob App ${appId}`,
            "",
            `Severity: ${normalizedSeverity}`,
            suiteName ? `Suite: ${suiteName}` : null,
            releaseCandidate ? `Release Candidate: ${releaseCandidate}` : null,
            requirementKey ? `Requirement: ${requirementKey}` : null,
            evidenceUrl ? `Evidence: ${evidenceUrl}` : null,
            "",
            "Repro Steps:",
            reproSteps || "Not provided.",
            "",
            "Expected Result:",
            expectedResult || "Not provided.",
            "",
            "Actual Result:",
            actualResult || "Not provided.",
        ]
            .filter(Boolean)
            .join("\n");

        let fallbackReason = "No configured external issue provider was available.";
        let fallbackError: string | undefined;

        if (provider === "jira") {
            try {
                const [jiraCredential] = await db
                    .select({ id: credentials.id, metadata: credentials.metadata })
                    .from(credentials)
                    .where(
                        and(
                            eq(credentials.organizationId, orgId),
                            eq(credentials.type, "jira"),
                        ),
                    )
                    .limit(1);

                if (jiraCredential) {
                    const { getJiraClient } =
                        await import("@domain/integrations/jira-service.js");
                    const client = await getJiraClient(jiraCredential.id, orgId);
                    const metadata = (jiraCredential.metadata || {}) as any;
                    const resolvedProjectKey =
                        projectKey || metadata.projectKey || metadata.defaultProjectKey;

                    if (resolvedProjectKey) {
                        const issue = await client.createIssue({
                            project: { key: resolvedProjectKey },
                            summary: `[${normalizedSeverity}] ${title}`,
                            description: issueDescription,
                            issuetype: { name: "Bug" },
                            labels: ["oddjob-qa", "sdlc-cycle", ...labels].filter(Boolean),
                        });
                        const key = issue.key || issue.id;
                        const baseUrl = client.getBaseUrl();
                        return res.status(201).json({
                            provider: "jira",
                            key,
                            url: key ? `${baseUrl}/browse/${key}` : baseUrl,
                            status: "created",
                        });
                    }

                    fallbackReason =
                        "Jira is configured but no project key was available.";
                }
            } catch (err: any) {
                fallbackReason =
                    "Jira issue creation failed; queued an Oddjob-tracked bug reference.";
                fallbackError = err?.message || String(err);
                logger.warn(
                    `[AppPlatform] Jira bug creation failed for app ${appId}: ${fallbackError}`,
                );
            }
        }

        const fallbackKey = `QA-BUG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const outboxRecordId = await recordAppOutbox(appId, orgId, "bug-create", {
            provider,
            key: fallbackKey,
            title,
            severity: normalizedSeverity,
            projectKey,
            issueDescription,
            labels,
            reason: fallbackReason,
            error: fallbackError,
        });
        res.status(202).json({
            provider: "oddjob",
            key: fallbackKey,
            url: `/armory/apps/${appId}`,
            status: "queued",
            queued: true,
            outboxRecordId,
            note: `${fallbackReason} Recorded an Oddjob-tracked bug reference for retry/triage.`,
        });
    }

    public static async searchJira(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const { jql, fields, limit } = req.body || {};
        if (!jql || typeof jql !== "string")
            throw new BadRequestError("'jql' is required");

        const normalizedLimit = Number(limit || 25);
        const normalizedFields = Array.isArray(fields) ? fields : undefined;
        const { sdlcToolStubs } =
            await import("@domain/tools/v1/capabilities/sdlc-tools.js");
        const result = await sdlcToolStubs.jiraJqlSearch({
            orgId,
            jql,
            fields: normalizedFields,
            limit: normalizedLimit,
        });

        if ((result as any).success === false) {
            const outboxRecordId = await recordAppOutbox(
                appId,
                orgId,
                "jira-search",
                {
                    jql,
                    fields: normalizedFields,
                    limit: normalizedLimit,
                    error: (result as any).error || (result as any).message,
                },
            );
            return res.status(200).json({
                success: false,
                degraded: true,
                issues: [],
                total: 0,
                outboxRecordId,
                error:
                    (result as any).error ||
                    (result as any).message ||
                    "Jira search unavailable; query queued for retry.",
            });
        }

        res.status(200).json(result);
    }

    public static async getIntegrationsHealth(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;

        const credentialRows = await db
            .select({ type: credentials.type })
            .from(credentials)
            .where(
                and(
                    eq(credentials.organizationId, orgId),
                    inArray(credentials.type, ["jira", "confluence", "slack"]),
                ),
            );
        const credentialTypes = new Set(credentialRows.map((row) => row.type));

        const activeMissionRows = await db
            .select({ id: missions.id })
            .from(missions)
            .where(
                and(eq(missions.organizationId, orgId), eq(missions.status, "active")),
            );

        const outboxRows = await db
            .select({ id: appRecords.id })
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, "sdlc_integration_outbox"),
                ),
            );

        res.json({
            jira: { status: credentialTypes.has("jira") ? "configured" : "missing" },
            confluence: {
                status: credentialTypes.has("confluence") ? "configured" : "missing",
            },
            slack: {
                status: credentialTypes.has("slack") ? "configured" : "missing",
            },
            missions: {
                status: activeMissionRows.length > 0 ? "available" : "degraded",
                activeCount: activeMissionRows.length,
            },
            outbox: { queued: outboxRows.length },
        });
    }

    public static async publishConfluence(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const { title, content, space, pageId, parentPageId } = req.body || {};
        if (!title || typeof title !== "string")
            throw new BadRequestError("'title' is required");
        if (!content || typeof content !== "string")
            throw new BadRequestError("'content' is required");

        const { sdlcToolStubs } =
            await import("@domain/tools/v1/capabilities/sdlc-tools.js");
        const result = await sdlcToolStubs.confluencePublish({
            orgId,
            title,
            content,
            space,
            pageId,
            parentPageId,
        });

        res.status((result as any).success === false ? 424 : 200).json(result);
    }

    public static async searchConfluence(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const { query, spaceKey, limit = 10 } = req.body || {};
        if (!query || typeof query !== "string")
            throw new BadRequestError("'query' is required");

        const { getConfluenceClientForOrg } =
            await import("@domain/integrations/atlassian-connector-bridge.js");
        const client = await getConfluenceClientForOrg(orgId);

        // Use V2 search which supports text queries
        let spaceId: string | undefined;
        if (spaceKey) {
            try {
                spaceId = await client.getSpaceIdByKey(spaceKey);
            } catch {
                // If space resolution fails, search without space filter
            }
        }

        const results = await client.searchPagesV2(query, spaceId, Number(limit));

        const mapped = (results || []).map((page: any) => ({
            pageId: page.id || page.pageId,
            title: page.title,
            spaceKey: page.spaceId || page._links?.space || spaceKey || "",
            lastModified: page.version?.createdAt || page.lastModified || "",
            excerpt: page.excerpt || page.body?.storage?.value?.slice(0, 200) || "",
        }));

        res.json({ success: true, results: mapped, total: mapped.length });
    }

    public static async transitionJira(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const { issueKey, transitionName } = req.body || {};
        if (!issueKey || typeof issueKey !== "string")
            throw new BadRequestError("'issueKey' is required");
        if (!transitionName || typeof transitionName !== "string")
            throw new BadRequestError("'transitionName' is required");

        const { getJiraClientForOrg } =
            await import("@domain/integrations/atlassian-connector-bridge.js");
        const client = await getJiraClientForOrg(orgId);

        // Get available transitions
        const transitions = await client.getTransitions(issueKey);
        const target = transitions.find(
            (t: any) => t.name.toLowerCase() === transitionName.toLowerCase(),
        );

        if (!target) {
            return res.status(422).json({
                success: false,
                error: `Transition "${transitionName}" is not available for ${issueKey}`,
                availableTransitions: transitions.map((t: any) => t.name),
            });
        }

        await client.transitionIssue(issueKey, target.id);
        logger.info(
            `[AppPlatform] Transitioned ${issueKey} via "${transitionName}" (id: ${target.id})`,
        );
        res.json({ success: true, issueKey, transitionName: target.name });
    }

    public static async getJiraWorkflowMapping(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const projectKey = req.query.projectKey as string | undefined;

        const { saasConnectors } = await import("@shared/schema/index.js");

        const [connector] = await db
            .select({ config: saasConnectors.config })
            .from(saasConnectors)
            .where(
                and(
                    eq(saasConnectors.orgId, orgId),
                    eq(saasConnectors.platform, "jira"),
                ),
            )
            .limit(1);

        if (!connector) {
            return res
                .status(424)
                .json({ success: false, error: "No Jira connector configured" });
        }

        const config = (connector.config as Record<string, any>) || {};
        const workflowMapping = config.workflowMapping || {};

        // Default mapping
        const defaults: Record<string, string> = {
            backlog: "Backlog",
            design_ready: "Design Ready",
            in_progress: "In Progress",
            code_review: "Code Review",
            in_qa: "In QA",
            uat: "UAT",
            done: "Done",
        };

        // Merge: defaults → workflowMapping.default → workflowMapping.projects[projectKey]
        const baseMapping = { ...defaults, ...(workflowMapping.default || {}) };
        const projectOverrides =
            projectKey && workflowMapping.projects?.[projectKey]
                ? workflowMapping.projects[projectKey]
                : {};

        const resolved = { ...baseMapping, ...projectOverrides };

        res.json({
            success: true,
            mapping: resolved,
            projectKey: projectKey || config.defaultProjectKey || null,
            source:
                projectOverrides && Object.keys(projectOverrides).length > 0
                    ? "project_override"
                    : "default",
        });
    }
}
