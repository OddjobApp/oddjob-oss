import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, or, sql, lt } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { appRecords, missionRuns, missions } from '@shared/schema/index.js';
import { BadRequestError, NotFoundError } from '@server/utils/errors.js';
import { resolveAppRoomBinding } from './app-room-cycle-binding.service.js';
import { normalizeLookupName } from '../apps-platform.helpers.js';
import { SDLC_HANDOFF_COLLECTION, SDLC_TRANSITIONS, stageHandoffInputSchema, sameSdlcBinding, handoffSourceBlocker,
  type SdlcSourceBinding, type StageHandoffRecord, type StageHandoffInput } from '@shared/sdlc-stage-handoff.js';

type Database = Pick<typeof db, 'select' | 'insert' | 'update'>;
export interface HandoffActor { appId: number; orgId: number; deploymentId: number }

export async function requireSdlcBinding(actor: Pick<HandoffActor, 'appId' | 'orgId'>, roomKey: unknown, database: Pick<typeof db, 'select'> = db, lock = false) {
  const resolved = await resolveAppRoomBinding(actor.appId, actor.orgId, roomKey, database, lock);
  const development = resolved?.room.cycleContext?.developmentBinding;
  if (!resolved || !development?.configuredAt) throw new BadRequestError('Configure this room’s development repository and cycle in the app’s Project Space first.');
  const binding: SdlcSourceBinding = { roomKey: String(roomKey), cycleId: resolved.cycle.id, revision: development.configuredAt, repositoryUrl: development.repositoryUrl, branch: development.branch };
  return { binding, resolved };
}

const conditions = (actor: HandoffActor, id?: string) => and(eq(appRecords.appId, actor.appId), eq(appRecords.orgId, actor.orgId),
  eq(appRecords.collection, SDLC_HANDOFF_COLLECTION), ...(id ? [eq(appRecords.recordId, id)] : []));

async function sourceEvidence(database: Database, actor: HandoffActor, input: StageHandoffInput, binding: SdlcSourceBinding, lock: boolean, sourceDigest?: string) {
  const transition = SDLC_TRANSITIONS[input.transition];
  const query = database.select().from(appRecords).where(and(eq(appRecords.appId, actor.appId), eq(appRecords.orgId, actor.orgId),
    eq(appRecords.collection, transition.source), eq(appRecords.recordId, input.sourceRecordId))).limit(1);
  const [source] = lock ? await query.for('share') : await query;
  if (!source || !sameSdlcBinding((source.data as any)?.sdlcContext, binding)) return { blocker: 'Source evidence is unavailable under this room’s current development binding.' };
  if (source.updatedAt.toISOString() !== input.sourceUpdatedAt) return { blocker: 'Source evidence changed. Review and offer a new handoff.' };
  if (sourceDigest !== undefined && sourceDigest !== fingerprint(source.data)) return { blocker: 'Source evidence content changed. Review and offer a new handoff.' };
  const sourceBlocker = handoffSourceBlocker({ ...input, sourceRunId: undefined }, source.data as Record<string, any>);
  if (sourceBlocker) return { source, blocker: sourceBlocker };
  if (input.commitSha) {
    const latest = async (collection: string) => {
      const current = database.select().from(appRecords).where(and(eq(appRecords.appId, actor.appId), eq(appRecords.orgId, actor.orgId), eq(appRecords.collection, collection),
        sql`lower(${appRecords.data}->>'commitSha') = ${input.commitSha!.toLowerCase()}`,
        sql`${appRecords.data}->'sdlcContext'->>'roomKey' = ${binding.roomKey}`,
        sql`${appRecords.data}->'sdlcContext'->>'revision' = ${binding.revision}`)).orderBy(desc(appRecords.createdAt), desc(appRecords.id)).limit(1);
      const [row] = lock ? await current.for('share') : await current;
      return row;
    };
    if ((await latest(transition.source))?.recordId !== source.recordId) return { source, blocker: 'A newer gate or decision supersedes this source evidence.' };
    if (input.transition === 'uat_to_deployment') {
      const [uat, gate] = await Promise.all([latest('stakeholder_workbench_uat_signoffs'), latest('qa_workbench_quality_gates')]);
      const cab = source.data as any;
      if (!uat || !gate || !sameSdlcBinding((uat.data as any).sdlcContext, binding) || !sameSdlcBinding((gate.data as any).sdlcContext, binding) ||
        (uat.data as any).status !== 'approved' || (gate.data as any).result !== 'pass' || (gate.data as any).evidenceKind !== 'runner' ||
        Number((gate.data as any).suiteCount ?? 0) < 1 || cab.uatSignoffId !== uat.recordId || cab.qualityGateId !== gate.recordId)
        return { source, blocker: 'CAB must reference the current same-commit UAT approval and runner-backed quality gate.' };
    }
  }
  let run: typeof missionRuns.$inferSelect | undefined;
  if (input.sourceRunId) {
    const runQuery = database.select({ run: missionRuns, missionName: missions.name }).from(missionRuns).innerJoin(missions, and(eq(missions.id, missionRuns.missionId), eq(missions.organizationId, actor.orgId)))
      .where(and(eq(missionRuns.id, input.sourceRunId), eq(missionRuns.organizationId, actor.orgId), or(eq(missionRuns.cycleId, binding.cycleId), isNull(missionRuns.cycleId)),
        eq(missionRuns.createdBy, `app-deployment:${actor.deploymentId}`), isNull(missionRuns.deletedAt))).limit(1);
    const [found] = lock ? await runQuery.for('share') : await runQuery;
    run = found && normalizeLookupName(found.missionName) === normalizeLookupName(transition.mission!) ? found.run : undefined;
    if (run && !sameSdlcBinding((run.missionContext as any)?.sdlcBinding, binding)) run = undefined;
  }
  return { source, run, pendingSource: Boolean(run && ['active', 'paused', 'waiting_on_human', 'waiting_on_file'].includes(run.status)), blocker: handoffSourceBlocker(input, source.data as Record<string, any>, run) };
}

function identity(input: StageHandoffInput, binding: SdlcSourceBinding) {
  return createHash('sha256').update(JSON.stringify([binding, input.transition, input.sourceRecordId, input.sourceUpdatedAt, input.sourceRunId ?? null])).digest('hex');
}
function fingerprint(input: unknown) { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }

export async function offerStageHandoff(actor: HandoffActor, roomKey: unknown, body: unknown) {
  const parsed = stageHandoffInputSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map(issue => issue.message).join('; '));
  const input = { ...parsed.data, sourceUpdatedAt: new Date(parsed.data.sourceUpdatedAt).toISOString(), ticketKeys: [...new Set(parsed.data.ticketKeys)].sort(), ...(parsed.data.commitSha ? { commitSha: parsed.data.commitSha.toLowerCase() } : {}) };
  return db.transaction(async database => {
    const { binding } = await requireSdlcBinding(actor, roomKey, database, true);
    const id = identity(input, binding);
    const record: StageHandoffRecord = { version: 1, id, fingerprint: fingerprint(input), sourceDigest: '', input, binding,
      target: SDLC_TRANSITIONS[input.transition].target, label: SDLC_TRANSITIONS[input.transition].label, status: 'offered', createdAt: new Date().toISOString() };
    const [previousRow] = await database.select().from(appRecords).where(conditions(actor, id)).limit(1);
    if (previousRow) {
      const previous = previousRow.data as StageHandoffRecord;
      if (previous.fingerprint !== record.fingerprint) throw new BadRequestError('This source handoff already exists with different inputs. Reconcile it instead of replacing it.');
      return { handoff: previous, replayed: true, blocker: previous.status === 'acknowledged' ? null : (await sourceEvidence(database, actor, input, binding, true, previous.sourceDigest ?? '')).blocker };
    }
    // Offer may wait for an active source run, but its record and binding must already exist.
    const evidence = await sourceEvidence(database, actor, input, binding, true);
    if (!evidence.source) throw new BadRequestError(evidence.blocker!);
    if (evidence.blocker && !evidence.pendingSource) throw new BadRequestError(evidence.blocker);
    if (evidence.source.updatedAt.toISOString() !== input.sourceUpdatedAt) throw new BadRequestError('Source evidence changed before handoff.');
    record.sourceDigest = fingerprint(evidence.source.data);
    const inserted = await database.insert(appRecords).values({ appId: actor.appId, orgId: actor.orgId, collection: SDLC_HANDOFF_COLLECTION, recordId: id, data: record })
      .onConflictDoNothing({ target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId] }).returning();
    if (inserted.length) return { handoff: record, replayed: false, blocker: evidence.blocker };
    const [existing] = await database.select().from(appRecords).where(conditions(actor, id)).limit(1);
    const previous = existing?.data as StageHandoffRecord | undefined;
    if (!previous || previous.fingerprint !== record.fingerprint) throw new BadRequestError('This source handoff already exists with different inputs. Reconcile it instead of replacing it.');
    return { handoff: previous, replayed: true, blocker: evidence.blocker };
  });
}

export async function listStageHandoffs(actor: HandoffActor, roomKey: unknown, cursor?: unknown) {
  const before = cursor === undefined ? null : Number(cursor);
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new BadRequestError('Invalid handoff history cursor.');
  const { binding } = await requireSdlcBinding(actor, roomKey);
  const rows = await db.select().from(appRecords).where(and(conditions(actor), sql`${appRecords.data}->'binding'->>'roomKey' = ${binding.roomKey}`, ...(before ? [lt(appRecords.id, before)] : [])))
    .orderBy(desc(appRecords.id)).limit(51);
  const items = await Promise.all(rows.slice(0, 50).map(async row => {
    const handoff = row.data as StageHandoffRecord;
    const blocker = !sameSdlcBinding(handoff.binding, binding) ? 'The room’s development binding changed; this handoff is stale.'
      : (await sourceEvidence(db, actor, handoff.input, binding, false, handoff.sourceDigest ?? '')).blocker;
    return { handoff, blocker };
  }));
  return { items, nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function acknowledgeStageHandoff(actor: HandoffActor, roomKey: unknown, id: string, target: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new BadRequestError('Invalid handoff ID.');
  return db.transaction(async database => {
    const { binding } = await requireSdlcBinding(actor, roomKey, database, true);
    const [row] = await database.select().from(appRecords).where(conditions(actor, id)).limit(1).for('update');
    const record = row?.data as StageHandoffRecord | undefined;
    if (!record || record.binding.roomKey !== binding.roomKey) throw new NotFoundError('Handoff not found.');
    if (record.target !== target) throw new BadRequestError('Acknowledge this handoff from its destination workbench.');
    if (record.status === 'acknowledged') return { handoff: record, replayed: true };
    if (!sameSdlcBinding(record.binding, binding)) throw new BadRequestError('Development binding changed; offer a new handoff.');
    const evidence = await sourceEvidence(database, actor, record.input, binding, true, record.sourceDigest ?? '');
    if (evidence.blocker) throw new BadRequestError(evidence.blocker);
    const updated: StageHandoffRecord = { ...record, status: 'acknowledged', receipt: { deploymentId: actor.deploymentId,
      at: new Date().toISOString(), sourceUpdatedAt: evidence.source!.updatedAt.toISOString(), ...(evidence.run ? { runUpdatedAt: evidence.run.updatedAt.toISOString() } : {}) } };
    await database.update(appRecords).set({ data: updated, updatedAt: new Date() }).where(conditions(actor, id));
    return { handoff: updated, replayed: false };
  });
}

/** Revalidate a received release handoff immediately before gateway execution.
 * This is evidence validation, not a human approval or an execution receipt.
 */
export async function requireReleaseHandoffContext(actor: HandoffActor, roomKey: unknown, id: unknown) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new BadRequestError('An acknowledged deployment handoff ID is required.');
  return db.transaction(async database => {
    const { binding } = await requireSdlcBinding(actor, roomKey, database, true);
    const [row] = await database.select().from(appRecords).where(conditions(actor, id)).limit(1).for('share');
    const record = row?.data as StageHandoffRecord | undefined;
    if (!record || !sameSdlcBinding(record.binding, binding)) throw new BadRequestError('Deployment handoff is unavailable under this room’s current development binding.');
    if (record.input.transition !== 'uat_to_deployment' || record.target !== 'devops-workbench' || record.status !== 'acknowledged' || !record.receipt)
      throw new BadRequestError('A deployment handoff acknowledged by the destination is required.');
    const evidence = await sourceEvidence(database, actor, record.input, binding, true, record.sourceDigest);
    if (evidence.blocker) throw new BadRequestError(evidence.blocker);
    const cab = evidence.source!.data as Record<string, any>;
    return { handoffId: record.id, commitSha: record.input.commitSha!, cabApprovalId: record.input.sourceRecordId,
      uatSignoffId: cab.uatSignoffId as string, qualityGateId: cab.qualityGateId as string };
  });
}
