import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { apps, crewSessions, operationalCycles } from '@shared/schema/index.js';

export function boundRoomCycleId(room: { projectId: number | null; cycleContext: unknown }, projectId: number | null): number | null {
  if (room.projectId !== projectId) return null;
  const id = (room.cycleContext as { cycleId?: unknown } | null)?.cycleId;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** An app token may read a bound cycle only in its own organization and exact Project Space. */
export async function resolveAppRoomBinding(appId: number, orgId: number, roomKey: unknown, database: Pick<typeof db, 'select'> = db, lockRoom = false) {
  if (typeof roomKey !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(roomKey)) return null;
  const [app] = await database.select({ projectId: apps.projectId }).from(apps)
    .where(and(eq(apps.id, appId), eq(apps.organizationId, orgId))).limit(1);
  if (!app) return null;
  const projectCondition = app.projectId == null ? isNull(crewSessions.projectId) : eq(crewSessions.projectId, app.projectId);
  const roomQuery = database.select({ projectId: crewSessions.projectId, cycleContext: crewSessions.cycleContext }).from(crewSessions)
    .where(and(eq(crewSessions.sessionKey, roomKey), eq(crewSessions.organizationId, orgId), projectCondition)).limit(1);
  const [room] = lockRoom ? await roomQuery.for('share') : await roomQuery;
  const cycleId = room ? boundRoomCycleId(room, app.projectId) : null;
  if (!cycleId) return null;
  const [cycle] = await database.select().from(operationalCycles).where(and(
    eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, orgId),
    app.projectId == null ? isNull(operationalCycles.projectId) : eq(operationalCycles.projectId, app.projectId),
  )).limit(1);
  return cycle ? { cycle, room, app } : null;
}

export async function resolveAppRoomCycle(appId: number, orgId: number, roomKey: unknown) {
  return (await resolveAppRoomBinding(appId, orgId, roomKey))?.cycle ?? null;
}
