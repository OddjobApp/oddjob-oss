
import { db } from "@server/database_service.js";
import { agentSessions } from "@shared/schema/agent-sessions.js";
import { eq, lt, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentSessionService");

class AgentSessionService {
    /**
     * Creates a new long-running agent session.
     */
    public async createSession(goal: string, organizationId?: number, createdBy?: string): Promise<typeof agentSessions.$inferSelect> {
        const sessionId = randomBytes(16).toString('hex');
        logger.info(`Creating new agent session ${sessionId} for goal: ${goal}`);
        const [newSession] = await db.insert(agentSessions).values({
            sessionId,
            goal,
            status: 'running',
            progress: [],
            organizationId,
            createdBy
        }).returning();
        return newSession;
    }

    /**
     * Updates the progress of a running session.
     */
    public async updateProgress(sessionId: string, newSteps: any[]): Promise<void> {
        const [session] = await db.select().from(agentSessions).where(eq(agentSessions.sessionId, sessionId));
        if (!session) return;

        const updatedProgress = [...(session.progress || []), ...newSteps];
        await db.update(agentSessions).set({ progress: updatedProgress, updatedAt: new Date() }).where(eq(agentSessions.sessionId, sessionId));
    }

    /**
     * Puts a session into hibernation.
     */
    public async hibernateSession(sessionId: string, wakeUpInHours: number): Promise<void> {
        const wakeUpTime = new Date();
        wakeUpTime.setHours(wakeUpTime.getHours() + wakeUpInHours);

        logger.info(`Hibernating session ${sessionId}. Waking up at ${wakeUpTime.toISOString()}`);
        await db.update(agentSessions).set({
            status: 'hibernating',
            nextWakeUp: wakeUpTime,
            updatedAt: new Date(),
        }).where(eq(agentSessions.sessionId, sessionId));
    }

    /**
     * Finds all hibernating sessions that are due to be woken up.
     */
    public async getSessionsToWake(): Promise<(typeof agentSessions.$inferSelect)[]> {
        return db.select().from(agentSessions).where(
            and(
                eq(agentSessions.status, 'hibernating'),
                lt(agentSessions.nextWakeUp, new Date())
            )
        );
    }

     /**
     * Marks a session as running again.
     */
    public async wakeSession(sessionId: string): Promise<void> {
        logger.info(`Waking up session ${sessionId}.`);
        await db.update(agentSessions).set({ status: 'running', nextWakeUp: null, updatedAt: new Date() }).where(eq(agentSessions.sessionId, sessionId));
    }
}

export const agentSessionService = new AgentSessionService();
