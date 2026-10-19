import { type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { appTelemetry } from "@shared/schema/index.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformTelemetryController");

export class TelemetryController {
    public static async recordTelemetry(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const { event, level, metadata } = req.body;

        if (!event || typeof event !== "string")
            throw new BadRequestError("'event' is required");

        await db.insert(appTelemetry).values({
            appId,
            orgId,
            event,
            level: level || "info",
            metadata: metadata || {},
        });

        res.status(201).json({ status: "recorded" });
    }
}
