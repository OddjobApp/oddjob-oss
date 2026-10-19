/**
 * Oddjob MCP Server - Schedule Tools
 * 
 * Exposes tools for managing schedules and scheduled jobs
 * through the Model Context Protocol.
 */

import { z } from "zod";

// Schedule pattern types
const schedulePatterns = [1, 2, 3, 4] as const; // 1=hourly, 2=daily, 3=weekly, 4=custom/cron
const triggerTypes = ["Schedule", "Manual", "Webhook", "API"] as const;

export const scheduleToolDefinitions = [
    // ========================================================================
    // SCHEDULE TOOLS (timing patterns)
    // ========================================================================
    {
        name: "list_schedules",
        description: "List all schedule patterns configured in the organization. Schedules define WHEN jobs/pipelines should run (hourly, daily, weekly, cron).",
        inputSchema: {
            type: "object" as const,
            properties: {
                activeOnly: {
                    type: "boolean",
                    description: "Only show active schedules. Default: false",
                },
            },
        },
    },
    {
        name: "get_schedule_details",
        description: "Get detailed information about a specific schedule including its pattern configuration.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduleId: { type: "number", description: "Schedule ID" },
                scheduleName: { type: "string", description: "Alternative: Schedule name" },
            },
        },
    },
    {
        name: "create_schedule",
        description: `Create a new schedule pattern. Requires admin permissions.

**Pattern Types:**
- 1 = Hourly (runs every hour)
- 2 = Daily (runs once per day at specified time)
- 3 = Weekly (runs on specific days)
- 4 = Custom/Cron (advanced cron expression)

**PatternString Examples:**
- Daily at 9am: {"hour": 9, "minute": 0}
- Weekly Mon/Wed/Fri: {"days": [1, 3, 5], "hour": 8}
- Cron: {"cron": "0 8 * * 1-5"} (weekdays at 8am)`,
        inputSchema: {
            type: "object" as const,
            properties: {
                name: { type: "string", description: "Unique schedule name" },
                description: { type: "string", description: "What this schedule is for" },
                pattern: {
                    type: "number",
                    enum: [1, 2, 3, 4],
                    description: "1=hourly, 2=daily, 3=weekly, 4=cron"
                },
                patternString: {
                    type: "object",
                    description: "Pattern config: {hour, minute, days, cron}"
                },
                patternLabel: { type: "string", description: "Human-readable label (e.g., 'Every weekday at 9am')" },
                timezone: { type: "string", description: "Timezone (e.g., 'America/New_York')" },
                isActive: { type: "boolean", description: "Enable schedule. Default: true" },
            },
            required: ["name", "pattern"],
        },
    },
    {
        name: "update_schedule",
        description: "Update an existing schedule pattern. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduleId: { type: "number", description: "Schedule ID to update" },
                name: { type: "string" },
                description: { type: "string" },
                pattern: { type: "number", enum: [1, 2, 3, 4] },
                patternString: { type: "object" },
                patternLabel: { type: "string" },
                timezone: { type: "string" },
                isActive: { type: "boolean" },
            },
            required: ["scheduleId"],
        },
    },
    {
        name: "delete_schedule",
        description: "Delete a schedule. Requires admin permissions. This will unlink any scheduled jobs using this schedule.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduleId: { type: "number", description: "Schedule ID to delete" },
            },
            required: ["scheduleId"],
        },
    },

    // ========================================================================
    // SCHEDULED JOB TOOLS (links jobs/pipelines to schedules)
    // ========================================================================
    {
        name: "list_scheduled_jobs",
        description: "List all scheduled jobs/pipelines. Shows which jobs or pipelines are scheduled to run and their trigger configuration.",
        inputSchema: {
            type: "object" as const,
            properties: {
                activeOnly: { type: "boolean", description: "Only show active scheduled jobs" },
                triggerType: {
                    type: "string",
                    enum: ["Schedule", "Manual", "Webhook", "API"],
                    description: "Filter by trigger type"
                },
            },
        },
    },
    {
        name: "get_scheduled_job_details",
        description: "Get detailed configuration of a scheduled job including its schedule, alerts, and retry settings.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduledJobId: { type: "number", description: "Scheduled job ID" },
                scheduledJobName: { type: "string", description: "Alternative: Scheduled job name" },
            },
        },
    },
    {
        name: "create_scheduled_job",
        description: `Schedule a job or pipeline to run automatically. Requires admin permissions.

**Trigger Types:**
- Schedule: Run on a schedule pattern
- Webhook: Triggered by external webhook call
- API: Triggered via API call
- Manual: Must be manually triggered

**Example: Schedule a pipeline to run daily:**
{name: "Daily ETL", pipelineId: 5, scheduleId: 1, triggerType: "Schedule"}

**Example: Webhook-triggered job:**
{name: "JIRA Sync", jobId: 10, triggerType: "Webhook", triggerCredentialId: 2}`,
        inputSchema: {
            type: "object" as const,
            properties: {
                name: { type: "string", description: "Unique name for this scheduled job" },
                jobId: { type: "number", description: "Job ID to schedule (use this OR pipelineId)" },
                pipelineId: { type: "number", description: "Pipeline ID to schedule (use this OR jobId)" },
                scheduleId: { type: "number", description: "Schedule pattern to use (for triggerType=Schedule)" },
                triggerType: {
                    type: "string",
                    enum: ["Schedule", "Manual", "Webhook", "API"],
                    description: "How this job/pipeline is triggered"
                },
                priority: { type: "number", description: "1=high, 2=medium, 3=low. Default: 2" },
                isActive: { type: "boolean", description: "Enable immediately. Default: true" },
                // Alert settings
                alertOnFailure: { type: "boolean", description: "Send alert on failure. Default: true" },
                alertOnSuccess: { type: "boolean", description: "Send alert on success. Default: false" },
                alertOnDelay: { type: "boolean", description: "Send alert if delayed. Default: true" },
                delayThreshold: { type: "number", description: "Minutes before delay alert. Default: 15" },
                // Retry settings
                maxRetries: { type: "number", description: "Max retry attempts (0-10). Default: 0" },
                retryDelaySeconds: { type: "number", description: "Seconds between retries. Default: 60" },
                // Advanced
                maxConcurrentRuns: { type: "number", description: "Max parallel runs. Default: 1" },
                triggerCredentialId: { type: "number", description: "Credential for webhook verification" },
                parameterValues: { type: "object", description: "Default parameter values to pass" },
                labels: { type: "object", description: "Arbitrary labels for categorization" },
            },
            required: ["name"],
        },
    },
    {
        name: "update_scheduled_job",
        description: "Update a scheduled job configuration. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduledJobId: { type: "number", description: "Scheduled job ID to update" },
                name: { type: "string" },
                scheduleId: { type: "number" },
                triggerType: { type: "string", enum: ["Schedule", "Manual", "Webhook", "API"] },
                priority: { type: "number" },
                isActive: { type: "boolean" },
                alertOnFailure: { type: "boolean" },
                alertOnSuccess: { type: "boolean" },
                maxRetries: { type: "number" },
                retryDelaySeconds: { type: "number" },
                maxConcurrentRuns: { type: "number" },
                parameterValues: { type: "object" },
                labels: { type: "object" },
            },
            required: ["scheduledJobId"],
        },
    },
    {
        name: "delete_scheduled_job",
        description: "Delete a scheduled job. Requires admin permissions. This stops the job/pipeline from being triggered.",
        inputSchema: {
            type: "object" as const,
            properties: {
                scheduledJobId: { type: "number", description: "Scheduled job ID to delete" },
            },
            required: ["scheduledJobId"],
        },
    },
    {
        // handleGetUpcomingScheduledRuns takes no arguments and returns a fixed
        // ten. Advertising a `limit` here would be a parameter the handler
        // discards, so the count is stated in the description instead.
        name: "get_upcoming_scheduled_runs",
        description: "List the next 10 upcoming scheduled runs across the organization, soonest first. Only active scheduled jobs with a computed next run time are included.",
        inputSchema: {
            type: "object" as const,
            properties: {},
        },
    },
];

// Input validation schemas
export const ListSchedulesInput = z.object({
    activeOnly: z.boolean().default(false),
});

export const GetScheduleDetailsInput = z.object({
    scheduleId: z.number().optional(),
    scheduleName: z.string().optional(),
});

export const CreateScheduleInput = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    pattern: z.number().int().min(1).max(4),
    patternString: z.record(z.any()).optional(),
    patternLabel: z.string().optional(),
    timezone: z.string().optional(),
    isActive: z.boolean().default(true),
});

export const UpdateScheduleInput = z.object({
    scheduleId: z.number(),
    name: z.string().optional(),
    description: z.string().optional(),
    pattern: z.number().int().min(1).max(4).optional(),
    patternString: z.record(z.any()).optional(),
    patternLabel: z.string().optional(),
    timezone: z.string().optional(),
    isActive: z.boolean().optional(),
});

export const DeleteScheduleInput = z.object({
    scheduleId: z.number(),
});

export const ListScheduledJobsInput = z.object({
    activeOnly: z.boolean().default(false),
    triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).optional(),
});

export const GetScheduledJobDetailsInput = z.object({
    scheduledJobId: z.number().optional(),
    scheduledJobName: z.string().optional(),
});

export const CreateScheduledJobInput = z.object({
    name: z.string().min(1),
    jobId: z.number().optional(),
    pipelineId: z.number().optional(),
    scheduleId: z.number().optional(),
    triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).default("Schedule"),
    priority: z.number().int().min(1).max(3).default(2),
    isActive: z.boolean().default(true),
    alertOnFailure: z.boolean().default(true),
    alertOnSuccess: z.boolean().default(false),
    alertOnDelay: z.boolean().default(true),
    delayThreshold: z.number().int().default(15),
    maxRetries: z.number().int().min(0).max(10).default(0),
    retryDelaySeconds: z.number().int().default(60),
    maxConcurrentRuns: z.number().int().default(1),
    triggerCredentialId: z.number().optional(),
    parameterValues: z.record(z.any()).optional(),
    labels: z.record(z.any()).optional(),
});

export const UpdateScheduledJobInput = z.object({
    scheduledJobId: z.number(),
    name: z.string().optional(),
    scheduleId: z.number().optional(),
    triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).optional(),
    priority: z.number().int().min(1).max(3).optional(),
    isActive: z.boolean().optional(),
    alertOnFailure: z.boolean().optional(),
    alertOnSuccess: z.boolean().optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    retryDelaySeconds: z.number().int().optional(),
    maxConcurrentRuns: z.number().int().optional(),
    parameterValues: z.record(z.any()).optional(),
    labels: z.record(z.any()).optional(),
});

export const DeleteScheduledJobInput = z.object({
    scheduledJobId: z.number(),
});

