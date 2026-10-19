import { nodeRedisClient as redis } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function checkAiQuota() {
    try {
        const gap = await redis.get('global:ai:current_gap_ms');
        const lastCall = await redis.get('global:ai:last_call_timestamp');
        const now = Date.now();
        console.log(`Current AI Gap: ${gap} ms`);
        console.log(`Last AI Call: ${lastCall}`);
        console.log(`Now: ${now}`);
        if (lastCall) {
            const diff = parseInt(lastCall) - now;
            console.log(`Queue depth: ${diff} ms (${Math.round(diff/1000)}s)`);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkAiQuota();
