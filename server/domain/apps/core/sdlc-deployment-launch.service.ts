import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { appRecords, missionRuns } from '@shared/schema/index.js';
import { SDLC_DEPLOYMENT_LAUNCH_COLLECTION, SDLC_HANDOFF_COLLECTION, sameSdlcBinding, type StageHandoffRecord } from '@shared/sdlc-stage-handoff.js';
import { BadRequestError } from '@server/utils/errors.js';
import type { HandoffActor } from './sdlc-stage-handoffs.service.js';
import { requireSdlcBinding } from './sdlc-stage-handoffs.service.js';

export interface DeploymentLaunchResponse { statusCode: number; body: Record<string, unknown> }
/** Reserve before calling execution. A crashed/unknown attempt is never automatically retried. */
export async function reserveDeploymentLaunch(actor: HandoffActor, handoffId: string, missionId: number) {
  if (!/^[a-f0-9]{64}$/.test(handoffId)) throw new BadRequestError('Invalid deployment handoff ID.');
  const where = and(eq(appRecords.appId, actor.appId), eq(appRecords.orgId, actor.orgId),
    eq(appRecords.collection, SDLC_DEPLOYMENT_LAUNCH_COLLECTION), eq(appRecords.recordId, handoffId));
  const pending: DeploymentLaunchResponse = { statusCode: 202, body: { runId: null, status: 'unconfirmed', queued: false,
    handoffId, missionId, message: 'A launch attempt is reserved or its outcome is unknown. Reconcile before retrying; no new launch was started.' } };
  const rows = await db.insert(appRecords).values({ appId: actor.appId, orgId: actor.orgId,
    collection: SDLC_DEPLOYMENT_LAUNCH_COLLECTION, recordId: handoffId,
    data: { version: 1, handoffId, missionId, deploymentId: actor.deploymentId, state: 'reserved', response: pending } })
    .onConflictDoNothing({ target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId] }).returning();
  if (!rows.length) {
    const [existing] = await db.select().from(appRecords).where(where).limit(1);
    if (!existing) throw new BadRequestError('Deployment attempt could not be reconciled.');
    return { replayed: true as const, response: (existing.data as any).response as DeploymentLaunchResponse };
  }
  return { replayed: false as const, async complete(response: DeploymentLaunchResponse) {
    await db.update(appRecords).set({ updatedAt: new Date(), data: { version: 1, handoffId, missionId,
      deploymentId: actor.deploymentId, state: 'recorded', response } }).where(where);
  } };
}

/** Recover only an exact persisted launch; absence never proves it is safe to relaunch. */
export async function reconcileDeploymentLaunch(actor: HandoffActor, roomKey: unknown, handoffId: string) {
  if (!/^[a-f0-9]{64}$/.test(handoffId)) throw new BadRequestError('Invalid deployment handoff ID.');
  return db.transaction(async database => {
    const { binding } = await requireSdlcBinding(actor, roomKey, database, true);
    const scoped = (collection: string) => and(eq(appRecords.appId, actor.appId), eq(appRecords.orgId, actor.orgId), eq(appRecords.collection, collection), eq(appRecords.recordId, handoffId));
    const [source] = await database.select().from(appRecords).where(scoped(SDLC_HANDOFF_COLLECTION)).limit(1);
    const handoff = source?.data as StageHandoffRecord | undefined;
    if (!handoff || !sameSdlcBinding(handoff.binding, binding) || handoff.input.transition !== 'uat_to_deployment' || handoff.status !== 'acknowledged')
      throw new BadRequestError('Acknowledged deployment handoff unavailable in this room.');
    const [attempt] = await database.select().from(appRecords).where(scoped(SDLC_DEPLOYMENT_LAUNCH_COLLECTION)).limit(1).for('update');
    if (!attempt) throw new BadRequestError('No deployment attempt is recorded for this handoff.');
    const saved = attempt.data as any;
    const runs = await database.select().from(missionRuns).where(and(eq(missionRuns.organizationId, actor.orgId),
      eq(missionRuns.missionId, saved.missionId), eq(missionRuns.createdBy, `app-deployment:${saved.deploymentId}`), isNull(missionRuns.deletedAt),
      sql`${missionRuns.missionContext}->'sdlcBinding' = ${JSON.stringify(binding)}::jsonb`,
      sql`${missionRuns.missionContext}->'context'->>'handoffId' = ${handoffId}`)).limit(2);
    const matches = runs.filter(run => sameSdlcBinding((run.missionContext as any)?.sdlcBinding, binding) &&
      (run.missionContext as any)?.context?.handoffId === handoffId);
    if (matches.length !== 1) return { reconciled: false, status: matches.length ? 'ambiguous' : 'unconfirmed',
      message: 'No unique matching run receipt was established. No new launch was started.', handoffId };
    const run = matches[0];
    const priorRunId = saved.response?.body?.runId;
    if (priorRunId != null && priorRunId !== run.id) throw new BadRequestError('Saved launch receipt conflicts with execution evidence; manual reconciliation is required.');
    if (saved.response?.body?.status === 'unconfirmed') {
      const response: DeploymentLaunchResponse = { statusCode: 200, body: { status: 'launched', runId: run.id,
        missionId: saved.missionId, handoffId, reconciled: true } };
      await database.update(appRecords).set({ updatedAt: new Date(), data: { ...saved, state: 'recorded', response } }).where(scoped(SDLC_DEPLOYMENT_LAUNCH_COLLECTION));
    }
    return { reconciled: true, handoffId, runId: run.id, runStatus: run.status, isSuccess: run.isSuccess,
      message: 'A matching mission run exists. This does not establish external deployment completion.' };
  });
}
