import { nodeRedisClient as redis } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function resetAiQuota() {
    try {
        await redis.set('global:ai:current_gap_ms', '60000');
        await redis.del('global:ai:last_call_timestamp');
        console.log('AI Quota has been manually RESET to baseline (60s).');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

resetAiQuota();
