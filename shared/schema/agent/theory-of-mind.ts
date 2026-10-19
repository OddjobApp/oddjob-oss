import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "../auth.js";

// ─── ToM Dimension Interfaces ───────────────────────────────────────────────

export interface EpistemicEntry {
    topic: string;
    summary: string;
    informedBy: string;    // agentId
    informedAt: string;    // ISO 8601
    confidence: number;    // 0-100
}

export interface Belief {
    topic: string;
    proposition: string;
    confidence: number;          // 0-100
    alignment: 'aligned' | 'misaligned' | 'unverified';
    groundTruth?: string;        // when misaligned
    sourceEvidence: string;
    observedAt: string;
    pinned: boolean;
}

export interface Expectation {
    domain: string;
    description: string;
    confidence: number;          // 0-100
    status: 'active' | 'met' | 'unmet' | 'will-diverge' | 'unknown';
    divergenceExplanation?: string;
    triggeringContext: string;
    observedAt: string;
    resolvedAt?: string;
}

export interface CognitiveState {
    frustration: number;         // 0-100
    confusion: number;           // 0-100
    urgency: number;             // 0-100
    explorationVsGoal: number;   // 0=pure exploration, 100=pure goal-directed
    assessedAt: string | null;   // ISO 8601
}

export interface IntentModel {
    literalIntent: string;
    inferredIntent: string;
    inferredConfidence: number;  // 0-100
    diverges: boolean;           // true when inferredConfidence > 70 and differs
    sessionSignals: string[];    // accumulated across session
    sessionId: string;
    updatedAt: string | null;
}

export interface KnowledgeGap {
    topic: string;
    relatedGoal: string;
    relevanceScore: number;      // 0-100
    dismissed: boolean;
    closedAt?: string;
    detectedAt: string;
}

export interface OceanProfile {
    openness: number;            // 0.0-1.0
    conscientiousness: number;   // 0.0-1.0
    extraversion: number;        // 0.0-1.0
    agreeableness: number;       // 0.0-1.0
    neuroticism: number;         // 0.0-1.0
    confidence: number;          // 0-100
    observationCount: number;
    lastCalibratedAt: string | null;
}

export const TOM_CONSENT_STATES = ["granted", "denied", "pending"] as const;
export type ToMConsentState = typeof TOM_CONSENT_STATES[number];

export interface TheoryOfMindRecord {
    id: number;
    organizationId: number;
    userId: string;
    version: number;
    epistemicStates: EpistemicEntry[];
    beliefs: Belief[];
    expectations: Expectation[];
    cognitiveState: CognitiveState;
    intentModel: IntentModel;
    knowledgeGaps: KnowledgeGap[];
    oceanProfile: OceanProfile;
    /**
     * Optional on the record even though the columns exist: almost every
     * consumer reads beliefs and cognitive state and has no business caring
     * about consent, and requiring them here would mean editing every fixture
     * and construction site to say "null" four times.
     */
    accessConsent?: ToMConsentState | null;
    consentDecidedAt?: Date | null;
    consentRequestId?: number | null;
    consentSessionId?: string | null;
    updatedAt: Date;
    createdAt: Date;
}

// ─── Default Values ─────────────────────────────────────────────────────────

const DEFAULT_COGNITIVE_STATE: CognitiveState = {
    frustration: 0,
    confusion: 0,
    urgency: 0,
    explorationVsGoal: 50,
    assessedAt: null,
};

const DEFAULT_INTENT_MODEL: IntentModel = {
    literalIntent: "",
    inferredIntent: "",
    inferredConfidence: 0,
    diverges: false,
    sessionSignals: [],
    sessionId: "",
    updatedAt: null,
};

const DEFAULT_OCEAN_PROFILE: OceanProfile = {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
    confidence: 0,
    observationCount: 0,
    lastCalibratedAt: null,
};

// ─── Drizzle Table Definition ───────────────────────────────────────────────

/**
 * Theory of Mind (ToM) — per-user-per-org cognitive model tracking what users
 * KNOW, BELIEVE, EXPECT, and FEEL. Complements user_representations which
 * captures durable preferences/goals via dialectic reconciliation.
 *
 * One row per (organizationId, userId). Updated in real-time by the sync
 * assessor and async extractor; decayed by the cycle-worker batch.
 */
export const theoryOfMind = pgTable("theory_of_mind", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").default(1).notNull(),

    // JSONB columns for each ToM dimension
    epistemicStates: jsonb("epistemic_states").$type<EpistemicEntry[]>().default([]).notNull(),
    beliefs: jsonb("beliefs").$type<Belief[]>().default([]).notNull(),
    expectations: jsonb("expectations").$type<Expectation[]>().default([]).notNull(),
    cognitiveState: jsonb("cognitive_state").$type<CognitiveState>().default(DEFAULT_COGNITIVE_STATE).notNull(),
    intentModel: jsonb("intent_model").$type<IntentModel>().default(DEFAULT_INTENT_MODEL).notNull(),
    knowledgeGaps: jsonb("knowledge_gaps").$type<KnowledgeGap[]>().default([]).notNull(),
    oceanProfile: jsonb("ocean_profile").$type<OceanProfile>().default(DEFAULT_OCEAN_PROFILE).notNull(),

    /**
     * Whether the user has agreed to agents READING this profile.
     *
     * Deliberately about access, not collection: the sync assessor and async
     * extractor already run on every message, so a gate here does not pretend to
     * be consent to being modelled. That larger question is open — see
     * docs, and treat this as the narrower, honest control it is.
     *
     * null = never asked. Agents get nothing until it is 'granted'.
     */
    accessConsent: text("access_consent"),
    consentDecidedAt: timestamp("consent_decided_at"),
    /** The approval_requests row that asked, so the decision is auditable. */
    consentRequestId: integer("consent_request_id"),
    /**
     * The session the grant belongs to. Consent covers a session and no longer:
     * agreeing once in March must not mean every agent reads the profile in
     * November. Scoping it this way means the grant expires when the session
     * does, with no sweeper to run and nothing to forget to expire.
     */
    consentSessionId: text("consent_session_id"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    userOrgUnique: uniqueIndex("theory_of_mind_user_org_unique").on(t.organizationId, t.userId),
    candidatesIdx: index("theory_of_mind_candidates_idx").on(t.organizationId, t.updatedAt),
}));

export const insertTheoryOfMindSchema = createInsertSchema(theoryOfMind);
export const selectTheoryOfMindSchema = createSelectSchema(theoryOfMind);

export type TheoryOfMind = typeof theoryOfMind.$inferSelect;
export type InsertTheoryOfMind = typeof theoryOfMind.$inferInsert;
