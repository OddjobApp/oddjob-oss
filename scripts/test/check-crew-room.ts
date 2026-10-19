import 'dotenv/config';
import { db } from '../../server/database_service.js';
import { crewSessions } from '../../shared/schema/crew.js';
import { eq } from 'drizzle-orm';

async function main() {
  const sessionKey = 'crew-1789138100513-90da9hd';
  const sessions = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, sessionKey));
  console.log('SESSION RECORD:', JSON.stringify(sessions[0], null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
