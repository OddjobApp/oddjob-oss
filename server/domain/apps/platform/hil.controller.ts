import { type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { hilForms, apps } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { hilRequests } from "@domain/pipeline/core/hil-requests.service.js";
import { normalizeHilFields, getHilStage, matchesHilStage } from "../apps-platform.helpers.js";

const logger = createLogger("AppPlatformHilController");

const MAX_FIELDS = 30;
const MAX_OPTIONS = 100;

/** A trimmed string of at most `max` chars, or "" for anything that is not text or a number. */
function clip(value: unknown, max: number): string {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value).trim().slice(0, max);
}

/** A choice as a plain value or {label, value}; anything else is dropped. */
function option(value: unknown): string | number | { label: string; value: string | number } | null {
    if (typeof value === "string") return value.slice(0, 200);
    if (typeof value === "number") return value;
    if (value && typeof value === "object") {
        const o = value as Record<string, unknown>;
        const v = typeof o.value === "number" ? o.value : clip(o.value, 200);
        const label = clip(o.label ?? o.value, 200);
        if (v === "" || !label) return null;
        return { label, value: v };
    }
    return null;
}

export class HilController {
    public static async getHilForms(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;
        const stage = (req.query.stage as string | undefined)?.trim();
        const appOnly = req.query.scope === 'app';

        const rows = await db
            .select({
                id: hilForms.id,
                name: hilForms.name,
                description: hilForms.description,
                schema: hilForms.schema,
                config: hilForms.config,
                createdAt: hilForms.createdAt,
            })
            .from(hilForms)
            .where(
                and(
                    eq(hilForms.organizationId, orgId),
                    // Requests only: pre-kind builder templates were saved as "pending"
                    // and showed up here as things awaiting a decision.
                    eq(hilForms.kind, "request"),
                    eq(hilForms.status, "pending"),
                    eq(hilForms.isArchived, false),
                    ...(appOnly ? [sql`${hilForms.schema}->>'sourceType' = 'app'`, sql`${hilForms.schema}->>'sourceId' = ${String(deploymentId)}`] : []),
                ),
            )
            .orderBy(desc(hilForms.createdAt))
            .limit(50);

        const pending = rows
            .filter((row) =>
                matchesHilStage(stage, {
                    name: row.name,
                    schema: row.schema ?? {},
                    config: row.config ?? {},
                }),
            )
            .map((row) => {
                const schema = (row.schema ?? {}) as any;
                const config = (row.config ?? {}) as any;
                return {
                    id: String(row.id),
                    formName: row.name,
                    stage: getHilStage(schema, config),
                    fields: normalizeHilFields(schema),
                    context: {
                        ...(row.description ? { description: row.description } : {}),
                        ...(schema.context ?? {}),
                        ...(config ?? {}),
                    },
                    createdAt: row.createdAt,
                    slaHours: config.slaHours ?? schema.slaHours,
                };
            });

        res.json(pending);
    }

    public static async createHilForm(req: Request, res: Response) {
        const { orgId, appId, deploymentId } = req.appTokenContext!;
        const { prompt, context: hilContext, fields, schema: customSchema, name: customName, submitLabel } = req.body;
        if (!prompt || typeof prompt !== "string")
            throw new BadRequestError("'prompt' is required");

        const [appRow] = await db
            .select({ name: apps.name })
            .from(apps)
            .where(eq(apps.id, appId))
            .limit(1);

        const rawFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : (Array.isArray(customSchema?.fields) && customSchema.fields.length > 0
                ? customSchema.fields
                : null);

        // App-authored input: bound it before it is stored and rendered in a room.
        // The renderer maps unknown types to text, so types are only clipped here.
        if (rawFields && rawFields.length > MAX_FIELDS)
            throw new BadRequestError(`A request can ask at most ${MAX_FIELDS} fields.`);
        const seenKeys = new Set<string>();
        const normalizedFields = rawFields
            ? rawFields.map((f: any, idx: number) => {
                let key = clip(f?.key || f?.name, 64) || `field_${idx}`;
                // A repeated key would make two answers overwrite each other.
                if (seenKeys.has(key)) key = `${key}_${idx}`;
                seenKeys.add(key);
                const options = Array.isArray(f?.options)
                    ? f.options.slice(0, MAX_OPTIONS).map(option).filter((o: unknown) => o !== null)
                    : null;
                const placeholder = clip(f?.placeholder, 200);
                const defaultValue = ["string", "number", "boolean"].includes(typeof f?.defaultValue) ? f.defaultValue : undefined;
                return {
                    key,
                    type: clip(f?.type, 32) || "text",
                    label: clip(f?.label || f?.title || f?.key, 200) || `Field ${idx + 1}`,
                    required: f?.required !== false,
                    ...(options ? { options } : {}),
                    ...(placeholder ? { placeholder } : {}),
                    ...(defaultValue !== undefined ? { defaultValue } : {}),
                };
              })
            : [
                {
                    key: "response",
                    type: "text",
                    label: "Response",
                    required: true,
                },
              ];

        // A request attributed to this app deployment. It has no pipeline step
        // execution: it surfaces as a standalone review item in the HIL queue with
        // source metadata in the schema.
        const form = await hilRequests.create({
            source: "app",
            name: clip(customName, 200) || `App HIL: ${appRow?.name ?? `app-${appId}`}`,
            description: prompt,
            schema: {
                fields: normalizedFields,
                sourceType: "app",
                sourceId: String(deploymentId),
                sourceLabel: appRow?.name ?? `app-${appId}`,
                context: hilContext ?? {},
                ...(clip(submitLabel, 40) ? { submitLabel: clip(submitLabel, 40) } : {}),
            },
            organizationId: orgId,
        });

        logger.info(`[AppPlatform] App ${appId} raised HIL form ${form.id} with ${normalizedFields.length} field(s)`);
        res.status(201).json({ id: form.id, status: "pending" });
    }

    public static async submitHilForm(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        const formId = Number.parseInt(req.params.formId, 10);
        if (Number.isNaN(formId)) throw new BadRequestError("Invalid formId");

        const [form] = await db
            .update(hilForms)
            .set({
                status: "completed",
                data: req.body ?? {},
                submittedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(hilForms.id, formId),
                    eq(hilForms.organizationId, orgId),
                    eq(hilForms.kind, "request"),
                    eq(hilForms.status, "pending"),
                ),
            )
            .returning({
                id: hilForms.id,
                status: hilForms.status,
                stepExecutionId: hilForms.stepExecutionId,
            });

        if (!form) throw new NotFoundError("Pending HIL form not found");

        // Advance the suspended mission pipeline. Marking the form completed alone left
        // the linked pipeline step at `waiting_external_input` forever — so an approval
        // submitted from a workbench app (e.g. the Decision Control Panel) recorded the
        // decision but never progressed the cycle. resumeSuspendedStep advances the step
        // and resumes the execution; it is idempotent and a no-op when the form is not
        // tied to a still-waiting step.
        if (form.stepExecutionId != null) {
            try {
                const { approvalService } =
                    await import("@domain/integrations/core/approval.service.js");
                await approvalService.resumeSuspendedStep(
                    { id: form.id, executionId: String(form.stepExecutionId) },
                    { decision: "approved", modifiedOutput: req.body ?? {} },
                );
            } catch (err: any) {
                logger.error(
                    `[AppPlatform] Failed to resume pipeline for HIL form ${formId} (step ${form.stepExecutionId}): ${err.message}`,
                );
            }
        }

        logger.info(`[AppPlatform] App ${appId} submitted HIL form ${formId}`);
        res.json({ ok: true, id: String(form.id), status: form.status });
    }

    public static async pollHilForm(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        const formId = parseInt(req.params.formId);
        if (isNaN(formId)) throw new BadRequestError("Invalid formId");

        const [form] = await db
            .select({
                id: hilForms.id,
                status: hilForms.status,
                data: hilForms.data,
                organizationId: hilForms.organizationId,
            })
            .from(hilForms)
            .where(and(eq(hilForms.id, formId), eq(hilForms.organizationId, orgId)))
            .limit(1);

        if (!form) throw new NotFoundError("HIL form not found");

        logger.info(
            `[AppPlatform] App ${appId} polled HIL form ${formId} → status: ${form.status}`,
        );
        res.json({
            id: form.id,
            status: form.status ?? "pending",
            data: form.status === "completed" ? form.data : null,
        });
    }

    /**
     * Bulk-submit multiple HIL form decisions at once.
     * Processes each decision sequentially and returns per-item success/failure status.
     */
    public static async bulkSubmitHilForms(req: Request, res: Response) {
        const { orgId, appId } = req.appTokenContext!;
        const { decisions } = req.body;

        if (!Array.isArray(decisions) || decisions.length === 0) {
            throw new BadRequestError("'decisions' must be a non-empty array");
        }

        const results: Array<{ hilId: string; success: boolean; error?: string }> = [];

        for (const decision of decisions) {
            const { hilId, values } = decision;

            if (!hilId || typeof hilId !== "string") {
                results.push({ hilId: hilId ?? "unknown", success: false, error: "Invalid hilId" });
                continue;
            }

            if (!values || typeof values !== "object") {
                results.push({ hilId, success: false, error: "Invalid values" });
                continue;
            }

            const formId = Number.parseInt(hilId, 10);
            if (Number.isNaN(formId)) {
                results.push({ hilId, success: false, error: "hilId must be a numeric string" });
                continue;
            }

            try {
                const [form] = await db
                    .update(hilForms)
                    .set({
                        status: "completed",
                        data: values,
                        submittedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(hilForms.id, formId),
                            eq(hilForms.organizationId, orgId),
                            eq(hilForms.kind, "request"),
                            eq(hilForms.status, "pending"),
                        ),
                    )
                    .returning({
                        id: hilForms.id,
                        status: hilForms.status,
                        stepExecutionId: hilForms.stepExecutionId,
                    });

                if (!form) {
                    results.push({ hilId, success: false, error: "Pending HIL form not found" });
                    continue;
                }

                // Resume the suspended mission pipeline if linked to a step execution
                if (form.stepExecutionId != null) {
                    try {
                        const { approvalService } =
                            await import("@domain/integrations/core/approval.service.js");
                        await approvalService.resumeSuspendedStep(
                            { id: form.id, executionId: String(form.stepExecutionId) },
                            { decision: "approved", modifiedOutput: values },
                        );
                    } catch (err: any) {
                        logger.error(
                            `[AppPlatform] Bulk: Failed to resume pipeline for HIL form ${formId} (step ${form.stepExecutionId}): ${err.message}`,
                        );
                        // Still mark as success since the form itself was submitted
                    }
                }

                results.push({ hilId, success: true });
            } catch (err: any) {
                logger.error(`[AppPlatform] Bulk: Error processing HIL form ${hilId}: ${err.message}`);
                results.push({ hilId, success: false, error: err.message });
            }
        }

        const totalFailed = results.filter((r) => !r.success).length;
        logger.info(
            `[AppPlatform] App ${appId} bulk-submitted ${results.length} HIL forms (${totalFailed} failed)`,
        );

        res.json({
            results,
            totalProcessed: results.length,
            totalFailed,
        });
    }
}
