/**
 * Workflow event import and measurement retrieval.
 *
 * The import boundary enforces §8.1: Oddjob measures only what it is explicitly
 * given. Every row must declare where it came from, and an uploaded row must
 * carry the same required fields as a connector one — an import that quietly
 * accepts a row with no timestamp produces a report that looks complete and
 * is not.
 *
 * Rejected rows are RETURNED to the caller with reasons, never dropped
 * silently. A validation report the importer never sees is the same thing as
 * no validation.
 */

import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    workflowEvents,
    type WorkflowEvent,
    type WorkflowEventSource,
    type WorkflowEventType,
} from "@shared/schema/improvement/index.js";

import { measureWorkflow, type WorkflowMeasurementReport } from "./workflow-measurement.service.js";

const logger = createLogger("WorkflowImportService");

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<WorkflowEventType>([
    "entered", "started", "completed", "handed_off", "reopened", "approved", "rejected", "cancelled",
]);

const VALID_SOURCES: ReadonlySet<string> = new Set<WorkflowEventSource>([
    "oddjob", "connector", "upload", "attestation",
]);

export interface RawWorkflowEventInput {
    caseId?: unknown;
    eventId?: unknown;
    eventType?: unknown;
    stepKey?: unknown;
    occurredAt?: unknown;
    actorType?: unknown;
    actorIdHash?: unknown;
    attributes?: Record<string, unknown>;
}

export interface RejectedRow {
    index: number;
    reason: string;
}

export interface ImportReport {
    workflowKey: string;
    received: number;
    accepted: number;
    duplicates: number;
    rejected: RejectedRow[];
    /** accepted / received, 0-1, 4dp. */
    acceptanceRate: number;
}

function validateRow(row: RawWorkflowEventInput, index: number): RejectedRow | null {
    const fail = (reason: string): RejectedRow => ({ index, reason });

    if (typeof row.caseId !== "string" || !row.caseId.trim()) {
        return fail("caseId is required and must be a non-empty string. It is never inferred.");
    }
    if (typeof row.eventId !== "string" || !row.eventId.trim()) {
        return fail("eventId is required; it makes re-import idempotent.");
    }
    if (typeof row.stepKey !== "string" || !row.stepKey.trim()) {
        return fail("stepKey is required.");
    }
    if (typeof row.eventType !== "string" || !VALID_EVENT_TYPES.has(row.eventType)) {
        return fail(`eventType must be one of: ${[...VALID_EVENT_TYPES].join(", ")}.`);
    }
    if (row.occurredAt === null || row.occurredAt === undefined || row.occurredAt === "") {
        return fail("occurredAt is required. A missing timestamp lowers coverage; it is never imputed.");
    }
    if (Number.isNaN(new Date(row.occurredAt as any).getTime())) {
        return fail("occurredAt must be a valid date.");
    }
    return null;
}

export class WorkflowImportService {
    /**
     * Import events for one workflow.
     *
     * Idempotent per `(organizationId, workflowKey, eventId)`: re-importing the
     * same file counts duplicates rather than doubling every case, which every
     * rate in the measurement report divides by.
     */
    async importEvents(
        organizationId: number,
        workflowKey: string,
        sourceType: WorkflowEventSource,
        sourceReference: string,
        rows: RawWorkflowEventInput[],
        projectId?: number | null,
    ): Promise<ImportReport> {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new BadRequestError("Workflow import requires a resolved organization.");
        }
        if (!workflowKey?.trim()) throw new BadRequestError("workflowKey is required");
        if (!VALID_SOURCES.has(sourceType)) {
            throw new BadRequestError(`sourceType must be one of: ${[...VALID_SOURCES].join(", ")}`);
        }
        if (!sourceReference?.trim()) {
            throw new BadRequestError(
                "sourceReference is required — an event that cannot name its origin cannot be cited as evidence.",
            );
        }

        const rejected: RejectedRow[] = [];
        const valid: RawWorkflowEventInput[] = [];
        rows.forEach((row, index) => {
            const failure = validateRow(row, index);
            if (failure) rejected.push(failure);
            else valid.push(row);
        });

        let accepted = 0;
        let duplicates = 0;

        for (const row of valid) {
            const inserted = await db
                .insert(workflowEvents)
                .values({
                    organizationId,
                    projectId: projectId ?? null,
                    workflowKey: workflowKey.trim(),
                    caseId: String(row.caseId).trim(),
                    eventId: String(row.eventId).trim(),
                    eventType: row.eventType as WorkflowEventType,
                    stepKey: String(row.stepKey).trim(),
                    actorType: (row.actorType as any) ?? null,
                    actorIdHash: (row.actorIdHash as string) ?? null,
                    occurredAt: new Date(row.occurredAt as any),
                    sourceType,
                    sourceReference: sourceReference.trim(),
                    attributes: row.attributes ?? {},
                })
                .onConflictDoNothing({
                    target: [
                        workflowEvents.organizationId,
                        workflowEvents.workflowKey,
                        workflowEvents.eventId,
                    ],
                })
                .returning({ id: workflowEvents.id });

            if (inserted.length > 0) accepted += 1;
            else duplicates += 1;
        }

        const report: ImportReport = {
            workflowKey,
            received: rows.length,
            accepted,
            duplicates,
            rejected,
            acceptanceRate: rows.length === 0 ? 0 : Math.round((accepted / rows.length) * 10000) / 10000,
        };

        logger.info(
            `[Improvement] Imported '${workflowKey}' for org ${organizationId}: ${accepted} accepted, ${duplicates} duplicate, ${rejected.length} rejected.`,
        );
        return report;
    }

    /** Compute the deterministic report over a window. */
    async measure(
        organizationId: number,
        workflowKey: string,
        window: { from?: Date; to?: Date } = {},
        options: { minCasesForBottleneck?: number } = {},
    ): Promise<WorkflowMeasurementReport> {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new BadRequestError("Workflow measurement requires a resolved organization.");
        }

        const conditions = [
            eq(workflowEvents.organizationId, organizationId),
            eq(workflowEvents.workflowKey, workflowKey),
        ];
        if (window.from) conditions.push(gte(workflowEvents.occurredAt, window.from));
        if (window.to) conditions.push(lte(workflowEvents.occurredAt, window.to));

        const events: WorkflowEvent[] = await db
            .select()
            .from(workflowEvents)
            .where(and(...conditions))
            .orderBy(workflowEvents.occurredAt);

        return measureWorkflow(workflowKey, events, options);
    }
}

export const workflowImportService = new WorkflowImportService();
