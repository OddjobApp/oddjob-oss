/**
 * Reset the platform-wide AI quota/failover state in Redis.
 *
 * WHEN TO RUN: right AFTER lifting the Gemini spending cap / rotating to a
 * healthy key (and restarting). During an outage the throttler inflates a shared
 * gap and pins each affected org to slow local Ollama via a 1h `failover:org:*`
 * flag; those keys otherwise linger and keep recovery slow even once the provider
 * is healthy. This clears them so the copilot returns to full speed immediately.
 *
 * Safe & idempotent: if the outage is still ongoing the keys simply repopulate on
 * the next failed call. Read-only providers/models are unaffected.
 *
 *   npx tsx server/scripts/reset-ai-quota.ts
 */
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";

// Keys mirror the constants in ai-client.service.ts (AiQuotaManager).
const SINGLE_KEYS = [
    "global:ai:last_call_timestamp",
    "global:ai:current_gap_ms",
    "global:ai:block_until",
];
const SCAN_PATTERNS = [
    "failover:org:*",   // per-org "force local Ollama" circuit-breaker flags (1h TTL)
    "quota:gap:*",      // per-provider inflated safety gaps
    "quota:last:*",     // per-provider last-call timestamps
    "quota:burst:*",    // per-provider burst counters
];

async function scanDelete(pattern: string): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        let deleted = 0;
        const stream = redis.scanStream({ match: pattern, count: 200 });
        stream.on("data", (keys: string[]) => {
            if (keys.length === 0) return;
            stream.pause();
            redis.del(...keys)
                .then((n) => { deleted += n; stream.resume(); })
                .catch(reject);
        });
        stream.on("end", () => resolve(deleted));
        stream.on("error", reject);
    });
}

async function main() {
    let total = 0;
    const removedSingles = await redis.del(...SINGLE_KEYS);
    total += removedSingles;
    console.log(`[reset-ai-quota] cleared ${removedSingles} global key(s): ${SINGLE_KEYS.join(", ")}`);

    for (const pattern of SCAN_PATTERNS) {
        const n = await scanDelete(pattern);
        total += n;
        console.log(`[reset-ai-quota] cleared ${n} key(s) matching ${pattern}`);
    }

    console.log(`[reset-ai-quota] done — ${total} key(s) removed. Quota gap resets to baseline on the next call.`);
    await redis.quit().catch(() => {});
    process.exit(0);
}

main().catch((err) => {
    console.error("[reset-ai-quota] failed:", err);
    process.exit(1);
});
