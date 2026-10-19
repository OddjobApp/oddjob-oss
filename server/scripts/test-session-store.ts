
import "dotenv/config";
import { RedisStore } from "connect-redis";
import Redis from "ioredis";

async function main() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const redis = new Redis(redisUrl);

    console.log("Testing Redis connection...");
    await redis.ping();
    console.log("Ping successful.");

    const store = new RedisStore({
        client: redis,
        prefix: "test:sess:",
        ttl: 3600
    });

    const testId = "test-session-" + Date.now();
    const testData = { cookie: { maxAge: 3600 }, userId: 123, username: "testuser" };

    console.log(`Attempting to set session ${testId}...`);
    try {
        await new Promise((resolve, reject) => {
            store.set(testId, testData as any, (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
        console.log("Session set successful!");
    } catch (err) {
        console.error("Session set FAILED:", err);
    } finally {
        await redis.quit();
    }
}

main().catch(console.error);

