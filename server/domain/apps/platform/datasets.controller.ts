import { type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appRecords, appDeployments } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { resolveOrgAppIdBySlug } from "../apps-platform.helpers.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { evaluateQualityEvidence } from "../../../blueprints/apps/sdlc-workbench/lib/workflow-safety.js";
import { SDLC_SOURCE_COLLECTIONS } from '@shared/sdlc-stage-handoff.js';
import { isWorkflowReceiptCollection, isSdlcSourceCollection } from '@shared/governed-app-collections.js';
import { requireSdlcBinding } from '../core/sdlc-stage-handoffs.service.js';

const logger = createLogger("AppPlatformDatasetsController");

export const IMMUTABLE_DECISION_COLLECTIONS = [
    ...SDLC_SOURCE_COLLECTIONS,
    "training_signoffs",
    "deployment_log",
] as const;

function parseCollection(req: Request): string {
    const c = (req.query.collection as string | undefined)?.trim();
    if (!c) throw new BadRequestError("'collection' query parameter is required");
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(c)) {
        throw new BadRequestError(
            "collection must be 1–60 alphanumeric/dash/underscore characters",
        );
    }
    return c;
}

export class DatasetsController {
    public static async getDatasets(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const collection = parseCollection(req);

        // Optional read-only sibling read: a companion app (e.g. the advisor) can
        // pass ?source_app=<blueprint-slug> to read another app's collection
        // WITHIN THE SAME ORG. Resolution is org-scoped, so this never crosses a
        // tenant boundary; writes (POST/PUT/DELETE) stay bound to the token's app.
        let readAppId = appId;
        const sourceApp =
            typeof req.query.source_app === "string"
                ? req.query.source_app.trim()
                : "";
        if (sourceApp && sourceApp !== "") {
            if (isWorkflowReceiptCollection(collection)) throw new ForbiddenError('Workflow handoffs are private to the owning app.');
            if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sourceApp)) {
                throw new BadRequestError("Invalid source_app");
            }
            const resolved = await resolveOrgAppIdBySlug(orgId, sourceApp);
            if (resolved == null) {
                throw new NotFoundError(
                    `source_app "${sourceApp}" not found in this organization`,
                );
            }
            readAppId = resolved;
        }

        const rows = await db
            .select()
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, readAppId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                ),
            )
            .orderBy(desc(appRecords.createdAt));

        res.json(
            rows.map((r) => ({
                id: r.recordId,
                ...(r.data as object),
                _recordId: r.recordId,
                _createdAt: r.createdAt,
                _updatedAt: r.updatedAt,
            })),
        );
    }

    public static async createDataset(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const collection = parseCollection(req);
        if (isWorkflowReceiptCollection(collection)) throw new BadRequestError('Use the governed handoff API for workflow receipts.');

        const data = req.body;
        if (typeof data !== "object" || Array.isArray(data) || data === null) {
            throw new BadRequestError("Request body must be a JSON object");
        }
        // Browser-authored fields cannot manufacture a source binding.
        if (isSdlcSourceCollection(collection)) {
            delete data.sdlcContext;
            if (req.query.crewRoom) data.sdlcContext = (await requireSdlcBinding(req.appTokenContext!, req.query.crewRoom)).binding;
        }

        if (collection === "qa_workbench_quality_gates") {
            // Recompute from persisted evidence. A browser cannot declare itself
            // passed merely by posting a gate record.
            const readEvidence = async (name: string) => (await db.select().from(appRecords).where(and(
                eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, name),
            )).orderBy(desc(appRecords.createdAt))).map(row => row.data as any);
            const [suites, defects] = await Promise.all([
                readEvidence("qa_workbench_test_suites"), readEvidence("qa_workbench_defects"),
            ]);
            const evaluated = evaluateQualityEvidence(suites, defects, String(data.commitSha ?? ""));
            if (data.result === "pass" && !evaluated.passed) throw new BadRequestError(evaluated.reasons.join("; "));
            data.result = evaluated.passed ? "pass" : "fail";
            data.reasons = evaluated.reasons;
            data.suiteCount = suites.length;
            data.evidenceKind = evaluated.passed ? "runner" : "unverified";
        }

        const recordId = crypto.randomUUID();
        const [row] = await db
            .insert(appRecords)
            .values({ appId, orgId, collection, recordId, data })
            .returning();

        res.status(201).json({
            id: row.recordId,
            ...(row.data as object),
            _recordId: row.recordId,
            _createdAt: row.createdAt,
            _updatedAt: row.updatedAt,
        });
    }

    public static async updateDataset(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const collection = parseCollection(req);
        if (isWorkflowReceiptCollection(collection)) throw new BadRequestError('Workflow receipts cannot be edited through datasets.');
        if ((IMMUTABLE_DECISION_COLLECTIONS as readonly string[]).includes(collection)) {
            throw new BadRequestError("Saved gates and approvals are immutable; record a new decision");
        }
        const recordId = req.params.id;

        const [existing] = await db
            .select()
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, recordId),
                ),
            )
            .limit(1);

        if (!existing) throw new NotFoundError("Record not found");

        const merged = { ...(existing.data as object), ...req.body };
        const [updated] = await db
            .update(appRecords)
            .set({ data: merged, updatedAt: new Date() })
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, recordId),
                ),
            )
            .returning();

        res.json({
            id: updated.recordId,
            ...(updated.data as object),
            _recordId: updated.recordId,
            _createdAt: updated.createdAt,
            _updatedAt: updated.updatedAt,
        });
    }

    public static async deleteDataset(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const collection = parseCollection(req);
        if (isWorkflowReceiptCollection(collection)) throw new BadRequestError('Workflow receipts cannot be deleted through datasets.');
        if ((IMMUTABLE_DECISION_COLLECTIONS as readonly string[]).includes(collection)) {
            throw new BadRequestError("Saved gates and approvals are immutable; record a new decision");
        }

        const deleted = await db
            .delete(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, req.params.id),
                ),
            )
            .returning({ id: appRecords.recordId });

        if (deleted.length === 0) throw new NotFoundError("Record not found");
        res.status(204).end();
    }

    public static async queryPlatformDataset(req: Request, res: Response) {
        const { deploymentId, orgId } = req.appTokenContext!;

        // 1. Parse and validate datasetId
        const datasetId = parseInt(req.params.datasetId, 10);
        if (!Number.isFinite(datasetId) || datasetId < 1) {
            throw new BadRequestError("datasetId must be a valid positive integer");
        }

        // 2. Fetch deployment's allowedDatasetIds
        const [deployment] = await db
            .select({ allowedDatasetIds: appDeployments.allowedDatasetIds })
            .from(appDeployments)
            .where(eq(appDeployments.id, deploymentId))
            .limit(1);

        const allowed = deployment?.allowedDatasetIds ?? [];
        if (allowed.length === 0) {
            throw new ForbiddenError("No platform datasets are accessible for this deployment");
        }
        if (!allowed.includes(datasetId)) {
            throw new ForbiddenError("Dataset is not accessible for this deployment");
        }

        // 3. Build query options from request body
        const { filter, sortBy, sortOrder, limit, offset } = req.body ?? {};
        const options: {
            filter?: { field: string; value: string };
            sortBy?: string;
            sortOrder?: "asc" | "desc";
            limit?: number;
            offset?: number;
        } = {};

        if (filter && typeof filter === "object" && filter.field && filter.value) {
            options.filter = { field: String(filter.field), value: String(filter.value) };
        }
        if (sortBy && typeof sortBy === "string") {
            options.sortBy = sortBy;
            options.sortOrder = sortOrder === "asc" ? "asc" : "desc";
        }
        if (typeof limit === "number") {
            options.limit = Math.min(Math.max(1, limit), 200);
        }
        if (typeof offset === "number" && offset >= 0) {
            options.offset = offset;
        }

        // 4. Query via datasetService
        const orgContext: OrgContext = { organizationId: orgId, userId: "system" } as OrgContext;
        const result = await datasetService.getItems(datasetId, orgContext, options);

        res.json({ items: result.items, total: result.total });
    }
}
