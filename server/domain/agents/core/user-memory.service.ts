import { db } from "@server/database_service.js";
import { userMemory } from "@shared/schema/index.js";
import { and, eq, or, isNull, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("UserMemory");

/**
 * Per-user assistant memory (Hermes MEMORY.md/USER.md analogue). Durable
 * preferences/facts the assistant learns about a user, recalled across sessions
 * and injected into the system prompt. Org-scoped memories are visible within the
 * org; org-null memories are user-global.
 */
export const userMemoryService = {
    async remember(userId: string, organizationId: number | null, content: string, kind = "fact"): Promise<number | null> {
        const clean = (content || "").trim();
        if (!userId || clean.length < 3) return null;
        // Dedupe exact repeats for this user.
        const [existing] = await db
            .select({ id: userMemory.id })
            .from(userMemory)
            .where(and(eq(userMemory.userId, userId), eq(userMemory.content, clean)))
            .limit(1);
        if (existing) return existing.id;
        const [row] = await db
            .insert(userMemory)
            .values({ userId, organizationId: organizationId ?? null, content: clean, kind, source: "assistant" } as any)
            .returning({ id: userMemory.id });
        logger.info(`Stored memory ${row.id} for user ${userId} (org ${organizationId ?? "-"})`);
        return row.id;
    },

    async getMemories(userId: string, organizationId: number | null, limit = 25) {
        if (!userId) return [];
        const conds: any[] = [eq(userMemory.userId, userId)];
        if (typeof organizationId === "number") {
            conds.push(or(eq(userMemory.organizationId, organizationId), isNull(userMemory.organizationId)));
        }
        return db.select().from(userMemory).where(and(...conds)).orderBy(desc(userMemory.createdAt)).limit(limit);
    },
};
