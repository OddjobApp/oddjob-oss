import { z } from "zod";

export const antigravityToolDefinitions = [
    {
        name: "list_antigravity_incidents",
        description: "List pending escalations from Oddjob missions. These are 'hard' errors that autonomous healing could not resolve.",
        inputSchema: {
            type: "object" as const,
            properties: {
                status: {
                    type: "string",
                    enum: ["pending", "investigating", "resolved"],
                    description: "Filter by status"
                },
                limit: {
                    type: "number",
                    description: "Maximum results. Default: 10"
                }
            }
        }
    },
    {
        name: "get_incident_context",
        description: "Get full diagnostic context for an escalation, including HTML snapshots and trace IDs.",
        inputSchema: {
            type: "object" as const,
            properties: {
                incidentId: {
                    type: "number",
                    description: "The ID of the incident"
                }
            },
            required: ["incidentId"]
        }
    },
    {
        name: "resolve_antigravity_incident",
        description: "Provide a resolution for an escalated incident and transition the mission run back to an active or safe state.",
        inputSchema: {
            type: "object" as const,
            properties: {
                incidentId: {
                    type: "number",
                    description: "The ID of the incident"
                },
                resolution: {
                    type: "string",
                    description: "Explanation of how the issue was resolved (e.g. 'Updated selector to .btn-primary')"
                },
                strategy: {
                    type: "string",
                    enum: ["retry", "replan", "safe_state"],
                    description: "Recommended next step for the mission run"
                }
            },
            required: ["incidentId", "resolution", "strategy"]
        }
    }
];

export const ListIncidentsInput = z.object({
    status: z.enum(["pending", "investigating", "resolved"]).optional(),
    limit: z.number().min(1).max(50).default(10),
});

export const GetIncidentInput = z.object({
    incidentId: z.number(),
});

export const ResolveIncidentInput = z.object({
    incidentId: z.number(),
    resolution: z.string(),
    strategy: z.enum(["retry", "replan", "safe_state"]),
});
