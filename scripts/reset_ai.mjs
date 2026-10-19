import { nodeRedisClient as redis } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function reset() {
    console.log('Resetting AI Quota...');
    await redis.del("global:ai:last_call_timestamp");
    await redis.set("global:ai:current_gap_ms", "1000"); // 1s gap for testing
    console.log('✓ AI Quota Reset to 1s gap.');
    process.exit(0);
}

reset().catch(err => {
    console.error(err);
    process.exit(1);
});
