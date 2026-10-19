import { type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformJobsController");

export class JobsController {
    public static async getJobs(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const type = req.query.type as string | undefined;

        const conditions = [eq(jobs.organizationId, orgId)];
        if (type) conditions.push(eq(jobs.type, type as any));

        const items = await db
            .select({
                id: jobs.id,
                name: jobs.name,
                type: jobs.type,
                tool: jobs.tool,
                description: jobs.description,
            })
            .from(jobs)
            .where(and(...conditions))
            .orderBy(desc(jobs.createdAt))
            .limit(200);

        res.json({ items, total: items.length });
    }

    public static async createJob(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;
        const { name, tool, config, description, systemPrompt } = req.body;

        if (!name || typeof name !== "string")
            throw new BadRequestError("'name' is required");
        if (!tool || typeof tool !== "string")
            throw new BadRequestError("'tool' is required");

        const jobConfig = {
            ...(typeof config === "object" && config !== null ? config : {}),
            ...(systemPrompt ? { systemPrompt } : {}),
            createdByApp: deploymentId,
        };

        const [job] = await db
            .insert(jobs)
            .values({
                name,
                description: description ?? null,
                type: "custom",
                tool,
                config: jobConfig,
                organizationId: orgId,
                createdBy: `app-deployment:${deploymentId}`,
                isActive: true,
            } as any)
            .returning({ id: jobs.id, name: jobs.name });

        logger.info(
            `[AppPlatform] Deployment ${deploymentId} created job '${name}' (id: ${job.id})`,
        );
        res.status(201).json({ id: job.id, name: job.name });
    }
}
