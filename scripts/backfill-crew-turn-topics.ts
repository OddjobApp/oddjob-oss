/**
 * Backfill crew_turn_topics for historical turns.
 *
 * Idempotent: (turn_id, label) is unique, so re-runs only persist rows a
 * previous run or the live write path missed. Learned classifier keywords
 * and agent label affinities reinforce along the way — history teaches the
 * same lessons live turns do.
 *
 * Usage:
 *   npx tsx scripts/backfill-crew-turn-topics.ts [options]
 *
 * Options:
 *   --org <id>       only this organization
 *   --session <key>  only this room
 *   --from <turnId>  resume after a turn id
 *   --limit <n>      stop after n turns
 *   --index          also file tagged user turns as knowledge_documents
 *                    (off by default — a busy room's history is a KB-write storm)
 */
import "dotenv/config";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const orgFilter = arg("org") ? Number(arg("org")) : null;
    const sessionFilter = arg("session") ?? null;
    const fromId = arg("from") ? Number(arg("from")) : 0;
    const limit = arg("limit") ? Number(arg("limit")) : null;
    const doIndex = process.argv.includes("--index");

    const { db } = await import("@server/database_service.js");
    const { crewTurns, crewSessions } = await import("@shared/schema/index.js");
    const { persistTurnTags } = await import("@domain/crew/core/crew-topics.service.js");
    const { extractTopicTags } = await import("@shared/topic-tags.js");
    const { and, asc, eq, gt } = await import("drizzle-orm");

    const BATCH = 500;
    let lastId = fromId;
    let scanned = 0;
    let tagged = 0;
    let rows = 0;

    while (true) {
        const conds = [gt(crewTurns.id, lastId)];
        if (orgFilter != null) conds.push(eq(crewTurns.organizationId, orgFilter));
        if (sessionFilter != null) conds.push(eq(crewSessions.sessionKey, sessionFilter));

        const batch = await db
            .select({
                turn: crewTurns,
                sessionKey: crewSessions.sessionKey,
                projectId: crewSessions.projectId,
            })
            .from(crewTurns)
            .innerJoin(crewSessions, eq(crewTurns.sessionId, crewSessions.id))
            .where(and(...conds))
            .orderBy(asc(crewTurns.id))
            .limit(BATCH);

        if (batch.length === 0) break;

        for (const { turn, sessionKey, projectId } of batch) {
            lastId = turn.id;
            scanned++;
            if (limit != null && scanned > limit) break;
            if (!turn.content || extractTopicTags(turn.content).length === 0) continue;

            const source = turn.speakerType === "user" || turn.speakerType === "agent" || turn.speakerType === "supervisor"
                ? turn.speakerType
                : "system";
            const persisted = await persistTurnTags({
                orgId: turn.organizationId,
                sessionId: turn.sessionId,
                turnId: turn.id,
                round: turn.round ?? 0,
                source,
                text: turn.content,
                projectId: projectId ?? null,
                sessionKey,
                speakerName: turn.speakerName ?? undefined,
                classifiedTopic: source === "user" ? turn.topic : null,
                agentCardId: turn.agentCardId ?? null,
                index: doIndex,
            });
            tagged++;
            rows += persisted.length;
        }

        console.log(`… scanned ${scanned}, tagged ${tagged}, rows ${rows} (last turn ${lastId})`);
        if (batch.length < BATCH || (limit != null && scanned >= limit)) break;
    }

    console.log(`Done. scanned=${scanned} tagged=${tagged} crew_turn_topics rows=${rows}`);
    process.exit(0);
}

main().catch((err) => {
    console.error("backfill failed:", err?.message ?? err);
    process.exit(1);
});
