import { nodeRedisClient as redis } from "../domain/core/infrastructure/redis/redis-client.js";

async function main() {
  const orgId = 291;
  const flag = await redis.get(`failover:org:${orgId}`);
  console.log(`failover:org:${orgId} = ${JSON.stringify(flag)}`);

  // Check all failover keys
  const keys = await redis.keys("failover:org:*");
  console.log(`All failover keys:`, keys);

  for (const k of keys) {
    const v = await redis.get(k);
    const ttl = await redis.ttl(k);
    console.log(`  ${k} = ${v} (TTL: ${ttl}s)`);
  }

  // Clear the failover flag if it's set
  if (flag === "true") {
    await redis.del(`failover:org:${orgId}`);
    console.log(`\n✅ Cleared failover:org:${orgId}`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
