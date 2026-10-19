import {
    pgTable,
    serial,
    integer,
    text,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";

import { orgs } from "../auth.js";
import { ontologyObjectTypes } from "./ontology.js";

/**
 * Ontology Type Version History
 *
 * Records immutable snapshots of ontology object type definitions each time a
 * definition is created or modified. Enables full version history queries and
 * supports the ontology migration workflow (Requirement 6, Acceptance Criteria 3–5).
 *
 * Version numbers are monotonically increasing integers starting at 1, scoped
 * per entity type per organization.
 */
export const ontologyTypeVersions = pgTable("ontology_type_versions", {
    id: serial("id").primaryKey(),
    objectTypeId: integer("object_type_id")
        .references(() => ontologyObjectTypes.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    version: integer("version").notNull(),
    definitionSnapshot: jsonb("definition_snapshot").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex("ontology_version_unique").on(table.objectTypeId, table.version),
    index("ontology_version_org_idx").on(table.organizationId),
]);

export type OntologyTypeVersion = typeof ontologyTypeVersions.$inferSelect;
export type InsertOntologyTypeVersion = typeof ontologyTypeVersions.$inferInsert;
