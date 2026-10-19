import { pgTable, serial, integer, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { apps } from "../apps.js";
import { approvalRequests } from "../hil.js";

export const forgeReleases = pgTable("forge_releases", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    artifactHash: text("artifact_hash"),
    qaEvidence: jsonb("qa_evidence").default({}),
    securityScanResult: jsonb("security_scan_result").default({}),
    approvalRequestId: integer("approval_request_id").references(() => approvalRequests.id),
    status: text("status").notNull().default("pending"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    deployedBy: text("deployed_by"),
    rollbackFromReleaseId: integer("rollback_from_release_id"),
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    appIdx: index("idx_forge_releases_app").on(t.appId),
    orgIdx: index("idx_forge_releases_org").on(t.organizationId),
    statusIdx: index("idx_forge_releases_status").on(t.status),
    appVersionIdx: uniqueIndex("idx_forge_releases_app_version").on(t.appId, t.version),
}));

export type ForgeRelease = typeof forgeReleases.$inferSelect;
export type InsertForgeRelease = typeof forgeReleases.$inferInsert;


