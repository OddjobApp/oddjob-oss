import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function resolveCloudCredential(orgId?: number | null, provider?: string): Promise<number | undefined> {
    if (!orgId || !provider) return undefined;
    try {
        const { db } = await import("@server/database_service.js");
        const { saasConnectors } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [connector] = await db
            .select({ id: saasConnectors.id })
            .from(saasConnectors)
            .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, provider)))
            .limit(1);
        return connector?.id;
    } catch {
        return undefined;
    }
}

export const CLOUD_TOOLS: Record<string, ToolDefinition> = {
    cloud_invoke_function: {
        name: "cloud_invoke_function",

        idempotency: "none",
        label: "Invoke Cloud Function",
        group: "Cloud",
        description: "Invoke an AWS Lambda or GCP Cloud Function and return its response.",
        parameters: z.object({
            provider: z.enum(["aws", "gcp"]).describe("Cloud provider"),
            functionName: z.string().describe("Function name or ARN (AWS) / function ID (GCP)"),
            payload: z.record(z.any()).optional().describe("JSON payload to send to the function"),
        }),
        execute: async (params, context) => {
            const { getCloudClient } = await import("../../../integrations/cloud-service.js");
            const credentialId = await resolveCloudCredential(context?.organizationId, params.provider);
            if (!credentialId) return JSON.stringify({ error: `No ${params.provider} credential configured. Add a cloud credential in Settings.` });
            const client = await getCloudClient(credentialId, context?.organizationId || null);
            if (params.provider === "aws") {
                return JSON.stringify(await client.invokeAWSLambda(params.functionName, params.payload || {}, "sync"));
            } else if (params.provider === "gcp") {
                return JSON.stringify(await client.invokeGCPFunction(params.functionName, params.payload || {}));
            }
            return JSON.stringify({ error: `Provider ${params.provider} not supported` });
        },
    },

    cloud_list_functions: {
        name: "cloud_list_functions",

        idempotency: "read-safe",
        label: "List Cloud Functions",
        group: "Cloud",
        description: "List available Lambda functions or GCP Cloud Functions in a cloud account.",
        parameters: z.object({
            provider: z.enum(["aws", "gcp"]).describe("Cloud provider"),
        }),
        execute: async (params, context) => {
            const { getCloudClient } = await import("../../../integrations/cloud-service.js");
            const credentialId = await resolveCloudCredential(context?.organizationId, params.provider);
            if (!credentialId) return JSON.stringify({ error: `No ${params.provider} credential configured.` });
            const client = await getCloudClient(credentialId, context?.organizationId || null);
            if (params.provider === "aws") return JSON.stringify(await client.listAWSFunctions());
            if (params.provider === "gcp") return JSON.stringify(await client.listGCPFunctions());
            return JSON.stringify({ error: `Provider ${params.provider} not supported` });
        },
    },

    cloud_read_logs: {
        name: "cloud_read_logs",

        idempotency: "read-safe",
        label: "Read Cloud Logs",
        group: "Cloud",
        description: "Read log events from AWS CloudWatch Logs.",
        parameters: z.object({
            provider: z.enum(["aws"]).describe("Cloud provider (currently AWS CloudWatch)"),
            logGroupName: z.string().describe("CloudWatch log group name"),
            filterPattern: z.string().optional().describe("CloudWatch filter pattern"),
            startTime: z.string().optional().describe("ISO 8601 start time"),
            endTime: z.string().optional().describe("ISO 8601 end time"),
        }),
        execute: async (params, context) => {
            const { getCloudClient } = await import("../../../integrations/cloud-service.js");
            const credentialId = await resolveCloudCredential(context?.organizationId, params.provider);
            if (!credentialId) return JSON.stringify({ error: `No ${params.provider} credential configured.` });
            const client = await getCloudClient(credentialId, context?.organizationId || null);
            const logs = await client.readAWSLogs(params.logGroupName, params.filterPattern, params.startTime, params.endTime);
            return JSON.stringify(logs);
        },
    },
};
