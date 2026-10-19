import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";

/**
 * Why a permitted capability could not be invoked.
 *
 * Derived mechanically from two booleans at the point of failure — never
 * recovered from message text downstream. The distinction is the whole point:
 * `missing` is a capability-gap candidate, `unavailable` is an allotment or
 * recruitment problem, and conflating them turns every permission denial into
 * evidence that a new tool should be built.
 */
export type CapabilityGapFailureClass =
    | "missing"
    | "unavailable"
    | "unauthorized"
    | "incompatible";

/**
 * Which identifier stands in for "one run" when deduplicating.
 *
 * Deliberately excludes `jobId`: jobs are keyed by name and reused across
 * cycles, so a job id identifies a definition, not an execution of one.
 */
export type CapabilityGapRunRefSource = "execution" | "mission" | "trace";

/**
 * Append-only record of a capability that an agent tried and could not use.
 *
 * This is the evidence source the capability-invention workflow reads. Before
 * this table existed the missing-tool path returned a bare string from the tool
 * executor before any telemetry was initialised, so a missing capability reached
 * no table and no trace, and was indistinguishable in the transcript from a tool
 * that ran and reported an error.
 *
 * `organizationId` is NOT NULL: the table is new, so there are no unattributed
 * legacy rows to accommodate, and the emitter drops an event outright rather
 * than writing one under a default tenant.
 */
export const capabilityGapEvents = pgTable(
    "capability_gap_events",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        projectId: integer("project_id"),
        missionId: integer("mission_id"),
        /**
         * The unit per-run deduplication counts on. NULL means no run identity
         * was available (an ad-hoc copilot call, say); such rows are excluded
         * from frequency scoring rather than given a synthetic id.
         */
        runRef: text("run_ref"),
        runRefSource: text("run_ref_source").$type<CapabilityGapRunRefSource>(),
        /**
         * Stable hash of the acting user, for DISTINCT counts only. Hashed per
         * §14: the score needs how many people were affected, and nothing else
         * about them. NULL means no user was behind the call (a scheduled job,
         * a system agent) — a different fact from an unrecorded one, and
         * excluded from the count rather than treated as one more person.
         */
        actorUserHash: text("actor_user_hash"),
        /** The name as the model wrote it, before normalization. */
        requestedToolName: text("requested_tool_name").notNull(),
        /** The `normalizeToolName` result, when it resolved to a real tool. */
        canonicalToolName: text("canonical_tool_name"),
        failureClass: text("failure_class").$type<CapabilityGapFailureClass>().notNull(),
        /** The tool exists in the registry. */
        registryHit: boolean("registry_hit").notNull(),
        /** The tool was in this run's permitted allotment. */
        allotmentHit: boolean("allotment_hit").notNull(),
        occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    },
    (table) => [
        index("capability_gap_events_org_occurred_idx").on(table.organizationId, table.occurredAt),
        index("capability_gap_events_org_class_tool_idx").on(
            table.organizationId,
            table.failureClass,
            table.requestedToolName,
        ),
        // Per-run deduplication reads this.
        index("capability_gap_events_org_run_idx").on(table.organizationId, table.runRef),
        index("capability_gap_events_org_tool_actor_idx").on(
            table.organizationId,
            table.requestedToolName,
            table.actorUserHash,
        ),
    ],
);

export type CapabilityGapEvent = typeof capabilityGapEvents.$inferSelect;
export type InsertCapabilityGapEvent = typeof capabilityGapEvents.$inferInsert;
