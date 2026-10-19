import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";
import type { ChangeTargetType } from "./change-sets.js";

/**
 * Where a version of a target came from.
 *
 * §9.3 requires this to be visible: a packaged YAML definition and a runtime
 * customization are different things, and silently overwriting one with the
 * other is how an organization's local change disappears on the next deploy.
 */
export type TargetVersionSource =
    | "packaged_yaml"
    | "org_fork"
    | "runtime_customization"
    | "generated_draft"
    | "restored";

/**
 * A durable, immutable snapshot of a mutable target.
 *
 * §9.3 asks for "a durable blueprint-version table rather than metadata-only
 * history". The existing PATCH keeps at most ten metadata entries, and only
 * while a cycle is active or paused — so the version a change set was authored
 * against could vanish before it was applied, and rollback had nothing to
 * restore from.
 *
 * Rows are never updated. A new state is a new row, which is what makes
 * `expectedVersion` on a change set mean something checkable and makes
 * "restore a previously verified version" a real operation rather than a hope.
 */
export const improvementTargetVersions = pgTable(
    "improvement_target_versions",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        targetType: text("target_type").$type<ChangeTargetType>().notNull(),
        targetId: text("target_id").notNull(),

        /** Monotonic per target, starting at 1. Rendered as `v{n}`. */
        versionNumber: integer("version_number").notNull(),
        /** Content hash of the snapshot — identity independent of the counter. */
        contentHash: text("content_hash").notNull(),
        /** The full target state at this version. */
        snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),

        source: text("source").$type<TargetVersionSource>().notNull(),
        /** The change set that produced this version, when one did. */
        producedByChangeSetId: integer("produced_by_change_set_id"),
        /**
         * Whether this version was verified healthy after application. Rollback
         * targets a VERIFIED version, never merely a previous one — restoring
         * to a state that was itself broken is not a recovery.
         */
        verifiedAt: timestamp("verified_at"),

        createdBy: text("created_by").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("improvement_target_versions_unique").on(
            table.organizationId,
            table.targetType,
            table.targetId,
            table.versionNumber,
        ),
        index("improvement_target_versions_target_idx").on(
            table.organizationId,
            table.targetType,
            table.targetId,
        ),
    ],
);

export type ImprovementTargetVersion = typeof improvementTargetVersions.$inferSelect;
export type InsertImprovementTargetVersion = typeof improvementTargetVersions.$inferInsert;
