import { db } from "@server/database_service.js";
import { missionAgentMemories } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MemoryService");

export interface AgentObservation {
  missionId: number;
  agentId?: number;
  runId?: string;
  type: "observation" | "fact" | "reminder" | "strategy";
  content: string;
  importance?: number;
  metadata?: Record<string, any>;
}

export const memoryService = {
  /**
   * Persist a new shared observation for the mission.
   */
  async saveMemory(data: AgentObservation): Promise<void> {
    try {
      await db.insert(missionAgentMemories).values({
        missionId: data.missionId,
        agentId: data.agentId,
        runId: data.runId,
        type: data.type,
        content: data.content,
        importance: data.importance ?? 5,
        metadata: data.metadata ?? {},
      });
      logger.info(`Saved shared memory for mission ${data.missionId} (Type: ${data.type})`);
    } catch (error) {
      logger.error(`Failed to save memory: ${error}`);
      throw error;
    }
  },

  /**
   * Fetch relevant memories for a mission.
   * Initially, we return the most recent high-importance memories.
   */
  async getRelevantMemories(missionId: number, limit = 10): Promise<any[]> {
    try {
      const memories = await db
        .select()
        .from(missionAgentMemories)
        .where(eq(missionAgentMemories.missionId, missionId))
        .orderBy(desc(missionAgentMemories.importance), desc(missionAgentMemories.createdAt))
        .limit(limit);
      
      return memories;
    } catch (error) {
      logger.error(`Failed to fetch memories: ${error}`);
      return [];
    }
  },

  /**
   * Format memories for injection into a prompt.
   */
  async getFormattedMemories(missionId: number): Promise<string> {
    const memories = await this.getRelevantMemories(missionId);
    if (memories.length === 0) return "";

    return `
### SHARED MISSION MEMORIES (Team Collective Intelligence)
The following observations have been shared by agents in your team during previous or parallel runs. Use this context to improve your execution and avoid redundant work:
${memories.map((m: any) => `- [${m.type.toUpperCase()}] ${m.content} (Importance: ${m.importance}/10)`).join("\n")}
`;
  }
};


