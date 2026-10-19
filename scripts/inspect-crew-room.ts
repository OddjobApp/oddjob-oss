import { db } from "../server/db/index.js";
import { crewSessions, crewTurns } from "../shared/schema/crew.js";
import { eq, desc } from "drizzle-orm";

async function main() {
    const key = process.argv[2] ?? "crew-1786919778307-ttrb1xs";
    const [session] = await db
        .select()
        .from(crewSessions)
        .where(eq(crewSessions.sessionKey, key))
        .limit(1);

    if (!session) {
        console.log(`Session not found: ${key}`);
        return;
    }

    console.log(
        JSON.stringify(
            {
                id: session.id,
                sessionKey: session.sessionKey,
                mode: session.mode,
                title: session.title,
                orgId: session.organizationId,
                projectId: session.projectId,
            },
            null,
            2,
        ),
    );

    const turns = await db
        .select({
            id: crewTurns.id,
            round: crewTurns.round,
            speaker: crewTurns.speakerName,
            type: crewTurns.speakerType,
            content: crewTurns.content,
            toolsUsed: crewTurns.toolsUsed,
        })
        .from(crewTurns)
        .where(eq(crewTurns.sessionId, session.id))
        .orderBy(desc(crewTurns.id))
        .limit(12);

    for (const turn of turns) {
        const preview = (turn.content ?? "").replace(/\s+/g, " ").slice(0, 160);
        console.log(
            `\n--- round ${turn.round} | ${turn.speaker} (${turn.type}) | tools: ${turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : "none"}`,
        );
        console.log(preview);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
