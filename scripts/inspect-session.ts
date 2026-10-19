import { db } from '../server/database_service.js';
import { users, userOrgs, orgs } from '../shared/schema/index.js';
import { crewSessions, crewTurns } from '../shared/schema/crew.js';
import { scribeDocuments } from '../shared/schema/scribe.js';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const user = await db.select().from(users).where(eq(users.id, '023a1341-850a-44a1-995a-8c40b6d793af'));
  console.log('User:', user);
  const uorgs = await db.select().from(userOrgs).where(eq(userOrgs.userId, '023a1341-850a-44a1-995a-8c40b6d793af'));
  console.log('UserOrgs:', uorgs);
  const allOrgs = await db.select().from(orgs);
  console.log('Orgs:', allOrgs);
  const sessions = await db
    .select()
    .from(crewSessions)
    .orderBy(desc(crewSessions.createdAt))
    .limit(3);
  console.log('Recent sessions:', sessions.map(s => ({ id: s.id, sessionKey: s.sessionKey, orgId: s.organizationId })));

  const target = sessions.find(s => s.sessionKey === 'crew-1787942255534-tjfs68s') || sessions[0];
  if (!target) {
    console.log('No session found');
    return;
  }
  console.log('Target session:', target);

  const turns = await db
    .select()
    .from(crewTurns)
    .where(eq(crewTurns.sessionId, target.id))
    .orderBy(desc(crewTurns.createdAt))
    .limit(5);

  console.log('Turns count:', turns.length);
  for (const t of turns) {
    console.log(`\n--- Turn #${t.id} by ${t.speakerName} (${t.speakerType}) ---`);
    console.log('Content:', t.content?.slice(0, 150));
    console.log('ToolsUsed:', t.toolsUsed);
    console.log('Artifacts:', JSON.stringify(t.artifacts, null, 2));
  }

  const docs = await db
    .select()
    .from(scribeDocuments)
    .where(eq(scribeDocuments.sessionId, target.id));
  console.log('\nScribe Documents in session:', docs);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
