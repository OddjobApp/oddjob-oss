import { db } from "../database_service.js";
import { operationalCycles, missionRuns, hilForms, approvalRequests } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function check() {
    console.log('Querying Cycle 312 details...');
    const cycles = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 312));
    console.log('Cycles:', JSON.stringify(cycles, null, 2));

    console.log('Querying Mission Runs for Cycle 312...');
    const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 312));
    console.log('Mission Runs:', JSON.stringify(runs, null, 2));

    console.log('Querying HIL Forms...');
    const forms = await db.select().from(hilForms).limit(10);
    console.log('HIL Forms:', JSON.stringify(forms, null, 2));

    console.log('Querying Approval Requests...');
    const approvals = await db.select().from(approvalRequests).limit(10);
    console.log('Approval Requests:', JSON.stringify(approvals, null, 2));

    process.exit(0);
}

check().catch(console.error);
