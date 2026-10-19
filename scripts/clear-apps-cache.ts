import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

async function clearCache() {
    console.log("🧹 Clearing apps marketplace cache...");
    await redis.del("apps:market:true");
    await redis.del("apps:market:false");
    console.log("✅ Cache cleared!");
    process.exit(0);
}

clearCache().catch(err => {
    console.error(err);
    process.exit(1);
});
