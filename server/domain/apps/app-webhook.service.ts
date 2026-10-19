import { createHmac } from "node:crypto";
import { db } from "@server/database_service.js";
import { appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppWebhookService");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type WebhookEvent = "app.launched" | "mission.completed" | "budget.warning" | "budget.exceeded";

async function postWithRetry(url: string, body: string, headers: Record<string, string>, attempts = 3): Promise<void> {
    let lastErr: Error | undefined;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
            if (res.ok) return;
            throw new Error(`HTTP ${res.status}`);
        } catch (err: any) {
            lastErr = err;
            if (i < attempts - 1) await sleep(500 * Math.pow(2, i));
        }
    }
    throw lastErr;
}

export const appWebhookService = {
    async fire(deploymentId: number, event: WebhookEvent, payload: Record<string, any>): Promise<void> {
        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId)).limit(1);
        if (!deployment?.webhookUrl) return;

        const body = JSON.stringify({ event, deploymentId, timestamp: new Date().toISOString(), ...payload });

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Oddjob-Event": event,
        };

        if (deployment.webhookSecret) {
            const sig = createHmac("sha256", deployment.webhookSecret).update(body).digest("hex");
            headers["X-Oddjob-Signature"] = `sha256=${sig}`;
        }

        try {
            await postWithRetry(deployment.webhookUrl, body, headers);
            logger.info(`Webhook ${event} delivered to deployment ${deploymentId}`);
        } catch (err: any) {
            logger.error(`Webhook delivery failed for deployment ${deploymentId}: ${err.message}`);
        }
    }
};
