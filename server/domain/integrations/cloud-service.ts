import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "../auth/core/credentials-service.js";

const logger = createLogger("CloudService");

export interface CloudCredential {
    provider: "aws" | "gcp" | "azure";
    // AWS
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    // GCP
    serviceAccountJson?: string;
    project?: string;
    // Azure
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    subscriptionId?: string;
}

export class CloudClient {
    private cred: CloudCredential;

    constructor(cred: CloudCredential) {
        this.cred = cred;
    }

    // ── AWS ──────────────────────────────────────────────────────────────────

    async invokeAWSLambda(functionName: string, payload: any, invocationType: string): Promise<any> {
        const region = this.cred.region || "us-east-1";
        logger.info(`[CloudService] Invoking Lambda ${functionName} in ${region} (${invocationType})`);

        // Prefer AWS SDK v3 if available in environment
        try {
            const lambdaPkg = "@aws-sdk/client-lambda";
            const { LambdaClient, InvokeCommand } = await import(lambdaPkg);
            const client = new LambdaClient({
                region,
                credentials: { accessKeyId: this.cred.accessKeyId!, secretAccessKey: this.cred.secretAccessKey! },
            });
            const cmd = new InvokeCommand({
                FunctionName: functionName,
                InvocationType: invocationType === "async" ? "Event" : "RequestResponse",
                Payload: JSON.stringify(payload || {}),
            });
            const result = await client.send(cmd);
            const responsePayload = result.Payload ? new TextDecoder().decode(result.Payload) : "{}";
            return JSON.parse(responsePayload);
        } catch (sdkErr: any) {
            if (!sdkErr.message?.includes("Cannot find module")) throw sdkErr;
            logger.warn("[CloudService] @aws-sdk/client-lambda not installed — falling back to REST");
            throw new Error("AWS SDK not available. Install @aws-sdk/client-lambda to use cloud_function jobs.");
        }
    }

    async listAWSFunctions(): Promise<any[]> {
        const region = this.cred.region || "us-east-1";
        try {
            const lambdaPkg = "@aws-sdk/client-lambda";
            const { LambdaClient, ListFunctionsCommand } = await import(lambdaPkg);
            const client = new LambdaClient({
                region,
                credentials: { accessKeyId: this.cred.accessKeyId!, secretAccessKey: this.cred.secretAccessKey! },
            });
            const result = await client.send(new ListFunctionsCommand({ MaxItems: 50 }));
            return result.Functions || [];
        } catch (sdkErr: any) {
            if (!sdkErr.message?.includes("Cannot find module")) throw sdkErr;
            throw new Error("AWS SDK not available. Install @aws-sdk/client-lambda to list functions.");
        }
    }

    async readAWSLogs(logGroupName: string, filterPattern?: string, startTime?: string, endTime?: string): Promise<any[]> {
        const region = this.cred.region || "us-east-1";
        try {
            const logsPkg = "@aws-sdk/client-cloudwatch-logs";
            const { CloudWatchLogsClient, FilterLogEventsCommand } = await import(logsPkg);
            const client = new CloudWatchLogsClient({
                region,
                credentials: { accessKeyId: this.cred.accessKeyId!, secretAccessKey: this.cred.secretAccessKey! },
            });
            const params: any = { logGroupName, limit: 100 };
            if (filterPattern) params.filterPattern = filterPattern;
            if (startTime) params.startTime = new Date(startTime).getTime();
            if (endTime) params.endTime = new Date(endTime).getTime();
            const result = await client.send(new FilterLogEventsCommand(params));
            return result.events || [];
        } catch (sdkErr: any) {
            if (!sdkErr.message?.includes("Cannot find module")) throw sdkErr;
            throw new Error("AWS SDK not available. Install @aws-sdk/client-cloudwatch-logs to read logs.");
        }
    }

    // ── GCP ──────────────────────────────────────────────────────────────────

    async invokeGCPFunction(functionName: string, payload: any): Promise<any> {
        const project = this.cred.project;
        if (!project) throw new Error("GCP project is required in credential");
        const token = await this.getGCPAccessToken();
        const url = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions/${functionName}:call`;
        const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ data: JSON.stringify(payload || {}) }),
        });
        if (!res.ok) throw new Error(`GCP function invoke failed ${res.status}: ${await res.text()}`);
        return res.json();
    }

    async listGCPFunctions(): Promise<any[]> {
        const project = this.cred.project;
        if (!project) throw new Error("GCP project is required in credential");
        const token = await this.getGCPAccessToken();
        const url = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`List GCP functions failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return data.functions || [];
    }

    private async getGCPAccessToken(): Promise<string> {
        if (!this.cred.serviceAccountJson) throw new Error("GCP credential requires serviceAccountJson");
        try {
            const gauthPkg = "google-auth-library";
            const { GoogleAuth } = await import(gauthPkg);
            const auth = new GoogleAuth({
                credentials: JSON.parse(this.cred.serviceAccountJson),
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            });
            const client = await auth.getClient();
            const tokenResp = await client.getAccessToken();
            return tokenResp.token || "";
        } catch (e: any) {
            if (!e.message?.includes("Cannot find module")) throw e;
            throw new Error("google-auth-library not available. Install it to use GCP cloud functions.");
        }
    }
}

export async function getCloudClient(credentialId: number, orgId: number | null): Promise<CloudClient> {
    const cred = await credentialsService.getById(credentialId, orgId);
    return new CloudClient(cred as any);
}
