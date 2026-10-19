import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    varchar,
    timestamp,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { STUDIO_KINDS, type StudioKind } from "../studio-registry.js";

// ============================================================================
// ORGANIZATION STUDIO ENTITLEMENTS
// ============================================================================

/**
 * Which CREW studios an organization has enabled. Studios listed here are
 * available for mounting in CREW rooms and surfaced in the workspace UI.
 *
 * This is intentionally separate from billing/subscription tables: it is the
 * runtime feature flag. A future billing integration can write rows here when
 * an add-on is purchased.
 */
export const organizationStudioEntitlements = pgTable(
    "organization_studio_entitlements",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        studioKind: varchar("studio_kind", { length: 32 }).notNull(),
        installedByUserId: varchar("installed_by_user_id", { length: 255 }),
        installedAt: timestamp("installed_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgIdx: index("idx_org_studio_entitlements_org").on(table.organizationId),
        uniqueOrgStudio: uniqueIndex("idx_org_studio_entitlements_unique").on(
            table.organizationId,
            table.studioKind,
        ),
    }),
);

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const studioKindSchema = z.string().refine(
    (value): value is StudioKind => STUDIO_KINDS.includes(value as StudioKind),
    { message: "Invalid studio kind" },
);

export const insertOrganizationStudioEntitlementSchema = createInsertSchema(
    organizationStudioEntitlements,
    {
        installedByUserId: z.string().max(255).optional(),
    },
).omit({
    id: true,
    installedAt: true,
    updatedAt: true,
});

export const installStudioInputSchema = z.object({
    studioKind: studioKindSchema,
});

// ============================================================================
// TYPES
// ============================================================================

export type OrganizationStudioEntitlementRecord =
    typeof organizationStudioEntitlements.$inferSelect;
export type OrganizationStudioEntitlementCreateInput = z.infer<
    typeof insertOrganizationStudioEntitlementSchema
>;
export type InstallStudioInput = z.infer<typeof installStudioInputSchema>;
