/**
 * StudioEntitlementService
 *
 * Runtime feature flags for CREW studios at the organization level. A studio in
 * the gated set must be entitled before it can be mounted in a CREW room.
 *
 * For the MVP this only covers the four studios with heavy infrastructure
 * footprints: media, prediction, computer, signal.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    organizationStudioEntitlements,
    type OrganizationStudioEntitlementRecord,
} from "@shared/schema/index.js";
import { STUDIOS, STUDIO_KINDS, type StudioKind } from "@shared/studio-registry.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ValidationError } from "@server/utils/errors.js";

const logger = createLogger("StudioEntitlementService");

export const GATED_STUDIO_KINDS: readonly StudioKind[] = [
    "media",
    "prediction",
    "computer",
    "signal",
];

const GATED_STUDIO_SET = new Set<string>(GATED_STUDIO_KINDS);

const GATED_MOUNT_TOOLS: Record<string, StudioKind> = {
    mount_media_studio: "media",
    mount_prediction_studio: "prediction",
    mount_computer_studio: "computer",
    mount_signal_studio: "signal",
};

export interface StudioListing {
    kind: StudioKind;
    name: string;
    installed: boolean;
    installedAt: string | null;
    installedByUserId: string | null;
}

export class StudioEntitlementService {
    /**
     * List the studios available in the marketplace, marking which ones are
     * installed for the given organization.
     */
    async list(orgId: number): Promise<StudioListing[]> {
        const rows = await db
            .select()
            .from(organizationStudioEntitlements)
            .where(eq(organizationStudioEntitlements.organizationId, orgId));

        const installed = new Map<string, OrganizationStudioEntitlementRecord>();
        for (const row of rows) {
            installed.set(row.studioKind, row);
        }

        return GATED_STUDIO_KINDS.map((kind) => {
            const entitlement = installed.get(kind);
            return {
                kind,
                name: STUDIOS[kind].name,
                installed: !!entitlement,
                installedAt: entitlement?.installedAt?.toISOString() ?? null,
                installedByUserId: entitlement?.installedByUserId ?? null,
            };
        });
    }

    /**
     * Returns true if the studio is gated and enabled for the organization.
     * Non-gated studios are always considered enabled.
     */
    async isEnabled(orgId: number, kind: StudioKind): Promise<boolean> {
        if (!GATED_STUDIO_SET.has(kind)) return true;

        const rows = await db
            .select({ id: organizationStudioEntitlements.id })
            .from(organizationStudioEntitlements)
            .where(
                and(
                    eq(organizationStudioEntitlements.organizationId, orgId),
                    eq(organizationStudioEntitlements.studioKind, kind),
                ),
            )
            .limit(1);

        return rows.length > 0;
    }

    /**
     * Enable a studio for an organization. Idempotent.
     */
    async install(
        orgId: number,
        userId: string,
        kind: StudioKind,
    ): Promise<OrganizationStudioEntitlementRecord> {
        if (!GATED_STUDIO_SET.has(kind)) {
            throw new ValidationError(`Studio '${kind}' is not available as an add-on`);
        }
        if (!STUDIO_KINDS.includes(kind)) {
            throw new ValidationError(`Unknown studio kind '${kind}'`);
        }

        const [row] = await db
            .insert(organizationStudioEntitlements)
            .values({ organizationId: orgId, studioKind: kind, installedByUserId: userId })
            .onConflictDoNothing({
                target: [
                    organizationStudioEntitlements.organizationId,
                    organizationStudioEntitlements.studioKind,
                ],
            })
            .returning();

        if (row) {
            logger.info("Studio entitlement installed", { orgId, kind, userId });
            return row;
        }

        const existing = await db
            .select()
            .from(organizationStudioEntitlements)
            .where(
                and(
                    eq(organizationStudioEntitlements.organizationId, orgId),
                    eq(organizationStudioEntitlements.studioKind, kind),
                ),
            )
            .limit(1);

        if (!existing[0]) {
            throw new NotFoundError(`Studio entitlement '${kind}' not found`);
        }
        return existing[0];
    }

    /**
     * Disable a studio for an organization.
     */
    async uninstall(orgId: number, kind: StudioKind): Promise<void> {
        if (!GATED_STUDIO_SET.has(kind)) {
            throw new ValidationError(`Studio '${kind}' is not available as an add-on`);
        }

        const result = await db
            .delete(organizationStudioEntitlements)
            .where(
                and(
                    eq(organizationStudioEntitlements.organizationId, orgId),
                    eq(organizationStudioEntitlements.studioKind, kind),
                ),
            );

        if (result.rowCount && result.rowCount > 0) {
            logger.info("Studio entitlement uninstalled", { orgId, kind });
        }
    }
}

export const studioEntitlementService = new StudioEntitlementService();

/** Maps a tool name to the gated studio kind it mounts, if any. */
export function getGatedStudioKindForTool(toolName: string): StudioKind | undefined {
    return GATED_MOUNT_TOOLS[toolName];
}
