import { db } from '../database_service.js';
import { missionMembers } from "../../shared/schema/index.js";
import { eq } from 'drizzle-orm';

async function check() {
  const missionId = 33;
  try {
    const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, missionId));
    console.log(`\n--- Members for Mission ${missionId} ---`);
    console.log(JSON.stringify(members, null, 2));
    
    const hasStrategist = members.some(m => m.role === 'primary_strategist');
    console.log(`\nHas Primary Strategist: ${hasStrategist}`);
  } catch (err) {
    console.error('Check failed:', err);
  }
  process.exit(0);
}

check();

