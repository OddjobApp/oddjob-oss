import { redis } from "../domain/core/infrastructure/redis/redis-client.js";
async function main() {
    await redis.del('apps:market:true');
    await redis.del('apps:market:false');
    console.log('✅ Redis market cache cleared');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
