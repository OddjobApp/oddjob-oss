
import { redis } from '../../server/domain/core/infrastructure/redis/redis-client.js';

async function main() {
  const jobId = "461880da-2b16-4ea5-9db3-1d0594c358cf";
  const status = await redis.get(`forge:job:${jobId}`);
  console.log(`Status for job ${jobId}:`, status);
  
  if (status) {
    const data = JSON.parse(status);
    console.log("Parsed Status:", JSON.stringify(data, null, 2));
  }
}

main().catch(console.error).finally(() => process.exit(0));
