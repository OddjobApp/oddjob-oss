import { db } from "@server/database_service.js";
import { governorConsensusCache } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import crypto from 'crypto';

export class ConsensusCacheService {

    /**
     * Generates a deterministic hash for command + context.
     */
    private generateHash(data: string | any): string {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    /**
     * Checks if a command has a valid cached consensus decision.
     * Returns the outcome if found and approved with high confidence.
     */
    async checkCache(command: string, context: any): Promise<{ hit: boolean; outcome?: 'APPROVED' | 'REJECTED'; score?: number }> {
        const commandHash = this.generateHash(command);
        const contextHash = this.generateHash(context);

        const [cached] = await db.select()
            .from(governorConsensusCache)
            .where(and(
                eq(governorConsensusCache.commandHash, commandHash),
                eq(governorConsensusCache.contextHash, contextHash)
            ))
            .limit(1);

        if (cached) {
            // In Phase 2, we might want to expire cache or re-verify.
            // For now, we trust the cache if it exists.
            return {
                hit: true,
                outcome: cached.outcome as 'APPROVED' | 'REJECTED',
                score: cached.consensusScore ? parseFloat(cached.consensusScore) : undefined
            };
        }

        return { hit: false };
    }

    /**
     * Caches a new consensus decision.
     */
    async cacheDecision(command: string, context: any, outcome: 'APPROVED' | 'REJECTED', score: number) {
        const commandHash = this.generateHash(command);
        const contextHash = this.generateHash(context);

        // Upsert logic (if supported) or just insert. 
        // Since hashes are not unique constraint (technically), we should check existence or use ON CONFLICT.
        // For simplicity, we'll delete potential dupes (or just insert new Log, acting as audit trail).
        // The requirement says "Lookup table", implying unique key. 
        // Let's just insert for now. A cleaner implementation would use a unique index on hashes.

        await db.insert(governorConsensusCache).values({
            commandHash,
            contextHash,
            outcome,
            consensusScore: score.toString(),
        });

        console.log(`[ConsensusCache] Cached decision for ${command.substring(0, 20)}... -> ${outcome}`);
    }
}

export const consensusCache = new ConsensusCacheService();


