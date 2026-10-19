/**
 * CREW Group Chat Schema
 *
 * A crew session is a multi-agent discussion room: several agent cards are added
 * to one conversation, agents respond to each other based on the topic under
 * discussion, the user participates as a first-class speaker, and a supervisor
 * ("manager") critiques contributions, refines consensus, summarises, takes
 * notes and introduces intents.
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    text,
    timestamp,
    boolean,
    jsonb,
    real,
    index,
    uniqueIndex,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { agentCards } from "./agent-cards.js";
import { knowledgeTopics } from "./knowledge-base.js";
import type { CrewRoomBrief } from '../crew-room-brief.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Who produced a turn in the transcript. */
export const crewSpeakerTypes = ["user", "agent", "supervisor"] as const;
export type CrewSpeakerType = (typeof crewSpeakerTypes)[number];

/**
 * The supervisor's output kinds. `critique` and `consensus` target the
 * discussion; `summary` and `note` record it; `intent` introduces a new thread
 * of enquiry into the room.
 */
export const supervisorNoteTypes = [
    "note",
    "critique",
    "consensus",
    "summary",
    "intent",
] as const;
export type SupervisorNoteType = (typeof supervisorNoteTypes)[number];

export const crewPlanStatuses = ["proposed", "accepted", "superseded"] as const;
export type CrewPlanStatus = (typeof crewPlanStatuses)[number];

export const crewParticipantRoles = ["owner", "member"] as const;
export type CrewParticipantRole = (typeof crewParticipantRoles)[number];

export const crewIssueSeverities = ["low", "medium", "high"] as const;
export type CrewIssueSeverity = (typeof crewIssueSeverities)[number];

export const crewIssueStatuses = ["open", "acknowledged", "resolved", "dismissed"] as const;
export type CrewIssueStatus = (typeof crewIssueStatuses)[number];

export const crewRoomModes = ["explore", "decide", "build", "investigate", "operate", "review"] as const;
export type CrewRoomMode = (typeof crewRoomModes)[number];
export const crewDecisionStatuses = ["proposed", "accepted", "rejected", "superseded"] as const;
export type CrewDecisionStatus = (typeof crewDecisionStatuses)[number];
export const crewClaimStatuses = ["unverified", "supported", "disputed", "refuted"] as const;
export type CrewClaimStatus = (typeof crewClaimStatuses)[number];
export const crewCommitmentStatuses = ["open", "in_progress", "blocked", "completed", "cancelled"] as const;
export type CrewCommitmentStatus = (typeof crewCommitmentStatuses)[number];

export interface CrewRoomMemory {
    activeAgentSelections?: Record<string, number[]>;
    roomBrief?: CrewRoomBrief;
    facts: string[];
    hypotheses: string[];
    openQuestions: string[];
    constraints: string[];
    ontologyRefs: Array<{ objectType: string; objectId: string | number; label?: string }>;
    updatedRound: number;
    /** When true, agent-declared topic tags persist 'pending' until the room owner decides. */
    agentTagApproval?: boolean;
    /** Latest CREW application plan, carried from requirements through Forge deployment. */
    activeAppArchitecturePlan?: {
        appName: string;
        requirements?: string;
        archetype: string;
        layout: string;
        surfaces: readonly string[];
        capabilities: readonly string[];
        integrations: readonly string[];
        recommendedTool: string;
        requiresForgeGeneration: boolean;
    };
}

export interface CrewClaimPosition {
    agent: string;
    stance: "support" | "dissent";
    confidence: number;
    proposition: string;
}

export interface CrewPlanStep {
    order: number;
    description: string;
    /** Agent card name suggested to own this step, when the supervisor assigns one. */
    owner?: string;
}

export interface CrewCycleContext {
    developmentBinding?: { repositoryUrl: string; branch: string; testEnvironment: string; configuredAt: string; configuredBy: string };
    /** Initial studio for room-specific resource tools. */
    studio?: string;
    authoringPaused?: boolean;
    cycleId?: number;
    cycleSlug?: string;
    cycleName?: string;
    stageId?: string;
    stageName?: string;
    appSlugs?: string[];
    requiredDecisions?: string[];
    isStandingRoom?: boolean;
}

// ============================================================================
// TABLES
// ============================================================================

export const crewSessions = pgTable("crew_sessions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    /** Client-generated session identifier, stable for the life of the room. */
    sessionKey: text("session_key").notNull(),
    title: text("title"),
    status: text("status").$type<"active" | "archived">().default("active").notNull(),
    mode: text("mode").$type<CrewRoomMode>().default("explore").notNull(),
    memory: jsonb("memory").$type<CrewRoomMemory>().default(sql`'{"facts":[],"hypotheses":[],"openQuestions":[],"constraints":[],"ontologyRefs":[],"updatedRound":0}'::jsonb`).notNull(),
    createdBy: text("created_by"),
    /**
     * The Project Space this room belongs to. Nullable for rooms created before
     * scoping existed; recall treats unscoped entries as visible only to
     * unscoped discussions.
     */
    projectId: integer("project_id"),
    /** When this room is linked to an Operational Cycle, the cycle slug. */
    cycleSlug: text("cycle_slug"),
    /** When this room is tied to a specific cycle stage or ceremony, the stage id. */
    cycleStageId: text("cycle_stage_id"),
    /** Structured metadata linking the room to its cycle, stage, and fleet apps. */
    cycleContext: jsonb("cycle_context").$type<CrewCycleContext>(),
    // The supervisor's standing read on the room — rewritten each round, unlike
    // the accumulating per-round rows in supervisorNotes.
    activeTopic: text("active_topic"),
    /**
     * When the standing topic corresponds to a declared-tag topic, the
     * knowledge_topics row it resolved to. `activeTopic` keeps the prose;
     * this is the entity link.
     */
    activeTopicId: integer("active_topic_id").references(
        (): AnyPgColumn => knowledgeTopics.id,
        { onDelete: "set null" },
    ),
    nextSteps: text("next_steps"),
    /** 0-100: how close the crew currently is to agreement. */
    consensusLevel: integer("consensus_level"),
    /** Flag indicating the current round should be cancelled. */
    interrupting: boolean("interrupting").default(false).notNull(),
    /** Timestamp of last completed round, for cooldown enforcement. */
    lastRoundCompletedAt: timestamp("last_round_completed_at"),
    /**
     * When this session is a breakout, the id of the parent session that
     * spawned it. Null for top-level rooms.
     */
    parentSessionId: integer("parent_session_id").references(
        (): AnyPgColumn => crewSessions.id,
        { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    orgKeyUnique: uniqueIndex("crew_sessions_org_key_unique").on(
        table.organizationId,
        table.sessionKey,
    ),
    orgIdx: index("idx_crew_sessions_org").on(table.organizationId),
    parentIdx: index("idx_crew_sessions_parent").on(table.parentSessionId),
    cycleIdx: index("idx_crew_sessions_cycle").on(table.organizationId, table.cycleSlug),
}));

export const crewMembers = pgTable("crew_members", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    agentCardId: integer("agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    joinedAt: timestamp("joined_at").defaultNow(),
}, (table) => ({
    sessionCardUnique: uniqueIndex("crew_members_session_card_unique").on(
        table.sessionId,
        table.agentCardId,
    ),
}));

/**
 * Humans in a crew room. Mirrors the principal shape project_members uses, so
 * membership questions are answered the same way across the platform.
 */
export const crewParticipants = pgTable("crew_participants", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").$type<CrewParticipantRole>().default("member").notNull(),
    invitedBy: text("invited_by"),
    joinedAt: timestamp("joined_at").defaultNow(),
    lastSeenAt: timestamp("last_seen_at"),
}, (table) => ({
    sessionUserUnique: uniqueIndex("crew_participants_session_user_unique").on(
        table.sessionId,
        table.userId,
    ),
    userIdx: index("idx_crew_participants_user").on(table.userId),
}));

export const crewTurns = pgTable("crew_turns", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    speakerType: text("speaker_type").$type<CrewSpeakerType>().notNull(),
    agentCardId: integer("agent_card_id").references(() => agentCards.id, {
        onDelete: "set null",
    }),
    speakerName: text("speaker_name").notNull(),
    /** Which person wrote this turn. Null for agent and supervisor turns. */
    userId: text("user_id"),
    content: text("content").notNull(),
    /** Discussion round this turn belongs to; a user message opens a new round. */
    round: integer("round").default(0).notNull(),
    /**
     * The turn being replied to. This is what makes agent-to-agent exchange
     * representable rather than a flat fan of replies to the user.
     */
    inReplyToTurnId: integer("in_reply_to_turn_id").references(
        (): AnyPgColumn => crewTurns.id,
        { onDelete: "set null" },
    ),
    topic: text("topic"),
    intent: text("intent"),
    resolvedModelId: integer("resolved_model_id"),
    /**
     * The model/provider that actually served the turn. resolvedModelId records
     * the row the turn resolved to; these record what answered — under provider
     * failover they differ, and wasFallback marks the turn so a degraded answer
     * is not mistaken for the requested model's work.
     */
    servedModel: text("served_model"),
    servedProvider: text("served_provider"),
    wasFallback: boolean("was_fallback").default(false),
    latencyMs: integer("latency_ms"),
    /** Read-only tools the agent actually called while producing this turn. */
    toolsUsed: jsonb("tools_used")
        .$type<Array<{ name: string; ok: boolean; ms: number; error?: string }>>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    /** The kind of work this turn did, classified from tools_used at post
     * time — "inbox_briefings", "engineering_product", etc. */
    workType: text("work_type"),
    /** Renderable surfaces (forms, instant apps) the agent produced this turn. */
    artifacts: jsonb("artifacts")
        .$type<Array<{ tool: string; payload: Record<string, unknown> }>>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    sessionIdx: index("idx_crew_turns_session").on(table.sessionId, table.id),
    sessionRoundIdx: index("idx_crew_turns_session_round").on(table.sessionId, table.round, table.id),
    orgIdx: index("idx_crew_turns_org").on(table.organizationId),
}));

/**
 * Declared-topic tags (`#[Multi Word]` or `#single-word`) a turn carries.
 * One row per (turn, label); `topicId` links the tag to the knowledge_topics
 * vocabulary row it resolved or created, while `label`/`rawLabel` keep the
 * record readable if the topic is later deleted.
 *
 * Deliberately separate from crew_turns.topic: that column holds the intent
 * router's classified TopicCategory — a different vocabulary with different
 * consumers. These rows are what the speaker declared, not what the
 * classifier guessed.
 */
export const crewTurnTopics = pgTable("crew_turn_topics", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    turnId: integer("turn_id")
        .references(() => crewTurns.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    round: integer("round").default(0).notNull(),
    topicId: integer("topic_id").references(() => knowledgeTopics.id, {
        onDelete: "set null",
    }),
    /** Normalized display label ("Q4 Launch") — survives topic deletion. */
    label: text("label").notNull(),
    /** The tag as typed ("q4-launch"). */
    rawLabel: text("raw_label").notNull(),
    /** Who declared the tag. */
    source: text("source").$type<"user" | "agent" | "supervisor" | "system">().notNull(),
    /**
     * 'applied' = live; 'pending' = an agent declared it while the room's
     * agentTagApproval setting is on and it awaits the room owner; 'rejected'
     * = dismissed. User-declared tags never go through this gate.
     */
    status: text("status").$type<"applied" | "pending" | "rejected">().default("applied").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    turnLabelUnique: uniqueIndex("crew_turn_topics_turn_label_unique").on(table.turnId, table.label),
    sessionIdx: index("idx_ctt_session").on(table.sessionId),
    topicIdx: index("idx_ctt_topic").on(table.topicId),
    orgIdx: index("idx_ctt_org").on(table.organizationId),
}));

export const supervisorNotes = pgTable("supervisor_notes", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    noteType: text("note_type").$type<SupervisorNoteType>().notNull(),
    content: text("content").notNull(),
    round: integer("round").default(0).notNull(),
    /** The turn a critique refers to, when the note is about one contribution. */
    targetTurnId: integer("target_turn_id").references(() => crewTurns.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    sessionIdx: index("idx_supervisor_notes_session").on(table.sessionId, table.id),
    typeIdx: index("idx_supervisor_notes_type").on(table.sessionId, table.noteType),
}));

/**
 * An issue raised by the crew. A low consensus score alongside a supervisor
 * critique means the room looked at something and could not agree — worth
 * surfacing rather than burying in a transcript.
 */
export const crewIssues = pgTable("crew_issues", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    round: integer("round").default(0).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    severity: text("severity").$type<CrewIssueSeverity>().default("medium").notNull(),
    consensusLevel: integer("consensus_level"),
    projectId: integer("project_id"),
    status: text("status").$type<CrewIssueStatus>().default("open").notNull(),
    sourceTurnId: integer("source_turn_id").references(() => crewTurns.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
}, (table) => ({
    orgStatusIdx: index("idx_crew_issues_org_status").on(table.organizationId, table.status),
    sessionIdx: index("idx_crew_issues_session").on(table.sessionId, table.id),
}));

/**
 * What the keyword classifier guessed for a round, against what the discussion
 * actually revealed the user wanted. A labelled corpus for measuring routing.
 */
export const crewIntentObservations = pgTable("crew_intent_observations", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    round: integer("round").default(0).notNull(),
    promptHash: text("prompt_hash").notNull(),
    promptExcerpt: text("prompt_excerpt"),
    classifiedTopic: text("classified_topic").notNull(),
    classifiedTopicConfidence: real("classified_topic_confidence"),
    classifiedIntent: text("classified_intent").notNull(),
    classifiedIntentConfidence: real("classified_intent_confidence"),
    /** What the supervisor surfaced as the real thread of enquiry. */
    discoveredIntent: text("discovered_intent"),
    /**
     * Declared-topic labels the user tagged this round with (`#[topic]`).
     * Paired with classifiedTopic, this is user-declared ground truth for
     * measuring classifier drift.
     */
    declaredTopics: jsonb("declared_topics").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    projectId: integer("project_id"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    orgIdx: index("idx_cio_org").on(table.organizationId),
    sessionIdx: index("idx_cio_session").on(table.sessionId, table.id),
    hashIdx: index("idx_cio_hash").on(table.promptHash),
}));

/**
 * A member who did not speak this round signalling that it has something to
 * contribute. Scored from affinity plus how much relevant experience the agent
 * holds in its own knowledge graph — no model call involved.
 */
export const crewHandRaises = pgTable("crew_hand_raises", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    round: integer("round").default(0).notNull(),
    agentCardId: integer("agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    reason: text("reason").notNull(),
    affinityScore: integer("affinity_score").default(0).notNull(),
    memoryHits: integer("memory_hits").default(0).notNull(),
    calledOn: boolean("called_on").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    roundAgentUnique: uniqueIndex("crew_hand_raises_round_agent_unique").on(
        table.sessionId,
        table.round,
        table.agentCardId,
    ),
    sessionIdx: index("idx_chr_session").on(table.sessionId, table.id),
}));

export const crewPlans = pgTable("crew_plans", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id").notNull(),
    title: text("title").notNull(),
    steps: jsonb("steps")
        .$type<CrewPlanStep[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    status: text("status").$type<CrewPlanStatus>().default("proposed").notNull(),
    round: integer("round").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    sessionIdx: index("idx_crew_plans_session").on(table.sessionId, table.id),
}));

export const crewDecisions = pgTable("crew_decisions", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => crewSessions.id, { onDelete: "cascade" }).notNull(),
    organizationId: integer("organization_id").notNull(),
    statement: text("statement").notNull(),
    rationale: text("rationale"),
    alternatives: jsonb("alternatives").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    evidenceTurnIds: jsonb("evidence_turn_ids").$type<number[]>().default(sql`'[]'::jsonb`).notNull(),
    ontologyRefs: jsonb("ontology_refs").$type<Array<{ objectType: string; objectId: string | number }>>().default(sql`'[]'::jsonb`).notNull(),
    confidence: integer("confidence"),
    status: text("status").$type<CrewDecisionStatus>().default("proposed").notNull(),
    supersedesDecisionId: integer("supersedes_decision_id").references((): AnyPgColumn => crewDecisions.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    round: integer("round").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    sessionIdx: index("idx_crew_decisions_session").on(table.sessionId, table.id),
    sessionStatusIdx: index("idx_crew_decisions_session_status").on(table.sessionId, table.status),
}));

export const crewClaims = pgTable("crew_claims", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => crewSessions.id, { onDelete: "cascade" }).notNull(),
    organizationId: integer("organization_id").notNull(),
    claim: text("claim").notNull(),
    status: text("status").$type<CrewClaimStatus>().default("unverified").notNull(),
    confidence: integer("confidence"),
    sourceTurnId: integer("source_turn_id").references(() => crewTurns.id, { onDelete: "set null" }),
    evidence: jsonb("evidence").$type<Array<{ label: string; uri?: string; retrievedAt?: string; excerpt?: string }>>().default(sql`'[]'::jsonb`).notNull(),
    positions: jsonb("positions").$type<CrewClaimPosition[]>().default(sql`'[]'::jsonb`).notNull(),
    agreementLevel: integer("agreement_level"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ sessionIdx: index("idx_crew_claims_session").on(table.sessionId, table.id) }));

export const crewCommitments = pgTable("crew_commitments", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => crewSessions.id, { onDelete: "cascade" }).notNull(),
    organizationId: integer("organization_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    ownerType: text("owner_type").$type<"user" | "agent" | "team">().default("user").notNull(),
    ownerId: text("owner_id"),
    dueAt: timestamp("due_at"),
    status: text("status").$type<CrewCommitmentStatus>().default("open").notNull(),
    ontologyRefs: jsonb("ontology_refs").$type<Array<{ objectType: string; objectId: string | number }>>().default(sql`'[]'::jsonb`).notNull(),
    completionEvidence: jsonb("completion_evidence").$type<Array<{ label: string; uri?: string }>>().default(sql`'[]'::jsonb`).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ sessionIdx: index("idx_crew_commitments_session").on(table.sessionId, table.id) }));

/**
 * Links a parent session to its breakout children. Created by the orchestrator
 * whenever the Supervisor emits a breakoutSuggestion.
 */
export const crewBreakouts = pgTable("crew_breakouts", {
    id: serial("id").primaryKey(),
    /** The room that originated the breakout. */
    parentSessionId: integer("parent_session_id")
        .notNull()
        .references(() => crewSessions.id, { onDelete: "cascade" }),
    /** The newly-created child room. */
    childSessionId: integer("child_session_id")
        .notNull()
        .references(() => crewSessions.id, { onDelete: "cascade" }),
    /** The sub-topic the Supervisor identified as warranting its own room. */
    subTopic: text("sub_topic").notNull(),
    /** The knowledge_topics row subTopic resolved to, when it did. */
    topicId: integer("topic_id").references(() => knowledgeTopics.id, {
        onDelete: "set null",
    }),
    /** Which agent or role suggested the breakout. */
    suggestedBy: text("suggested_by").notNull().default("Supervisor"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    parentIdx: index("idx_crew_breakouts_parent").on(table.parentSessionId),
    childIdx: index("idx_crew_breakouts_child").on(table.childSessionId),
}));

/**
 * Autonomous meeting scheduling & multi-participant coordination.
 */
export const crewMeetingSchedules = pgTable("crew_meeting_schedules", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    projectId: integer("project_id"),
    title: text("title").notNull(),
    agenda: text("agenda"),
    /** proposed | confirmed | launched | cancelled */
    status: text("status").notNull().default("proposed"),
    hostUserId: text("host_user_id").notNull(),
    /** Array of { id: string, startsAt: string, endsAt: string, votes: string[] } */
    candidateSlots: jsonb("candidate_slots").notNull().$type<Array<{
        id: string;
        startsAt: string;
        endsAt: string;
        votes: string[];
    }>>().default([]),
    /** Confirmed slot: { startsAt: string, endsAt: string } */
    confirmedSlot: jsonb("confirmed_slot").$type<{
        startsAt: string;
        endsAt: string;
    } | null>(),
    /** Array of { id: string, type: 'user' | 'agent', name: string, email?: string, status: 'invited' | 'accepted' | 'declined' } */
    requestedAttendees: jsonb("requested_attendees").notNull().$type<Array<{
        id: string;
        type: "user" | "agent";
        name: string;
        email?: string;
        status: "invited" | "accepted" | "declined";
    }>>().default([]),
    createdSessionKey: text("created_session_key"),
    reminderMinutesBefore: integer("reminder_minutes_before").default(15),
    bullmqJobId: text("bullmq_job_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("idx_crew_meeting_schedules_org").on(table.organizationId),
    projectIdx: index("idx_crew_meeting_schedules_project").on(table.projectId),
    statusIdx: index("idx_crew_meeting_schedules_status").on(table.status),
}));

// ============================================================================
// EXPORTED TYPES
// ============================================================================

export type CrewSessionRecord = typeof crewSessions.$inferSelect;
export type CrewMemberRecord = typeof crewMembers.$inferSelect;
export type CrewTurnRecord = typeof crewTurns.$inferSelect;
export type CrewTurnTopicRecord = typeof crewTurnTopics.$inferSelect;
export type SupervisorNoteRecord = typeof supervisorNotes.$inferSelect;
export type CrewPlanRecord = typeof crewPlans.$inferSelect;
export type CrewIssueRecord = typeof crewIssues.$inferSelect;
export type CrewDecisionRecord = typeof crewDecisions.$inferSelect;
export type CrewClaimRecord = typeof crewClaims.$inferSelect;
export type CrewCommitmentRecord = typeof crewCommitments.$inferSelect;
export type CrewIntentObservationRecord = typeof crewIntentObservations.$inferSelect;
export type CrewHandRaiseRecord = typeof crewHandRaises.$inferSelect;
export type CrewParticipantRecord = typeof crewParticipants.$inferSelect;
export type CrewBreakoutRecord = typeof crewBreakouts.$inferSelect;
export type CrewMeetingScheduleRecord = typeof crewMeetingSchedules.$inferSelect;
