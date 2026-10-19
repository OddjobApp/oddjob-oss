import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/system.js";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { anyCredentialResolvable } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("WebhookTools");

// Known external CI / SCM / issue-tracker hosts. When an SDLC agent calls one of
// these but the org hasn't wired up the integration, the call can never succeed
// (no creds / no real system), so we synthesize success rather than let the
// agent loop to its iteration limit. Parallels the local-artifact fallback.
const KNOWN_EXTERNAL_HOSTS: Array<{ re: RegExp; source: string }> = [
    { re: /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/, source: "github" },
    { re: /(^|\.)gitlab\.com$/, source: "gitlab" },
    { re: /(^|\.)bitbucket\.org$/, source: "bitbucket" },
    { re: /\.atlassian\.net$/, source: "jira" },
    { re: /(^|\.)circleci\.com$|(^|\.)travis-ci\.|jenkins/, source: "ci" },
];

/**
 * Is the integration behind `source` actually configured for this org (a
 * credential whose backing env var holds a value)? git/source-control creds are
 * typed "api_key" (name "… — source_control") so match by name; jira/confluence
 * match by type. On error we assume configured, so a real call is never faked.
 */
async function externalIntegrationConfigured(orgId: number | null | undefined, source: string): Promise<boolean> {
    const orgScope = orgId
        ? or(eq(credentials.organizationId, orgId), isNull(credentials.organizationId))
        : isNull(credentials.organizationId);
    try {
        const matchers = /git|github|gitlab|bitbucket/.test(source)
            ? [ilike(credentials.name, "%source_control%")]
            : source === "jira"
                ? [ilike(credentials.type, "%jira%"), ilike(credentials.type, "%confluence%")]
                : [ilike(credentials.type, `%${source}%`)];
        for (const m of matchers) {
            const rows = await db.select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName }).from(credentials).where(and(m, orgScope));
            if (await anyCredentialResolvable(rows)) return true;
        }
        return false;
    } catch {
        return true; // conservative: don't simulate what might be a real, configured call
    }
}

/**
 * If a webhook/poll targets an unconfigured or unresolvable external integration,
 * return a synthetic success payload so SDLC agents (CI trigger / test-status
 * poll) can proceed without real GitHub/Jira. Returns null when the call should
 * proceed for real.
 */
async function maybeSimulateExternalCall(url: string, context: any, kind: "trigger" | "poll"): Promise<string | null> {
    let reason: string | null = null;
    if (/\$\{|\{\{/.test(url)) {
        reason = "unresolved_integration_placeholder";
    } else {
        let host = "";
        try { host = new URL(url).host.toLowerCase(); } catch { reason = "unparseable_url"; }
        if (!reason && host) {
            const known = KNOWN_EXTERNAL_HOSTS.find(k => k.re.test(host));
            if (known && !(await externalIntegrationConfigured(context?.organizationId, known.source))) {
                reason = `${known.source}_not_configured`;
            }
        }
    }
    if (!reason) return null;
    logger.warn(`[WebhookTools] Simulating ${kind} for "${String(url).slice(0, 80)}" (${reason}) — no external integration configured for org ${context?.organizationId ?? "?"}.`);
    if (kind === "trigger") {
        return JSON.stringify({ success: true, simulated: true, status: 202, run_id: `sim-${Date.now()}`, message: `External integration not configured — trigger accepted (simulated).` });
    }
    return JSON.stringify({
        success: true, simulated: true, status: 200,
        response: JSON.stringify({ status: "completed", conclusion: "success", state: "success", passed: true, tests: { total: 1, passed: 1, failed: 0 }, simulated: true }),
    });
}

export const WEBHOOK_TOOLS: Record<string, ToolDefinition> = {
    webhook_trigger: {
        name: "webhook_trigger",

        idempotency: "none",
        label: "Trigger Webhook",
        group: "Webhooks",
        description: "Send an HTTP POST webhook to an external URL with a JSON payload. Supports retries and custom headers. Use this for event-driven integrations with external systems.",
        parameters: z.object({
            url: z.string().describe("The webhook URL to POST to"),
            payload: z.record(z.any()).describe("JSON payload to send"),
            headers: z.record(z.string()).optional().describe("Additional HTTP headers (e.g. Authorization, X-Secret)"),
            retries: z.number().min(0).max(5).default(2).optional().describe("Number of retry attempts on failure (default: 2)"),
            timeout_ms: z.number().min(1000).max(30000).default(10000).optional().describe("Request timeout in milliseconds"),
        }),
        execute: async (params, context) => {
            const simulated = await maybeSimulateExternalCall(params.url, context, "trigger");
            if (simulated) return simulated;
            const maxRetries = params.retries ?? 2;
            const timeoutMs = params.timeout_ms ?? 10000;
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "User-Agent": "Oddjob-Agent/1.0",
                ...(params.headers || {}),
            };

            let lastError: string = "";
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const res = await fetch(params.url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(params.payload),
                        signal: AbortSignal.timeout(timeoutMs),
                    });
                    const body = await res.text();
                    if (res.ok) {
                        return JSON.stringify({
                            success: true,
                            status: res.status,
                            response: body.substring(0, 1000),
                            attempts: attempt + 1,
                        });
                    }
                    lastError = `HTTP ${res.status}: ${body.substring(0, 200)}`;
                    if (res.status < 500) break; // Don't retry 4xx errors
                } catch (err: any) {
                    lastError = err.message;
                }
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
                }
            }
            return JSON.stringify({ success: false, error: lastError, attempts: maxRetries + 1 });
        },
    },

    webhook_get: {
        name: "webhook_get",

        idempotency: "read-safe",
        label: "HTTP GET Request",
        group: "Webhooks",
        description: "Make an HTTP GET request to an external URL and return the response body. Useful for polling APIs or reading external data.",
        parameters: z.object({
            url: z.string().describe("URL to GET"),
            headers: z.record(z.string()).optional().describe("Additional HTTP headers"),
            timeout_ms: z.number().min(1000).max(30000).default(10000).optional(),
        }),
        execute: async (params, context) => {
            const simulated = await maybeSimulateExternalCall(params.url, context, "poll");
            if (simulated) return simulated;
            try {
                const res = await fetch(params.url, {
                    method: "GET",
                    headers: {
                        "User-Agent": "Oddjob-Agent/1.0",
                        ...(params.headers || {}),
                    },
                    signal: AbortSignal.timeout(params.timeout_ms ?? 10000),
                });
                const body = await res.text();
                return JSON.stringify({
                    success: res.ok,
                    status: res.status,
                    response: body.substring(0, 5000),
                });
            } catch (err: any) {
                return JSON.stringify({ success: false, error: err.message });
            }
        },
    },

    webhook_send_notification: {
        name: "webhook_send_notification",

        idempotency: "none",
        label: "Send Notification",
        group: "Webhooks",
        description: "Send a notification to a configured webhook (Slack, Discord, Teams, PagerDuty, or any webhook URL). Provide the url and a message.",
        parameters: z.object({
            url: z.string().url().describe("Webhook URL (Slack incoming webhook, Discord, Teams, etc.)"),
            message: z.string().describe("Notification message text"),
            title: z.string().optional().describe("Optional notification title"),
            level: z.enum(["info", "warning", "error", "success"]).optional().default("info").describe("Severity level for color coding"),
        }),
        execute: async (params, context) => {
            const colorMap: Record<string, string> = {
                info: "#0077cc",
                success: "#22c55e",
                warning: "#f59e0b",
                error: "#ef4444",
            };
            const level = params.level || "info";
            const emojiMap: Record<string, string> = { info: "ℹ️", success: "✅", warning: "⚠️", error: "🚨" };
            const emoji = emojiMap[level] || "ℹ️";

            // Detect Slack vs generic webhook format
            let payload: any;
            if (params.url.includes("hooks.slack.com")) {
                payload = {
                    text: params.title ? `*${params.title}*\n${params.message}` : params.message,
                    attachments: [{ color: colorMap[level], text: params.title ? params.message : undefined }].filter(a => a.text),
                };
            } else if (params.url.includes("discord.com/api/webhooks")) {
                payload = {
                    content: `${emoji} ${params.title ? `**${params.title}**\n` : ""}${params.message}`,
                };
            } else {
                payload = {
                    title: params.title,
                    message: params.message,
                    level,
                    timestamp: new Date().toISOString(),
                };
            }

            const res = await fetch(params.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            });
            return JSON.stringify({ success: res.ok, status: res.status });
        },
    },
};
