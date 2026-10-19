import { z } from "zod";

export const trycuaToolDefinitions = [
    {
        name: "create_trycua_task",
        description: "Create a new Trycua computer-use task. This will observe a session and propose or execute actions.",
        inputSchema: {
            type: "object",
            properties: {
                sessionId: { type: "string", description: "The Trycua session ID" },
                task: { type: "string", description: "The task description/goal (e.g., 'Search for documentation')" },
                requireConfirmation: { type: "boolean", description: "Whether to wait for human confirmation before executing actions" },
                allowSensitive: { type: "boolean", description: "Whether to allow sensitive actions" },
                executeImmediately: { type: "boolean", description: "Whether to execute the initial step immediately" },
            },
            required: ["sessionId", "task"],
        },
    },
    {
        name: "list_trycua_tasks",
        description: "List Trycua computer-use tasks for the organization.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "integer", description: "Limit the number of results" },
            },
        },
    },
    {
        name: "get_trycua_task_details",
        description: "Get details and steps of a specific Trycua computer-use task.",
        inputSchema: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "The task ID" },
            },
            required: ["taskId"],
        },
    },
    {
        name: "confirm_trycua_task",
        description: "Confirm or reject a pending Trycua computer-use task.",
        inputSchema: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "The task ID" },
                allow: { type: "boolean", description: "Whether to allow the task to proceed" },
                text: { type: "string", description: "Optional text to input if required" },
                clipboardText: { type: "string", description: "Optional clipboard text if required" },
            },
            required: ["taskId", "allow"],
        },
    },
    {
        name: "cancel_trycua_task",
        description: "Cancel a running or pending Trycua computer-use task.",
        inputSchema: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "The task ID" },
            },
            required: ["taskId"],
        },
    },
    {
        name: "run_trycua_autonomous_loop",
        description: "Run the fully autonomous multi-step loop for a Trycua task.",
        inputSchema: {
            type: "object",
            properties: {
                taskId: { type: "string", description: "The task ID" },
            },
            required: ["taskId"],
        },
    },
];

export const CreateTrycuaTaskInput = z.object({
    sessionId: z.string(),
    task: z.string(),
    requireConfirmation: z.boolean().optional(),
    allowSensitive: z.boolean().optional(),
    executeImmediately: z.boolean().optional(),
});

export const ListTrycuaTasksInput = z.object({
    limit: z.number().optional(),
});

export const GetTrycuaTaskDetailsInput = z.object({
    taskId: z.string(),
});

export const ConfirmTrycuaTaskInput = z.object({
    taskId: z.string(),
    allow: z.boolean(),
    text: z.string().optional(),
    clipboardText: z.string().optional(),
});

export const CancelTrycuaTaskInput = z.object({
    taskId: z.string(),
});

export const RunTrycuaAutonomousLoopInput = z.object({
    taskId: z.string(),
});
