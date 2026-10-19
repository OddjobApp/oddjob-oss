/**
 * Write access to an installed app's stored records (`app_records`) behind
 * approval gates and platform actions.
 *
 * Tenant and app boundaries are enforced on every write: a tenant can only
 * mutate their own rows in an app installed for their organization.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { isWorkflowReceiptCollection, isSdlcSourceCollection } from '@shared/governed-app-collections.js';

export interface AppRecordActionParams {
    organizationId: number;
    appId: number;
    collection: string;
    action: "create_record" | "update_record" | "delete_record";
    recordId?: string | null;
    data?: Record<string, unknown> | null;
    userId?: string | null;
}

export interface AppRecordActionResult {
    success: boolean;
    action: string;
    recordId: string;
    collection: string;
    data?: Record<string, unknown>;
    discarded?: boolean;
    error?: string;
}

export async function executeAppRecordAction(params: AppRecordActionParams): Promise<AppRecordActionResult> {
    const { organizationId, appId, collection, action } = params;
    if (isWorkflowReceiptCollection(collection)) throw new BadRequestError('Use the handoff API; generic record actions cannot forge or alter workflow receipts.');
    if (isSdlcSourceCollection(collection)) throw new BadRequestError('Use the SDLC workbench API; source evidence must be bound and validated, not written through generic record actions.');

    if (!collection || typeof collection !== "string") {
        throw new BadRequestError("Collection is required.");
    }

    if (action === "create_record") {
        const rawData = params.data && typeof params.data === "object" ? { ...params.data } : {};
        const recordId =
            (params.recordId && String(params.recordId).trim()) ||
            (rawData.id ? String(rawData.id) : null) ||
            (rawData.recordId ? String(rawData.recordId) : null) ||
            `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const [existing] = await db
            .select({ id: appRecords.id })
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, organizationId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, recordId),
                ),
            )
            .limit(1);

        if (existing) {
            // The approver saw "create". Writing over a record they never saw
            // would replace it wholesale; changing a record is update_record.
            throw new BadRequestError(
                `Record '${recordId}' already exists in collection '${collection}'. Propose update_record to change it.`,
            );
        }

        await db.insert(appRecords).values({
            appId,
            orgId: organizationId,
            collection,
            recordId,
            data: rawData as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        return {
            success: true,
            action: "create_record",
            recordId,
            collection,
            data: rawData,
        };
    }

    if (action === "update_record") {
        const recordId = params.recordId ? String(params.recordId).trim() : null;
        if (!recordId) {
            throw new BadRequestError("recordId is required to update a record.");
        }

        const [existing] = await db
            .select()
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, organizationId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, recordId),
                ),
            )
            .limit(1);

        if (!existing) {
            throw new NotFoundError(`Record '${recordId}' not found in collection '${collection}'.`);
        }

        const currentData = (existing.data && typeof existing.data === "object" ? existing.data : {}) as Record<string, unknown>;
        const patchData = params.data && typeof params.data === "object" ? params.data : {};
        const mergedData = { ...currentData, ...patchData };

        await db
            .update(appRecords)
            .set({
                data: mergedData as any,
                updatedAt: new Date(),
            })
            .where(eq(appRecords.id, existing.id));

        return {
            success: true,
            action: "update_record",
            recordId,
            collection,
            data: mergedData,
        };
    }

    if (action === "delete_record") {
        const recordId = params.recordId ? String(params.recordId).trim() : null;
        if (!recordId) {
            throw new BadRequestError("recordId is required to delete a record.");
        }

        const [existing] = await db
            .select({ id: appRecords.id })
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, appId),
                    eq(appRecords.orgId, organizationId),
                    eq(appRecords.collection, collection),
                    eq(appRecords.recordId, recordId),
                ),
            )
            .limit(1);

        if (!existing) {
            throw new NotFoundError(`Record '${recordId}' not found in collection '${collection}'.`);
        }

        await db
            .delete(appRecords)
            .where(eq(appRecords.id, existing.id));

        return {
            success: true,
            action: "delete_record",
            recordId,
            collection,
        };
    }

    throw new BadRequestError(`Unsupported action: ${action}`);
}
