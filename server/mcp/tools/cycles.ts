
/**
 * Cycle Management Tool Definitions
 */
export const cycleToolDefinitions = [
    {
        name: "list_cycles",
        description: "List all operational business cycles with their current status, spend, and priority.",
        inputSchema: {
            type: "object",
            properties: {
                status: {
                    type: "string",
                    description: "Filter by status (active, pending_approval, paused, reviewing, closed)"
                }
            }
        }
    },
    {
        name: "launch_cycle",
        description: "Launch or stage a new autonomous business cycle.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the cycle" },
                objective: { type: "string", description: "The strategic goal for the autonomous fleet" },
                priority: { type: "integer", description: "Priority level (1-10, 1 is highest)" },
                requiresApproval: { type: "boolean", description: "Whether to stage for human approval first" },
                recurrence: { type: "string", enum: ["once", "daily", "weekly", "monthly"] }
            },
            required: ["name", "objective"]
        }
    },
    {
        name: "approve_cycle",
        description: "Approve a staged cycle to launch its mission fleet.",
        inputSchema: {
            type: "object",
            properties: {
                cycleId: { type: "integer", description: "ID of the cycle to approve" }
            },
            required: ["cycleId"]
        }
    },
    {
        name: "pause_cycle",
        description: "Pause an active cycle fleet.",
        inputSchema: {
            type: "object",
            properties: {
                cycleId: { type: "integer", description: "ID of the cycle to pause" }
            },
            required: ["cycleId"]
        }
    },
    {
        name: "resume_cycle",
        description: "Resume a paused cycle fleet.",
        inputSchema: {
            type: "object",
            properties: {
                cycleId: { type: "integer", description: "ID of the cycle to resume" }
            },
            required: ["cycleId"]
        }
    }
];
