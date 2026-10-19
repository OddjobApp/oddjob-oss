
import { GetGovernorHealthInput, UpdateGovernorSettingsInput } from "../tools/governor.js";
import { db } from "../../database_service.js";
import { systemSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import {
    successResponse,
    createHandlerWrapper,
    type ToolContext
} from "./utils.js";

export const handleGetGovernorHealth = createHandlerWrapper(
    async (args: unknown, _context?: ToolContext) => {
        GetGovernorHealthInput.parse(args);

        const heartbeatStr = await redis.get("oddjob:governor:dispatcher:heartbeat");
        const heartbeat = heartbeatStr ? JSON.parse(heartbeatStr) : null;

        const health = {
            dispatcher: heartbeat ? {
                alive: true,
                lastPulse: heartbeat.timestamp,
                status: heartbeat.status,
                windows: heartbeat.windows
            } : {
                alive: false,
                status: "OFFLINE"
            },
            producer: {
                alive: true,
                status: "HEALTHY"
            },
            timestamp: Date.now()
        };

        return successResponse(health, "Retrieved Pentagonal OODA Governor health status");
    }
);

export const handleUpdateGovernorSettings = createHandlerWrapper(
    async (args: unknown, _context?: ToolContext) => {
        const input = UpdateGovernorSettingsInput.parse(args);

        const [settings] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "global"));

        if (!settings) {
            throw new Error("System settings not initialized");
        }

        const settingsData = (settings.settingsData || {}) as any;
        const governorSettings = {
            enabled: input.enabled ?? (input.mode !== "OFF"),
            mode: input.mode
        };

        const newData = {
            ...settingsData,
            governorSettings
        };

        await db
            .update(systemSettings)
            .set({ settingsData: newData, updatedAt: new Date() })
            .where(eq(systemSettings.key, "global"));

        return successResponse(governorSettings, `Updated Governor mode to ${input.mode}`);
    },
    { requireAdmin: true }
);

