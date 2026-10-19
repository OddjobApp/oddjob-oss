
import { z } from "zod";

export const governorToolDefinitions = [
    {
        name: "get_governor_health",
        description: "Get the real-time health status of the Pentagonal OODA Governor (heartbeat, alive status, and consensus window states).",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "update_governor_settings",
        description: "Update the Governor's operating mode and master switch status.",
        inputSchema: {
            type: "object",
            properties: {
                enabled: {
                    type: "boolean",
                    description: "Whether the governor should be active",
                },
                mode: {
                    type: "string",
                    enum: ["OFF", "ADVISORY", "AUTONOMOUS"],
                    description: "Operating mode of the governor",
                },
            },
            required: ["mode"],
        },
    },
];

export const GetGovernorHealthInput = z.object({});
export const UpdateGovernorSettingsInput = z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(["OFF", "ADVISORY", "AUTONOMOUS"]),
});

