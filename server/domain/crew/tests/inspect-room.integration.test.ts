import { describe, it } from 'vitest';
import { db } from '../../../../server/database_service.js';
import { crewTurns, crewSessions } from '@shared/schema/index.js';
import { eq, desc } from 'drizzle-orm';

describe('Inspect user room', () => {
  it('reads turns', async () => {
    const sessions = await db.select().from(crewSessions).orderBy(desc(crewSessions.id)).limit(5);
    console.log('LATEST SESSIONS:', sessions.map(s => ({ id: s.id, sessionKey: s.sessionKey, title: s.title })));
    const matching = sessions.find(s => s.sessionKey?.includes('1791396864989') || s.sessionKey === 'crew-1791396864989-5uercze');
    const targetSession = matching || sessions[0];
    if (!targetSession) {
      console.log('NO SESSIONS AT ALL');
      return;
    }
    console.log('TARGET SESSION:', targetSession.id, targetSession.sessionKey, targetSession.title);
    const turns = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, targetSession.id)).orderBy(desc(crewTurns.id)).limit(6);
    for (const t of turns) {
      console.log('TURN ' + t.id + ' [' + t.speakerName + ' / ' + t.speakerType + ']:');
      console.log('CONTENT:\n' + t.content);
      console.log('TOOLS:\n' + JSON.stringify(t.toolsUsed));
    }
  });
});
