/**
 * Print a CREW room's transcript: what each speaker said, which tools it used
 * and what artifacts the turn carried. The artifacts are the part a UI hides,
 * and the reason a room "did nothing" is usually visible there.
 *
 *   npx tsx scripts/inspect_session.ts <sessionId> [--round N]
 */
import 'dotenv/config';
import { db } from '../server/db';
import { crewTurns } from '../shared/schema';
import { and, eq } from 'drizzle-orm';

async function inspectSession(sessionId: number, round?: number) {
  const where = round === undefined
    ? eq(crewTurns.sessionId, sessionId)
    : and(eq(crewTurns.sessionId, sessionId), eq(crewTurns.round, round));

  const turns = await db.select().from(crewTurns).where(where).orderBy(crewTurns.round);
  if (turns.length === 0) {
    console.log(`No turns for session ${sessionId}${round === undefined ? '' : ` round ${round}`}.`);
    return;
  }

  for (const t of turns) {
    console.log(`\n=== TURN ${t.id} (Round ${t.round}, ${t.speakerName} [${t.speakerType}]) ===`);
    console.log('Created at:', t.createdAt);
    console.log('Intent:', t.intent);
    console.log('Content:', t.content);
    console.log('Tools used:', JSON.stringify(t.toolsUsed));
    console.log('Artifacts:', JSON.stringify(t.artifacts));
  }
}

const [idArg, ...rest] = process.argv.slice(2);
const sessionId = Number.parseInt(idArg ?? '', 10);
if (!Number.isInteger(sessionId)) {
  console.error('Usage: npx tsx scripts/inspect_session.ts <sessionId> [--round N]');
  process.exit(1);
}
const roundFlag = rest.indexOf('--round');
const round = roundFlag >= 0 ? Number.parseInt(rest[roundFlag + 1] ?? '', 10) : undefined;

inspectSession(sessionId, Number.isInteger(round) ? round : undefined)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => process.exit());
