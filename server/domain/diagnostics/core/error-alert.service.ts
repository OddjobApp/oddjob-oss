/**
 * Error Alert Service
 *
 * Backs the /api/alert-configs endpoints with the error_alert_configs and
 * error_alerts tables.
 *
 * This replaces a stub that pretended to work: createConfig() returned
 * `{ id: 1, ...config }` — a fabricated id for a row that was never written —
 * while updateConfig() and deleteConfig() echoed their arguments back and
 * getConfigs()/getAlertHistory() always returned []. So the UI reported every save
 * as successful, handed back id 1 every time, and then showed an empty list.
 * Silently discarding configuration while claiming success is worse than an
 * outright failure, because nothing surfaces it.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { errorAlertConfigs, errorAlerts } from "@shared/schema/index.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("ErrorAlertService");

export interface AlertConfigInput {
    organizationId?: number | null;
    name: string;
    enabled?: boolean;
    errorCategories?: string[];
    minOccurrences?: number;
    timeWindowMinutes?: number;
    pipelineIds?: number[] | null;
    notifyVia?: string[];
    slackWebhookUrl?: string | null;
    slackChannel?: string | null;
    emailRecipients?: string[];
    cooldownMinutes?: number;
}

/**
 * Org predicate for alert configs.
 *
 * An absent organization means global configs only — NOT "every config". Returning
 * unscoped rows for a null org is the tenant-leak shape this codebase has hit
 * before, so it is spelled out here rather than left to a falsy check.
 */
function orgCondition(organizationId?: number | null) {
    return organizationId == null
        ? isNull(errorAlertConfigs.organizationId)
        : eq(errorAlertConfigs.organizationId, organizationId);
}

export const errorAlertService = {
    async getConfigs(organizationId?: number) {
        return db
            .select()
            .from(errorAlertConfigs)
            .where(orgCondition(organizationId))
            .orderBy(desc(errorAlertConfigs.createdAt));
    },

    async createConfig(config: AlertConfigInput): Promise<number> {
        const [row] = await db
            .insert(errorAlertConfigs)
            .values({
                organizationId: config.organizationId ?? null,
                name: config.name,
                enabled: config.enabled ?? true,
                errorCategories: config.errorCategories ?? [],
                minOccurrences: config.minOccurrences ?? 3,
                timeWindowMinutes: config.timeWindowMinutes ?? 60,
                pipelineIds: config.pipelineIds ?? null,
                // notify_via is NOT NULL in the schema.
                notifyVia: config.notifyVia ?? [],
                slackWebhookUrl: config.slackWebhookUrl ?? null,
                slackChannel: config.slackChannel ?? null,
                emailRecipients: config.emailRecipients ?? [],
                cooldownMinutes: config.cooldownMinutes ?? 30,
            })
            .returning({ id: errorAlertConfigs.id });

        return row.id;
    },

    /**
     * Updates a config. organizationId scopes the write — the route previously
     * carried the comment "Check ownership/permissions (omitted for brevity)",
     * which meant any authenticated caller could modify another tenant's config by
     * guessing its id. Returns false when nothing matched.
     */
    async updateConfig(id: number, patch: Partial<AlertConfigInput>, organizationId?: number): Promise<boolean> {
        const fields: Record<string, unknown> = { updatedAt: new Date() };
        const assign = <K extends keyof AlertConfigInput>(key: K, column: string) => {
            if (patch[key] !== undefined) fields[column] = patch[key];
        };
        assign("name", "name");
        assign("enabled", "enabled");
        assign("errorCategories", "errorCategories");
        assign("minOccurrences", "minOccurrences");
        assign("timeWindowMinutes", "timeWindowMinutes");
        assign("pipelineIds", "pipelineIds");
        assign("notifyVia", "notifyVia");
        assign("slackWebhookUrl", "slackWebhookUrl");
        assign("slackChannel", "slackChannel");
        assign("emailRecipients", "emailRecipients");
        assign("cooldownMinutes", "cooldownMinutes");

        const updated = await db
            .update(errorAlertConfigs)
            .set(fields as any)
            .where(and(eq(errorAlertConfigs.id, id), orgCondition(organizationId)))
            .returning({ id: errorAlertConfigs.id });

        return updated.length > 0;
    },

    async deleteConfig(id: number, organizationId?: number): Promise<boolean> {
        const removed = await db
            .delete(errorAlertConfigs)
            .where(and(eq(errorAlertConfigs.id, id), orgCondition(organizationId)))
            .returning({ id: errorAlertConfigs.id });

        return removed.length > 0;
    },

    async getAlertHistory(configId?: number, organizationId?: number) {
        // error_alerts has no organization column of its own; it is scoped through
        // the config it belongs to.
        const scopedConfigIds = db
            .select({ id: errorAlertConfigs.id })
            .from(errorAlertConfigs)
            .where(orgCondition(organizationId));

        const conditions = [sql`${errorAlerts.configId} IN ${scopedConfigIds}`];
        if (configId !== undefined) conditions.push(eq(errorAlerts.configId, configId));

        return db
            .select()
            .from(errorAlerts)
            .where(and(...conditions))
            .orderBy(desc(errorAlerts.triggeredAt))
            .limit(200);
    },

    /**
     * Records a triggered alert and stamps the config's lastTriggeredAt.
     *
     * NOTE: this persists the alert; it does not deliver the notification. Slack and
     * email dispatch belong to the integrations layer and are not wired here, so
     * notificationSent is written as false rather than claiming a delivery that did
     * not happen. Nothing in the codebase calls sendAlert yet — the evaluation loop
     * that would detect "N errors of category X within M minutes" does not exist.
     */
    async sendAlert(params: {
        configId: number;
        errorCount: number;
        errorCategory?: string;
        pipelineId?: number;
        diagnosisSummary?: unknown;
        sampleErrors?: string[];
    }) {
        const [row] = await db
            .insert(errorAlerts)
            .values({
                configId: params.configId,
                errorCount: params.errorCount,
                errorCategory: params.errorCategory ?? null,
                pipelineId: params.pipelineId ?? null,
                diagnosisSummary: (params.diagnosisSummary ?? null) as any,
                sampleErrors: params.sampleErrors ?? [],
                notificationSent: false,
                notificationError: "Notification delivery is not implemented; alert recorded only.",
            })
            .returning({ id: errorAlerts.id });

        await db
            .update(errorAlertConfigs)
            .set({ lastTriggeredAt: new Date() })
            .where(eq(errorAlertConfigs.id, params.configId));

        logger.info(`[ErrorAlert] Recorded alert ${row.id} for config ${params.configId} (${params.errorCount} errors)`);
        return { id: row.id, notificationSent: false };
    },

    /**
     * Decides whether a diagnosis should raise an alert, and raises it.
     *
     * This is the evaluation loop that was missing when this service was written in
     * 926bc11e5: sendAlert could record an alert, but nothing ever decided to call it,
     * so a config could be created and never fire. Executable specs for it existed in
     * tests/cross-domain/error-alert-service.test.ts and had never run, because a stray
     * apostrophe in a vi.mock specifier stopped the file transforming (dbdff9ec7).
     *
     * The three filters run BEFORE counting on purpose. Counting errors across a time
     * window is the expensive part, and a config that cannot fire — wrong category,
     * wrong pipeline, still cooling down — should not pay for it.
     */
    async checkAlertConditions(
        diagnosis: { bestMatch?: { pattern?: { category?: string } } | null },
        organizationId: number,
        pipelineId?: number,
    ): Promise<void> {
        const category = diagnosis?.bestMatch?.pattern?.category;

        const active = await db.execute(sql`
            SELECT * FROM error_alert_configs
            WHERE enabled = true AND organization_id = ${organizationId}
        `);
        const configs: any[] = (active as any)?.rows ?? [];
        if (configs.length === 0) return;

        for (const config of configs) {
            // An empty list means "any category" rather than "no categories".
            const categories: string[] = config.error_categories ?? [];
            if (categories.length > 0 && (!category || !categories.includes(category))) continue;

            const pipelineIds: number[] = config.pipeline_ids ?? [];
            if (pipelineIds.length > 0 && (pipelineId === undefined || !pipelineIds.includes(pipelineId))) continue;

            // Cooldown, so one broken pipeline does not page someone every few seconds.
            const cooldownMinutes = Number(config.cooldown_minutes ?? 0);
            if (config.last_triggered_at && cooldownMinutes > 0) {
                const elapsedMs = Date.now() - new Date(config.last_triggered_at).getTime();
                if (elapsedMs < cooldownMinutes * 60000) continue;
            }

            const windowMinutes = Number(config.time_window_minutes ?? 60);
            const counted = await db.execute(sql`
                SELECT COUNT(*) AS count FROM error_diagnoses
                WHERE organization_id = ${organizationId}
                  AND created_at > NOW() - (${windowMinutes} * INTERVAL '1 minute')
            `);
            const occurrences = Number((counted as any)?.rows?.[0]?.count ?? 0);
            if (occurrences < Number(config.min_occurrences ?? 1)) continue;

            await this.triggerAlert(config, occurrences, diagnosis, organizationId);
        }
    },

    /** Records the alert, stamps the cooldown, then notifies. */
    async triggerAlert(
        config: any,
        occurrences: number,
        diagnosis: any,
        organizationId: number,
    ): Promise<void> {
        const sampled = await db.execute(sql`
            SELECT error_message FROM error_diagnoses
            WHERE organization_id = ${organizationId}
            ORDER BY created_at DESC LIMIT 5
        `);
        const samples: string[] = ((sampled as any)?.rows ?? [])
            .map((r: any) => r.error_message)
            .filter(Boolean);

        await db.execute(sql`
            INSERT INTO error_alerts (config_id, error_count, error_category, sample_errors, notification_sent)
            VALUES (${config.id}, ${occurrences}, ${diagnosis?.bestMatch?.pattern?.category ?? null},
                    ${JSON.stringify(samples)}, false)
        `);

        // Stamped BEFORE delivery: a webhook that hangs must not leave the cooldown
        // unset and let the very next error alert all over again.
        await db.execute(sql`
            UPDATE error_alert_configs SET last_triggered_at = NOW() WHERE id = ${config.id}
        `);

        const notifyVia: string[] = config.notify_via ?? config.notifyVia ?? [];
        let delivered = false;
        let failure: string | null = null;

        if (notifyVia.includes("slack")) {
            const webhook = config.slack_webhook_url ?? config.slackWebhookUrl;
            if (webhook) {
                try {
                    await this.sendSlackAlert({ name: config.name, slackWebhookUrl: webhook }, occurrences, diagnosis, samples);
                    delivered = true;
                } catch (err: any) {
                    failure = err?.message ?? String(err);
                    logger.warn(`[ErrorAlert] Slack delivery failed for config ${config.id}: ${failure}`);
                }
            }
        }

        await db.execute(sql`
            UPDATE error_alerts
            SET notification_sent = ${delivered}, notification_error = ${failure}
            WHERE config_id = ${config.id}
        `);
    },

    /**
     * Posts the alert to a Slack incoming webhook.
     *
     * Throws on a non-ok response rather than reporting success: the caller records
     * notification_sent from this, and a swallowed failure would claim someone was
     * paged when they were not.
     */
    async sendSlackAlert(
        config: { name?: string; slackWebhookUrl?: string | null },
        occurrences: number,
        diagnosis: any,
        samples: string[],
    ): Promise<void> {
        const webhook = config.slackWebhookUrl;
        if (!webhook) throw new Error("No Slack webhook configured");

        const summary = diagnosis?.bestMatch?.pattern?.diagnosis?.summary
            ?? diagnosis?.bestMatch?.pattern?.category
            ?? "Unclassified error";

        const body = {
            text: `Error alert: ${config.name ?? "Unnamed alert"}`,
            blocks: [
                { type: "header", text: { type: "plain_text", text: `${config.name ?? "Unnamed alert"}` } },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${summary}* - ${occurrences} occurrences in the configured window.`,
                    },
                },
                ...(samples.length > 0
                    ? [{ type: "section", text: { type: "mrkdwn", text: samples.slice(0, 5).join(" | ") } }]
                    : []),
            ],
        };

        const res = await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
    },

    /** Verifies a webhook before it is saved. Returns false rather than throwing. */
    async testSlackWebhook(webhookUrl: string): Promise<boolean> {
        try {
            const res = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "Oddjob alert webhook test - configuration is working." }),
            });
            return Boolean((res as any)?.ok);
        } catch {
            return false;
        }
    },

    async getActiveAlerts(organizationId?: number) {
        return this.getAlertHistory(undefined, organizationId);
    },
};
