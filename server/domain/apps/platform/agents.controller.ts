import { type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { jobs, appRecords } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { buildAgentGroundingContext } from "../apps-platform.helpers.js";
import { isWorkflowReceiptCollection, isSdlcSourceCollection } from "@shared/governed-app-collections.js";
import { IMMUTABLE_DECISION_COLLECTIONS } from "./datasets.controller.js";
import crypto from "node:crypto";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("AppPlatformAgentsController");

export class AgentsController {
    public static async chat(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;
        const agentId = parseInt(req.params.agentId);
        if (isNaN(agentId)) throw new BadRequestError("Invalid agentId");

        const { message, collectionName } = req.body;
        if (!message || typeof message !== "string")
            throw new BadRequestError("'message' is required");
        if (collectionName != null && typeof collectionName !== "string")
            throw new BadRequestError("'collectionName' must be a string");
        // A transcript is not a receipt or evidence: keep chat out of governed collections.
        if (isWorkflowReceiptCollection(collectionName) || isSdlcSourceCollection(collectionName)
            || (IMMUTABLE_DECISION_COLLECTIONS as readonly string[]).includes(collectionName))
            throw new BadRequestError("Chat transcripts cannot be stored in a governed workflow collection.");

        // Verify the job/agent exists and belongs to this org
        const [job] = await db
            .select({
                id: jobs.id,
                name: jobs.name,
                config: jobs.config,
                type: jobs.type,
                tool: jobs.tool,
            })
            .from(jobs)
            .where(and(eq(jobs.id, agentId), eq(jobs.organizationId, orgId)))
            .limit(1);

        if (!job) throw new NotFoundError("Agent not found");

        // Set up SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        // Persist user message if collectionName provided
        if (collectionName) {
            await db
                .insert(appRecords)
                .values({
                    appId: req.appTokenContext!.appId,
                    orgId,
                    collection: collectionName,
                    recordId: crypto.randomUUID(),
                    data: {
                        role: "user",
                        content: message,
                        agentId,
                        timestamp: new Date().toISOString(),
                    },
                })
                .catch(() => {}); // Non-blocking
        }

        try {
            // Use AIClient for streaming response
            const { AIClientFactory } =
                await import("@domain/ai/core/ai-client.service.js");
            const client = AIClientFactory.getClient({ provider: "google" } as any);

            const jobConfig = (job.config as Record<string, any>) || {};
            let systemPrompt =
                jobConfig.systemPrompt ||
                `You are ${job.name}, a helpful AI assistant.`;

            // Live grounding: if the blueprint declared a `grounding` directive on
            // this agent, inject the named collections (read from the source app's
            // org namespace) so the model answers from real rows, not fabrication.
            if (jobConfig.grounding) {
                try {
                    const groundingContext = await buildAgentGroundingContext(
                        orgId,
                        jobConfig.grounding,
                    );
                    if (groundingContext) {
                        systemPrompt +=
                            `\n\n---\nLIVE DATA RETRIEVED FOR YOU (the user's current records, as of now). ` +
                            `Ground every figure, total, and balance in these exact rows and cite the recordId(s) you used. ` +
                            `If a needed value is not present below, say so explicitly — do NOT invent it.\n\n${groundingContext}`;
                    } else {
                        systemPrompt +=
                            `\n\n---\nNO LIVE DATA ROWS were found for the requested collections. ` +
                            `Tell the user their ledger appears empty and suggest ingesting statements; do NOT fabricate figures.`;
                    }
                } catch (gErr: any) {
                    logger.warn(
                        `[AppPlatform] Grounding fetch failed for job ${agentId}: ${gErr.message}`,
                    );
                }
            }

            // Stream the response using executeStream
            const stream = client.executeStream!(
                {
                    model: "gemini-2.5-flash",
                    temperature: 0.7,
                    maxTokens: 2000,
                    isPriority: true,
                    userPrompt: message,
                    systemPrompt: systemPrompt,
                    useCache: false,
                    saveOutputToFile: false,
                },
                undefined,
                developmentProviderKey(),
            );

            let fullResponse = "";

            for await (const chunk of stream) {
                if (chunk) {
                    fullResponse += chunk;
                    res.write(
                        `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
                    );
                }
            }

            res.write("data: [DONE]\n\n");

            // Persist assistant response if collectionName provided
            if (collectionName && fullResponse) {
                await db
                    .insert(appRecords)
                    .values({
                        appId: req.appTokenContext!.appId,
                        orgId,
                        collection: collectionName,
                        recordId: crypto.randomUUID(),
                        data: {
                            role: "assistant",
                            content: fullResponse,
                            agentId,
                            timestamp: new Date().toISOString(),
                        },
                    })
                    .catch(() => {}); // Non-blocking
            }

            res.end();
        } catch (err: any) {
            logger.error(
                `[AppPlatform] Agent chat error for job ${agentId}: ${err.message}`,
            );
            res.write(
                `data: ${JSON.stringify({ error: err.message || "Chat failed" })}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
        }
    }

    public static async getHistory(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        const agentId = parseInt(req.params.agentId);
        const collectionName = req.query.collection as string | undefined;

        if (isNaN(agentId)) throw new BadRequestError("Invalid agentId");

        // If collectionName provided, load from appRecords
        if (collectionName) {
            const rows = await db
                .select()
                .from(appRecords)
                .where(
                    and(
                        eq(appRecords.appId, appId),
                        eq(appRecords.orgId, orgId),
                        eq(appRecords.collection, collectionName),
                    ),
                )
                .orderBy(appRecords.createdAt)
                .limit(100);

            const messages = rows
                .map((r) => {
                    const data = r.data as Record<string, any>;
                    if (data.agentId === agentId || !data.agentId) {
                        return {
                            id: r.recordId,
                            role: data.role,
                            content: data.content,
                            createdAt: r.createdAt,
                        };
                    }
                    return null;
                })
                .filter(Boolean);

            return res.json({ messages });
        }

        // No collection — return empty history
        res.json({ messages: [] });
    }

    /**
     * Emergency kill-switch. NOT IMPLEMENTED.
     *
     * This previously returned `{ success: true, "…All active agents transitioned to
     * paused status." }` while doing nothing but writing a log line. For a safety
     * control that is worse than absent: an operator hits it during an incident, sees
     * a green confirmation, and believes the fleet is stopped while it keeps running.
     *
     * Until it is wired to the agent runtime it answers 501 so callers fail loudly.
     */
    public static async pauseAll(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;

        logger.error(`[AgentsController] Emergency pause-all requested for org ${orgId} but NO pause is implemented — agents are still running.`);

        return res.status(501).json({
            success: false,
            error: "not_implemented",
            message: "Emergency pause-all is not implemented. Agents are still running — stop them from the agent runtime controls.",
        });
    }
}
