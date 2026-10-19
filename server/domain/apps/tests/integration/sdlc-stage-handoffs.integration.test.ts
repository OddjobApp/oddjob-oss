/** @vitest-environment node */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { configureTestEnvironment, requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';
configureTestEnvironment();
requireTestDatabaseUrl();
const { db } = await import('@server/database_service.js');
const { apps, appRecords, orgs, crewSessions, operationalCycles, missions, missionRuns } = await import('@shared/schema/index.js');
const { and, eq, inArray } = await import('drizzle-orm');
const { offerStageHandoff, listStageHandoffs, acknowledgeStageHandoff, requireReleaseHandoffContext } = await import('../../core/sdlc-stage-handoffs.service.js');
const { executeAppRecordAction } = await import('../../core/app-records-writer.service.js');
const { reserveDeploymentLaunch, reconcileDeploymentLaunch } = await import('../../core/sdlc-deployment-launch.service.js');
const { SDLC_HANDOFF_COLLECTION } = await import('@shared/sdlc-stage-handoff.js');

const stamp = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const roomKey = `${stamp}-room`;
const revision = '2026-10-14T12:00:00.000Z';
const commitSha = 'a'.repeat(40);
let orgA = 0, orgB = 0, appA = 0, appOther = 0, appB = 0, cycleA = 0, missionId = 0;
let actor: { appId: number; orgId: number; deploymentId: number };
const development = { repositoryUrl: 'https://example.test/isolated-test-repository', branch: 'codex/acceptance', testEnvironment: 'guarded PostgreSQL test database', configuredAt: revision, configuredBy: 'test-fixture' };
const binding = () => ({ roomKey, cycleId: cycleA, revision, repositoryUrl: development.repositoryUrl, branch: development.branch });

async function source(data: Record<string, unknown> = {}, collection = 'qa_workbench_quality_gates') {
  const [row] = await db.insert(appRecords).values({ appId: appA, orgId: orgA, collection, recordId: `${stamp}-${Math.random()}`, data: {
    commitSha, result: 'pass', evidenceKind: 'runner', suiteCount: 3, sdlcContext: binding(), ...data,
  } }).returning();
  return row;
}
const qaInput = (row: typeof appRecords.$inferSelect) => ({ version: 1 as const, transition: 'qa_to_uat' as const, sourceRecordId: row.recordId, sourceUpdatedAt: row.updatedAt.toISOString(), commitSha, ticketKeys: [] });

describe('durable SDLC handoffs against PostgreSQL', () => {
  beforeAll(async () => {
    // Fail rather than silently skip if the provisioned test database is unavailable.
    await db.execute('SELECT 1 FROM app_records LIMIT 1' as any);
    const [a] = await db.insert(orgs).values({ name: `Handoff A ${stamp}` }).returning(); orgA = a.id;
    const [b] = await db.insert(orgs).values({ name: `Handoff B ${stamp}` }).returning(); orgB = b.id;
    const [app] = await db.insert(apps).values({ name: `Handoff A ${stamp}`, slug: `${stamp}-app-a`, organizationId: orgA }).returning(); appA = app.id;
    const [other] = await db.insert(apps).values({ name: `Handoff Other ${stamp}`, slug: `${stamp}-other`, organizationId: orgA }).returning(); appOther = other.id;
    const [foreign] = await db.insert(apps).values({ name: `Handoff B ${stamp}`, slug: `${stamp}-app-b`, organizationId: orgB }).returning(); appB = foreign.id;
    const [cycle] = await db.insert(operationalCycles).values({ name: stamp, objective: 'Test durable handoff semantics only; never launch external work', organizationId: orgA, createdBy: 'test-fixture' }).returning(); cycleA = cycle.id;
    await db.insert(crewSessions).values({ sessionKey: roomKey, organizationId: orgA, cycleContext: { cycleId: cycleA, developmentBinding: development } });
    await db.insert(crewSessions).values({ sessionKey: `${roomKey}-other`, organizationId: orgA, cycleContext: { cycleId: cycleA, developmentBinding: development } });
    const [mission] = await db.insert(missions).values({ name: 'Requirements & Design Analysis', organizationId: orgA, objective: 'Test source completion only', createdBy: 'test-fixture' }).returning(); missionId = mission.id;
    actor = { appId: appA, orgId: orgA, deploymentId: 101 };
  });
  beforeEach(async () => {
    await db.delete(appRecords).where(inArray(appRecords.appId, [appA, appOther, appB]));
    await db.delete(missionRuns).where(eq(missionRuns.organizationId, orgA));
    await db.update(crewSessions).set({ cycleContext: { cycleId: cycleA, developmentBinding: development } }).where(and(eq(crewSessions.organizationId, orgA), eq(crewSessions.sessionKey, roomKey)));
  });
  afterAll(async () => {
    if (!orgA) return;
    await db.delete(crewSessions).where(inArray(crewSessions.organizationId, [orgA, orgB]));
    await db.delete(missionRuns).where(eq(missionRuns.organizationId, orgA));
    await db.delete(missions).where(eq(missions.organizationId, orgA));
    await db.delete(operationalCycles).where(eq(operationalCycles.organizationId, orgA));
    await db.delete(apps).where(inArray(apps.id, [appA, appOther, appB]));
    await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
  });

  it('persists across independent reads and collapses concurrent duplicate offers', async () => {
    const row = await source();
    const results = await Promise.all([offerStageHandoff(actor, roomKey, qaInput(row)), offerStageHandoff(actor, roomKey, qaInput(row))]);
    expect(results[0].handoff.id).toBe(results[1].handoff.id);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    const restored = await listStageHandoffs(actor, roomKey);
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].handoff.status).toBe('offered');
    expect(restored.items[0].blocker).toBeNull();
    const rows = await db.select().from(appRecords).where(and(eq(appRecords.appId, appA), eq(appRecords.collection, SDLC_HANDOFF_COLLECTION)));
    expect(rows).toHaveLength(1);
  });
  it('replays a lost-response acknowledgement and serializes concurrent acknowledgements', async () => {
    const offered = await offerStageHandoff(actor, roomKey, qaInput(await source()));
    const results = await Promise.all([acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench'), acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')]);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].handoff.receipt).toEqual(results[1].handoff.receipt);
    expect((await acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')).replayed).toBe(true);
    expect(await db.select().from(missionRuns).where(eq(missionRuns.organizationId, orgA))).toHaveLength(0);
  });
  it('rejects changed duplicate inputs without overwriting the durable offer', async () => {
    const input = qaInput(await source());
    const offered = await offerStageHandoff(actor, roomKey, input);
    await expect(offerStageHandoff(actor, roomKey, { ...input, ticketKeys: ['DIFFERENT'] })).rejects.toThrow('different inputs');
    expect((await listStageHandoffs(actor, roomKey)).items[0].handoff.id).toBe(offered.handoff.id);
  });
  it('blocks stale records and stale room bindings without consuming the handoff', async () => {
    const row = await source(); const offered = await offerStageHandoff(actor, roomKey, qaInput(row));
    await db.update(appRecords).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(appRecords.id, row.id));
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('changed');
    await db.update(crewSessions).set({ cycleContext: { cycleId: cycleA, developmentBinding: { ...development, configuredAt: '2026-10-14T13:00:00.000Z' } } }).where(and(eq(crewSessions.organizationId, orgA), eq(crewSessions.sessionKey, roomKey)));
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('binding changed');
  });
  it('does not accept a superseded passing gate after a newer failure', async () => {
    const offered = await offerStageHandoff(actor, roomKey, qaInput(await source()));
    await source({ result: 'fail' });
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('newer gate');
  });
  it('keeps organization, app, room and destination boundaries intact', async () => {
    const offered = await offerStageHandoff(actor, roomKey, qaInput(await source()));
    await expect(listStageHandoffs({ ...actor, orgId: orgB }, roomKey)).rejects.toThrow('Configure');
    expect((await listStageHandoffs({ ...actor, appId: appOther }, roomKey)).items).toEqual([]);
    await expect(acknowledgeStageHandoff({ ...actor, appId: appOther }, roomKey, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('not found');
    await expect(acknowledgeStageHandoff(actor, `${roomKey}-other`, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('not found');
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'devops-workbench')).rejects.toThrow('destination');
    await expect(executeAppRecordAction({ organizationId: orgA, appId: appA, collection: SDLC_HANDOFF_COLLECTION, action: 'update_record', recordId: offered.handoff.id, data: { status: 'acknowledged' } })).rejects.toThrow('cannot forge');
  });
  it('waits for the actual source analysis run, not its launch or another deployment’s run', async () => {
    const row = await source({ jiraKey: 'T-1', prdStatus: 'Approved', uxMockupStatus: 'Approved' }, 'pm_workbench_signoffs');
    const [run] = await db.insert(missionRuns).values({ organizationId: orgA, missionId, name: stamp, createdBy: 'app-deployment:101', status: 'active', missionContext: { sdlcBinding: binding() } }).returning();
    const offered = await offerStageHandoff(actor, roomKey, { version: 1, transition: 'requirements_to_development', sourceRecordId: row.recordId, sourceUpdatedAt: row.updatedAt.toISOString(), sourceRunId: run.id, ticketKeys: ['T-1'] });
    expect(offered.blocker).toContain('not completed');
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'scrum-master-workbench')).rejects.toThrow('not completed');
    await db.update(missionRuns).set({ status: 'completed', isSuccess: true, updatedAt: new Date() }).where(eq(missionRuns.id, run.id));
    await expect(acknowledgeStageHandoff({ ...actor, deploymentId: 102 }, roomKey, offered.handoff.id, 'scrum-master-workbench')).rejects.toThrow('not completed');
    const accepted = await acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'scrum-master-workbench');
    expect(accepted.handoff.status).toBe('acknowledged');
    expect(accepted.handoff.receipt?.runUpdatedAt).toBeTruthy();
  });
  it('keeps older handoffs reachable with scoped cursor pagination', async () => {
    for (let index = 0; index < 51; index++) await offerStageHandoff(actor, roomKey, qaInput(await source()));
    const first = await listStageHandoffs(actor, roomKey);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await listStageHandoffs(actor, roomKey, first.nextCursor);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.handoff.id)).size).toBe(51);
    expect((await listStageHandoffs({ ...actor, appId: appOther }, roomKey, first.nextCursor)).items).toEqual([]);
  });
  it('requires the current UAT and QA references for a CAB handoff', async () => {
    const gate = await source();
    const uat = await source({ status: 'approved' }, 'stakeholder_workbench_uat_signoffs');
    const cab = await source({ decision: 'approve', uatSignoffId: uat.recordId, qualityGateId: gate.recordId }, 'stakeholder_workbench_cab_approvals');
    const offered = await offerStageHandoff(actor, roomKey, { ...qaInput(cab), transition: 'uat_to_deployment' });
    expect(offered.blocker).toBeNull();
    await source({ status: 'rejected' }, 'stakeholder_workbench_uat_signoffs');
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'devops-workbench')).rejects.toThrow('current same-commit UAT');
  });
  it('rejects unbound evidence and generic attempts to forge a runner gate', async () => {
    const row = await source({ sdlcContext: undefined });
    await expect(offerStageHandoff(actor, roomKey, qaInput(row))).rejects.toThrow('unavailable');
    await expect(executeAppRecordAction({ organizationId: orgA, appId: appA, collection: 'qa_workbench_quality_gates', action: 'create_record', data: { result: 'pass', evidenceKind: 'runner' } })).rejects.toThrow('must be bound and validated');
  });
  it('detects source-content edits even when a timestamp was not advanced', async () => {
    const row = await source();
    const offered = await offerStageHandoff(actor, roomKey, qaInput(row));
    await db.update(appRecords).set({ data: { ...(row.data as object), notes: 'Changed after review' } }).where(eq(appRecords.id, row.id));
    await expect(acknowledgeStageHandoff(actor, roomKey, offered.handoff.id, 'stakeholder-workbench')).rejects.toThrow('content changed');
    const replayed = await offerStageHandoff(actor, roomKey, qaInput(row));
    expect(replayed.replayed).toBe(true);
    expect(replayed.handoff.id).toBe(offered.handoff.id);
    expect(replayed.blocker).toContain('content changed');
  });
  it('rejects invalid first offers without poisoning the valid source identity', async () => {
    const input = qaInput(await source());
    await expect(offerStageHandoff(actor, roomKey, { ...input, commitSha: 'b'.repeat(40) })).rejects.toThrow('different commit');
    await expect(offerStageHandoff(actor, roomKey, { ...input, ticketKeys: ['UNREVIEWED'] })).rejects.toThrow('Ticket references');
    const offered = await offerStageHandoff(actor, roomKey, input);
    expect(offered.replayed).toBe(false);
    expect((await listStageHandoffs(actor, roomKey)).items).toHaveLength(1);
  });
  it('requires destination receipt and revalidates release evidence at execution time', async () => {
    const gate = await source();
    const uat = await source({ status: 'approved' }, 'stakeholder_workbench_uat_signoffs');
    const cab = await source({ decision: 'approve', uatSignoffId: uat.recordId, qualityGateId: gate.recordId }, 'stakeholder_workbench_cab_approvals');
    const offer = await offerStageHandoff(actor, roomKey, { ...qaInput(cab), transition: 'uat_to_deployment' });
    await expect(requireReleaseHandoffContext(actor, roomKey, offer.handoff.id)).rejects.toThrow('acknowledged');
    await acknowledgeStageHandoff(actor, roomKey, offer.handoff.id, 'devops-workbench');
    expect(await requireReleaseHandoffContext(actor, roomKey, offer.handoff.id)).toEqual({ handoffId: offer.handoff.id, commitSha,
      cabApprovalId: cab.recordId, uatSignoffId: uat.recordId, qualityGateId: gate.recordId });
    await expect(requireReleaseHandoffContext(actor, `${roomKey}-other`, offer.handoff.id)).rejects.toThrow('unavailable');
    await source({ status: 'rejected' }, 'stakeholder_workbench_uat_signoffs');
    await expect(requireReleaseHandoffContext(actor, roomKey, offer.handoff.id)).rejects.toThrow('current same-commit UAT');
    expect(await db.select().from(missionRuns).where(eq(missionRuns.organizationId, orgA))).toHaveLength(0);
  });
  it('does not use a QA receipt as deployment authorization or retain a stale room binding', async () => {
    const offer = await offerStageHandoff(actor, roomKey, qaInput(await source()));
    await acknowledgeStageHandoff(actor, roomKey, offer.handoff.id, 'stakeholder-workbench');
    await expect(requireReleaseHandoffContext(actor, roomKey, offer.handoff.id)).rejects.toThrow('deployment handoff');
    await expect(requireReleaseHandoffContext(actor, roomKey, 'invalid')).rejects.toThrow('handoff ID');
    await db.update(crewSessions).set({ cycleContext: { cycleId: cycleA, developmentBinding: { ...development, configuredAt: '2026-10-15T12:00:00.000Z' } } }).where(eq(crewSessions.sessionKey, roomKey));
    await expect(requireReleaseHandoffContext(actor, roomKey, offer.handoff.id)).rejects.toThrow('current development binding');
  });
  it('reserves one deployment attempt under concurrent requests and preserves its receipt', async () => {
    const id = 'c'.repeat(64);
    const attempts = await Promise.all([reserveDeploymentLaunch(actor, id, missionId), reserveDeploymentLaunch(actor, id, missionId)]);
    expect(attempts.filter(attempt => !attempt.replayed)).toHaveLength(1);
    const owner = attempts.find(attempt => !attempt.replayed)!;
    if (owner.replayed) throw new Error('Missing reservation owner');
    const response = { statusCode: 200, body: { status: 'launched', runId: 123 } };
    await owner.complete(response);
    expect(await reserveDeploymentLaunch(actor, id, missionId)).toEqual({ replayed: true, response });
    expect((await reserveDeploymentLaunch({ ...actor, appId: appOther }, id, missionId)).replayed).toBe(false);
  });
  it('keeps an interrupted reservation unconfirmed and prevents generic receipt mutation', async () => {
    const id = 'd'.repeat(64);
    await reserveDeploymentLaunch(actor, id, missionId);
    const retry = await reserveDeploymentLaunch(actor, id, missionId);
    expect(retry.replayed).toBe(true);
    if (!retry.replayed) throw new Error('Unexpected new attempt');
    expect(retry.response.body).toMatchObject({ status: 'unconfirmed', queued: false, runId: null });
    await expect(executeAppRecordAction({ organizationId: orgA, appId: appA, collection: 'sdlc_deployment_launches', action: 'delete_record', recordId: id })).rejects.toThrow('cannot forge');
  });
  it('recovers an exact lost launch receipt without authorizing another launch', async () => {
    const gate = await source();
    const uat = await source({ status: 'approved' }, 'stakeholder_workbench_uat_signoffs');
    const cab = await source({ decision: 'approve', uatSignoffId: uat.recordId, qualityGateId: gate.recordId }, 'stakeholder_workbench_cab_approvals');
    const offered = await offerStageHandoff(actor, roomKey, { ...qaInput(cab), transition: 'uat_to_deployment' });
    const id = offered.handoff.id;
    await acknowledgeStageHandoff(actor, roomKey, id, 'devops-workbench');
    await reserveDeploymentLaunch(actor, id, missionId);
    expect(await reconcileDeploymentLaunch(actor, roomKey, id)).toMatchObject({ reconciled: false, status: 'unconfirmed' });
    await expect(reconcileDeploymentLaunch(actor, `${roomKey}-other`, id)).rejects.toThrow('unavailable');
    // A foreign deployment's apparent match must never qualify.
    await db.insert(missionRuns).values({ organizationId: orgA, missionId, name: stamp, createdBy: 'app-deployment:999', status: 'active', missionContext: { sdlcBinding: binding(), context: { handoffId: id } } });
    expect(await reconcileDeploymentLaunch(actor, roomKey, id)).toMatchObject({ reconciled: false });
    const [run] = await db.insert(missionRuns).values({ organizationId: orgA, missionId, name: stamp, createdBy: 'app-deployment:101', status: 'active', missionContext: { sdlcBinding: binding(), context: { handoffId: id } } }).returning();
    expect(await reconcileDeploymentLaunch(actor, roomKey, id)).toMatchObject({ reconciled: true, runId: run.id, runStatus: 'active' });
    const retry = await reserveDeploymentLaunch(actor, id, missionId);
    expect(retry).toMatchObject({ replayed: true, response: { body: { runId: run.id, status: 'launched' } } });
    await db.insert(missionRuns).values({ organizationId: orgA, missionId, name: stamp, createdBy: 'app-deployment:101', status: 'active', missionContext: { sdlcBinding: binding(), context: { handoffId: id } } });
    expect(await reconcileDeploymentLaunch(actor, roomKey, id)).toMatchObject({ reconciled: false, status: 'ambiguous' });
  });
});
