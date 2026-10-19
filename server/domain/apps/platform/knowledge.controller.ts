import { type Request, type Response } from "express";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformKnowledgeController");

export class KnowledgeController {
    public static async queryKnowledge(req: Request, res: Response) {
        const { orgId } = req.appTokenContext!;
        const question = (req.query.q as string | undefined)?.trim();
        if (!question) throw new BadRequestError("'q' query parameter is required");

        const { knowledgeService } =
            await import("@domain/knowledge/knowledge.service.js");
        const { getSystemOrgContext } =
            await import("@server/utils/auth-context.js");

        const results = await knowledgeService.searchUnified(
            question,
            getSystemOrgContext(orgId),
            { limit: 10 },
        );

        res.json(results);
    }
}
