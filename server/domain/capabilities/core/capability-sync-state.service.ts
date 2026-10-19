/**
 * Read model for capability sync state.
 *
 * Extracted from capability-sync.route.ts: route handlers must not query the
 * database directly (lint:arch, Deep Module pattern).
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { capabilitySyncState } from "@shared/schema/index.js";

export const capabilitySyncStateService = {
    /** Every tracked capability for an org, most recently synced first. */
    async listForOrg(organizationId: number) {
        return await db
            .select({
                capabilityId: capabilitySyncState.capabilityId,
                capabilityVersion: capabilitySyncState.capabilityVersion,
                schemaVersion: capabilitySyncState.schemaVersion,
                lastSource: capabilitySyncState.lastSource,
                revision: capabilitySyncState.revision,
                riskProfile: capabilitySyncState.riskProfile,
                signatureHash: capabilitySyncState.signatureHash,
                updatedAt: capabilitySyncState.updatedAt,
            })
            .from(capabilitySyncState)
            .where(eq(capabilitySyncState.organizationId, organizationId))
            .orderBy(desc(capabilitySyncState.updatedAt));
    },
};
