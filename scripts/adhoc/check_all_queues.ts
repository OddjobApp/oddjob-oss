
import { forgeQueue } from '../../server/domain/apps/infrastructure/forge-queue.js';
import { rollingWaveQueue } from '../../server/domain/mission/infrastructure/rolling-wave-queue.js';
import { dynamicMissionQueue } from '../../server/domain/mission/infrastructure/dynamic-mission-queue.js';

async function checkQueue(name: string, queue: any) {
    const counts = await queue.getJobCounts();
    const workers = await queue.getWorkers();
    console.log(`\n--- QUEUE: ${name} ---`);
    console.log(`Counts: ${JSON.stringify(counts)}`);
    console.log(`Workers: ${workers.length}`);
    
    const waiting = await queue.getWaiting();
    if (waiting.length > 0) {
        console.log(`Waiting Jobs: ${waiting.map((j: any) => j.id).join(', ')}`);
    }
}

async function main() {
    await checkQueue('Forge', forgeQueue);
    await checkQueue('RollingWave', rollingWaveQueue);
    await checkQueue('DynamicMission', dynamicMissionQueue);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
