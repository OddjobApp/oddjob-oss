/**
 * Declared-topic tags for crew rooms.
 *
 * A `#[Multi Word]` or `#single-word` tag in a turn's text is a declared
 * topic — what the speaker says the text is about — bound to a row in
 * knowledge_topics (org vocabulary, or the room's Project Space vocabulary
 * when the session carries a projectId). Persistence lands in
 * crew_turn_topics, one row per (turn, label).
 *
 * Deliberately NOT crew_turns.topic: that column holds the intent router's
 * classified TopicCategory and feeds routing + hand-raise affinities. These
 * rows are what the speaker declared — the ground truth the classifier is
 * measured against.
 *
 * Everything here is fire-and-forget by contract: callers run this off the
 * round's critical path and failures are logged, never thrown. A taxonomy
 * write must never be what broke a round.
 */
import { db } from "@server/database_service.js";
import { crewTurnTopics, type CrewTurnTopicRecord } from "@shared/schema/index.js";
import { extractTopicTags, stripTopicTags } from "@shared/topic-tags.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewTopics");

export interface PersistedTurnTag {
    turnTopicId: number;
    topicId: number | null;
    label: string;
    status: CrewTurnTopicRecord["status"];
}

/**
 * Extract tags from `text`, resolve each to a knowledge_topics row (creating
 * freeform topics as needed — that is the user-facing "create by typing"
 * contract), and persist the crew_turn_topics rows. Returns the persisted
 * rows' ids so callers can attach them to stream payloads.
 */
export async function persistTurnTags(scope: {
    orgId: number;
    sessionId: number;
    turnId: number;
    round: number;
    source: CrewTurnTopicRecord["source"];
    text: string;
    /** Room's Project Space — tags in a project room join that vocabulary. */
    projectId?: number | null;
    /** Room key + speaker, stamped on the indexed document's metadata. */
    sessionKey?: string;
    speakerName?: string;
    /**
     * The turn's classified TopicCategory. Two learners consume it: user tags
     * reinforce learned_topic_keywords (declared label → category), and agent
     * tags may promote the category onto the card's topicAffinities.
     */
    classifiedTopic?: string | null;
    /** Agent card that authored the turn — drives topic label affinity learning. */
    agentCardId?: number | null;
    /**
     * Room-level approval gate: when true, agent-declared rows persist
     * 'pending' until the room owner decides (user tags are never gated).
     */
    gateAgentTags?: boolean;
    /**
     * Whether to file a knowledge_document for tagged user turns. Backfill
     * callers set false to avoid re-ingesting history.
     */
    index?: boolean;
}): Promise<PersistedTurnTag[]> {
    const { orgId, sessionId, turnId, round, source, text, projectId = null, sessionKey, speakerName,
        classifiedTopic = null, agentCardId = null, gateAgentTags = false, index = true } = scope;
    try {
        const tags = extractTopicTags(text);
        if (tags.length === 0) return [];

        const { topicService } = await import("@domain/knowledge/core/topic-service.js");
        const orgContext = getSystemOrgContext(orgId);
        const gated = source === "agent" && gateAgentTags;

        const rows: PersistedTurnTag[] = [];
        for (const tag of tags) {
            // Case-insensitive find-then-upsert: knowledge_topics uniqueness is
            // case-sensitive at the index, so "#Pricing" after "#pricing" must
            // match the existing row rather than fork the vocabulary.
            //
            // Second tier: token-set equality. "#launch q4" must resolve to the
            // "Q4 Launch" topic — same words, reordered — or freeform creation
            // forks the vocabulary with every phrasing. Multi-word labels widen
            // the candidate query to any-token ilike matches.
            const tokens = tag.label.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
            const candidateQueries = tokens.length > 1 ? [...new Set(tokens.slice(0, 4))] : [tag.label];
            const candidates = new Map<number, Awaited<ReturnType<typeof topicService.findTopicByName>>[number]>();
            for (const q of candidateQueries) {
                for (const t of await topicService.findTopicByName(q, orgContext)) {
                    candidates.set(t.id, t);
                }
            }
            const inScope = (t: { projectId: number | null }) => (t.projectId ?? null) === projectId;
            const tokenKey = (s: string) => s.toLowerCase().split(/[\s\-_]+/).filter(Boolean).sort().join(" ");
            const match =
                [...candidates.values()].find((t) => t.name.toLowerCase() === tag.label.toLowerCase() && inScope(t))
                ?? (tokens.length > 1
                    ? [...candidates.values()].find((t) => tokenKey(t.name) === tokenKey(tag.label) && inScope(t))
                    : undefined);
            const topic = match ?? (await topicService.upsertTopic(
                { name: tag.label },
                orgContext,
                projectId,
            ));

            const [row] = await db
                .insert(crewTurnTopics)
                .values({
                    sessionId,
                    turnId,
                    organizationId: orgId,
                    round,
                    topicId: topic.id,
                    label: tag.label,
                    rawLabel: tag.raw,
                    source,
                    status: gated ? "pending" : "applied",
                })
                .onConflictDoNothing()
                .returning();

            if (row) rows.push({ turnTopicId: row.id, topicId: topic.id, label: tag.label, status: row.status });
        }

        // KB indexing: a tagged user turn is filed as a knowledge_document so
        // "what did we say about #[pricing]?" is answerable by RAG. Deliberately
        // user-source only — agent write-back already lands through
        // writeBackKnowledge, and double-filing would pollute retrieval.
        // Deliberately not awaited: indexing is a side effect, not the round's
        // critical path.
        if (index && source === "user" && rows.length > 0) {
            const clean = stripTopicTags(text).trim();
            if (clean.length > 10) {
                void indexTaggedTurn({
                    orgId,
                    projectId,
                    sessionId,
                    sessionKey,
                    turnId,
                    round,
                    speakerName,
                    text: clean,
                    topicIds: [...new Set(rows.map((r) => r.topicId).filter((id): id is number => id !== null))],
                }).catch((err) =>
                    logger.warn(
                        `indexTaggedTurn failed for turn ${turnId}: ${err instanceof Error ? err.message : String(err)}`,
                    ),
                );
            }
        }

        // Classifier learning: a declared label observed under a classified
        // category becomes a learned keyword for that category, so the next
        // "compound interest" message scores Finance without a tag. 'General'
        // teaches nothing — it is the no-signal outcome.
        if (source === "user" && rows.length > 0 && classifiedTopic && classifiedTopic !== "General") {
            const learned = rows.map((r) => r.label);
            void reinforceLearnedKeywords(orgId, learned, classifiedTopic).catch((err) =>
                logger.warn(`reinforceLearnedKeywords failed: ${err instanceof Error ? err.message : String(err)}`),
            );
        }

        // Agent affinity self-learning: an applied agent tag records the
        // declared label on the card and may promote the classified category
        // into topicAffinities. Pending tags earn nothing until approved.
        if (source === "agent" && agentCardId != null && rows.some((r) => r.status === "applied")) {
            const applied = rows.filter((r) => r.status === "applied").map((r) => r.label);
            void reinforceAgentTopicAffinities(orgId, agentCardId, applied, classifiedTopic).catch((err) =>
                logger.warn(`reinforceAgentTopicAffinities failed for card ${agentCardId}: ${err instanceof Error ? err.message : String(err)}`),
            );
        }
        return rows;
    } catch (err) {
        logger.warn(
            `persistTurnTags failed for turn ${turnId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
    }
}

/**
 * Reinforce learned_topic_keywords for each declared label → the classified
 * category. One row per (org, label); weight grows with repetition so a
 * frequently-tagged label outweighs a stray one at classify time.
 */
async function reinforceLearnedKeywords(orgId: number, labels: string[], category: string): Promise<void> {
    const { learnedTopicKeywords } = await import("@shared/schema/index.js");
    const { topicCategories } = await import("@shared/schema/agent-cards.js");
    if (!(topicCategories as readonly string[]).includes(category)) return;
    const { and, eq, sql } = await import("drizzle-orm");
    for (const label of labels) {
        await db
            .insert(learnedTopicKeywords)
            .values({ organizationId: orgId, label, topic: category })
            .onConflictDoUpdate({
                target: [learnedTopicKeywords.organizationId, learnedTopicKeywords.label],
                set: { topic: category, weight: sql`${learnedTopicKeywords.weight} + 1`, updatedAt: new Date() },
            });
    }
}

const MAX_TOPIC_LABEL_AFFINITIES = 25;
const MAX_TOPIC_AFFINITIES = 10;

/**
 * Record what an agent declared on its own turns: labels go onto
 * topic_label_affinities (freeform vocabulary hand-raise scoring reads), and
 * the classified category is promoted into topic_affinities — an agent that
 * keeps tagging on Finance turns is a Finance agent.
 */
async function reinforceAgentTopicAffinities(
    orgId: number,
    agentCardId: number,
    labels: string[],
    classifiedTopic: string | null,
): Promise<void> {
    const { agentCards, topicCategories } = await import("@shared/schema/index.js");
    const { and, eq } = await import("drizzle-orm");
    const [card] = await db
        .select({ id: agentCards.id, topicAffinities: agentCards.topicAffinities, topicLabelAffinities: agentCards.topicLabelAffinities })
        .from(agentCards)
        .where(and(eq(agentCards.id, agentCardId), eq(agentCards.organizationId, orgId)))
        .limit(1);
    if (!card) return;

    const labelAffinities = [...(card.topicLabelAffinities ?? [])];
    for (const label of labels) {
        const entry = labelAffinities.find((e) => e.label.toLowerCase() === label.toLowerCase());
        if (entry) entry.count += 1;
        else labelAffinities.push({ label, count: 1 });
    }
    // Cap the vocabulary — strongest, most-reinforced labels survive.
    labelAffinities.sort((a, b) => b.count - a.count);
    labelAffinities.splice(MAX_TOPIC_LABEL_AFFINITIES);

    const topicAffinities = [...(card.topicAffinities ?? [])];
    if (
        classifiedTopic
        && classifiedTopic !== "General"
        && (topicCategories as readonly string[]).includes(classifiedTopic)
        && !(topicAffinities as string[]).includes(classifiedTopic)
        && topicAffinities.length < MAX_TOPIC_AFFINITIES
    ) {
        topicAffinities.push(classifiedTopic as never);
    }

    await db
        .update(agentCards)
        .set({ topicLabelAffinities: labelAffinities, topicAffinities })
        .where(eq(agentCards.id, agentCardId));
}

/**
 * File a tagged turn as a knowledge_document under its resolved topics.
 *
 * Title is deterministic (`Crew turn {turnId}`) because (project_id, title) is
 * the documents table's idempotent-ingest key — a redelivery of the same turn
 * re-upserts rather than duplicating.
 */
async function indexTaggedTurn(input: {
    orgId: number;
    projectId: number | null;
    sessionId: number;
    sessionKey?: string;
    turnId: number;
    round: number;
    speakerName?: string;
    text: string;
    topicIds: number[];
}): Promise<void> {
    const { documentService } = await import(
        "@domain/knowledge/core/extraction/document-service.js"
    );
    const orgContext = getSystemOrgContext(input.orgId);
    const room = input.sessionKey ?? `session-${input.sessionId}`;
    const preview = input.text.length > 80 ? `${input.text.slice(0, 77)}…` : input.text;
    await documentService.createDocument(
        {
            title: `Crew turn ${input.turnId} · ${room}`,
            summary: preview,
            sourceType: "crew_turn",
            textContent: input.text,
            projectId: input.projectId,
            topicIds: input.topicIds,
            metadata: {
                source: "crew_turn",
                sessionId: input.sessionId,
                sessionKey: input.sessionKey ?? null,
                turnId: input.turnId,
                round: input.round,
                speaker: input.speakerName ?? null,
            },
        },
        orgContext,
    );
}

/**
 * Backlink read: tagged turns across the org's rooms for one knowledge topic —
 * the "what conversations live under this topic?" answer. Rooms in projects
 * outside `visibleProjectIds` are left out.
 */
export async function getTopicBacklinks(orgId: number, topicId: number, limit = 50, visibleProjectIds: number[] = []) {
    const { crewRepository } = await import("./crew-repository.js");
    return crewRepository.getTurnsForTopic(orgId, topicId, limit, visibleProjectIds);
}

/** The room's accumulated tag set, oldest first (delta-merge friendly). */
export async function getTurnTopics(
    sessionId: number,
    opts?: { sinceRound?: number; topicId?: number },
): Promise<CrewTurnTopicRecord[]> {
    const { crewRepository } = await import("./crew-repository.js");
    return crewRepository.getTurnTopics(sessionId, opts);
}

/**
 * Distinct applied labels the room has declared, most recent first — the
 * vocabulary speakers should reuse instead of forking a spelling variant.
 */
export async function getRoomTopicVocabulary(sessionId: number, limit = 15): Promise<string[]> {
    const rows = await getTurnTopics(sessionId);
    const seen = new Set<string>();
    for (let i = rows.length - 1; i >= 0 && seen.size < limit; i--) {
        const row = rows[i];
        if (row.status !== "applied") continue;
        seen.add(row.label.toLowerCase());
    }
    return [...seen];
}

/**
 * Room-owner decision on a gated agent tag: 'applied' publishes it,
 * 'rejected' retires it. Returns the updated row, or null when the tag is
 * not pending in this session.
 */
export async function decideTurnTag(
    orgId: number,
    sessionId: number,
    turnTopicId: number,
    decision: "applied" | "rejected",
): Promise<CrewTurnTopicRecord | null> {
    const { crewRepository } = await import("./crew-repository.js");
    const row = await crewRepository.setTurnTopicStatus(orgId, sessionId, turnTopicId, decision);

    // An approved agent tag was withheld from affinity learning while pending;
    // approval is the signal it was worth learning after all.
    if (row && decision === "applied") {
        void reinforceApprovedTag(orgId, row).catch((err) =>
            logger.warn(`reinforceApprovedTag failed for turn topic ${row.id}: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
    return row;
}

async function reinforceApprovedTag(orgId: number, row: CrewTurnTopicRecord): Promise<void> {
    const { crewTurns } = await import("@shared/schema/index.js");
    const { eq } = await import("drizzle-orm");
    const [turn] = await db
        .select({ agentCardId: crewTurns.agentCardId, topic: crewTurns.topic })
        .from(crewTurns)
        .where(eq(crewTurns.id, row.turnId))
        .limit(1);
    if (turn?.agentCardId != null) {
        await reinforceAgentTopicAffinities(orgId, turn.agentCardId, [row.label], turn.topic);
    }
}
