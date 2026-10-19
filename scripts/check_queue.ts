
import { dynamicMissionQueue } from "../server/domain/mission/infrastructure/dynamic-mission-queue.js";

async function check() {
    const q = dynamicMissionQueue;
    const [waiting, active, failed, completed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getFailedCount(),
        q.getCompletedCount()
    ]);
    console.log(JSON.stringify({ waiting, active, failed, completed }, null, 2));
    
    const waitingJobs = await q.getWaiting(0, 10);
    console.log('Waiting Jobs:', waitingJobs.map(j => ({ id: j.id, data: j.data })));
    
    const activeJobs = await q.getActive();
    console.log('Active Jobs:', activeJobs.map(j => ({ id: j.id, data: j.data })));

    process.exit(0);
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});
