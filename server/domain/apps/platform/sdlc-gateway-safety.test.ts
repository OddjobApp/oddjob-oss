import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const rows: any[][] = [];
  const insert = vi.fn();
  const launch = vi.fn();
  const update = vi.fn();
  const predicates: unknown[] = [];
  const outbox = vi.fn();
  const select = () => {
    const chain: any = { from: () => chain, where: (condition: unknown) => { predicates.push(condition); return chain; }, orderBy: () => chain, limit: async () => rows.shift() ?? [], then: (resolve: any, reject: any) => Promise.resolve(rows.shift() ?? []).then(resolve, reject) };
    return chain;
  };
  return { rows, insert, launch, update, predicates, select, outbox, binding: vi.fn(), release: vi.fn(), reserve: vi.fn(), complete: vi.fn() };
});
vi.mock('../core/sdlc-deployment-launch.service.js', () => ({ reserveDeploymentLaunch: mocks.reserve }));
vi.mock('../core/sdlc-stage-handoffs.service.js', () => ({ requireSdlcBinding: mocks.binding, requireReleaseHandoffContext: mocks.release }));
vi.mock("@server/database_service.js", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update } }));
vi.mock("@domain/mission/core/mission.service.js", () => ({ missionService: { launchMission: mocks.launch } }));
vi.mock("@domain/knowledge/core/dataset-service.js", () => ({ datasetService: {} }));
vi.mock("../apps-platform.helpers.js", () => ({ normalizeLookupName: (s: string) => s.toLowerCase().trim(), recordAppOutbox: mocks.outbox, resolveOrgAppIdBySlug: vi.fn() }));
vi.mock("@server/utils/logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
import { MissionsController } from "./missions.controller";
import { DatasetsController } from "./datasets.controller";

const sha = "a".repeat(40);
const token = { appId: 888, orgId: 342, deploymentId: 874 };
describe("SDLC gateway execution barriers", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.launch.mockReset(); mocks.outbox.mockReset(); mocks.binding.mockReset(); mocks.release.mockReset(); mocks.reserve.mockReset(); mocks.reserve.mockResolvedValue({ replayed: false, complete: mocks.complete }); mocks.rows.length = 0; mocks.predicates.length = 0; });
  it('blocks a room deployment before launch if its handoff cannot be revalidated', async () => {
    mocks.binding.mockResolvedValue({ binding: { roomKey: 'room', revision: 'revision' } });
    mocks.release.mockRejectedValue(new Error('Destination receipt required'));
    await expect(MissionsController.triggerMission({ appTokenContext: token, query: { crewRoom: 'room' }, body: { name: 'Production Deployment', context: { handoffId: 'unreceived' } } } as any, {} as any)).rejects.toThrow('Destination receipt required');
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('replaces caller release identifiers with the revalidated handoff context', async () => {
    const context = { handoffId: 'a'.repeat(64), commitSha: sha, cabApprovalId: 'cab', uatSignoffId: 'uat', qualityGateId: 'gate' };
    mocks.binding.mockResolvedValue({ binding: { roomKey: 'room', revision: 'revision' } });
    mocks.release.mockResolvedValue(context);
    mocks.rows.push([{ recordId: 'cab', data: { decision: 'approve', ...context } }], [{ recordId: 'uat', data: { status: 'approved', commitSha: sha } }],
      [{ recordId: 'gate', data: { result: 'pass', evidenceKind: 'runner', suiteCount: 1, commitSha: sha } }], [{ id: 12, name: 'Production Deployment' }]);
    mocks.launch.mockResolvedValue({ success: true, missionRunId: 25 });
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await MissionsController.triggerMission({ appTokenContext: token, query: { crewRoom: 'room' }, body: { name: 'Production Deployment', context: { handoffId: context.handoffId, commitSha: 'b'.repeat(40), cabApprovalId: 'forged' } } } as any, res);
    expect(mocks.release).toHaveBeenCalledWith(token, 'room', context.handoffId);
    expect(mocks.launch).toHaveBeenCalledWith(12, 'app-deployment:874', 342, undefined, expect.objectContaining({ context }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'launched', runId: 25 }));
    expect(mocks.complete).toHaveBeenCalledWith({ statusCode: 200, body: expect.objectContaining({ runId: 25 }) });
    mocks.rows.push([{ recordId: 'cab', data: { decision: 'approve', ...context } }], [{ recordId: 'uat', data: { status: 'approved', commitSha: sha } }],
      [{ recordId: 'gate', data: { result: 'pass', evidenceKind: 'runner', suiteCount: 1, commitSha: sha } }], [{ id: 12, name: 'Production Deployment' }]);
    mocks.reserve.mockResolvedValueOnce({ replayed: true, response: { statusCode: 200, body: { status: 'launched', runId: 25 } } });
    await MissionsController.triggerMission({ appTokenContext: token, query: { crewRoom: 'room' }, body: { name: 'Production Deployment', context } } as any, res);
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenLastCalledWith({ status: 'launched', runId: 25, replayed: true });
  });
  it("does not launch production when a browser only claims approval", async () => {
    const req: any = { appTokenContext: token, body: { name: "Production Deployment", context: { cabApproved: true } } };
    await expect(MissionsController.triggerMission(req, {} as any)).rejects.toThrow(/commit SHA/);
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("rejects an old approval superseded by a later decision", async () => {
    mocks.rows.push([{ recordId: "new-rejection", data: { decision: "reject", commitSha: sha } }], [], []);
    const req: any = { appTokenContext: token, body: { name: "Production Deployment", context: { commitSha: sha, cabApprovalId: "old-approval", uatSignoffId: "uat", qualityGateId: "gate" } } };
    await expect(MissionsController.triggerMission(req, {} as any)).rejects.toThrow(/saved CAB/);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.predicates).toHaveLength(3);
  });
  it("prevents browser-created passing gates with no persisted runner evidence", async () => {
    mocks.rows.push([], []);
    const req: any = { appTokenContext: token, query: { collection: "qa_workbench_quality_gates" }, body: { result: "pass", commitSha: sha, suiteCount: 100, evidenceKind: "runner" } };
    await expect(DatasetsController.createDataset(req, {} as any)).rejects.toThrow(/No runner/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("classifies a structured execution failure as failed, without automatically retrying", async () => {
    mocks.rows.push([{ id: 12, name: "Qualify Lead" }]);
    mocks.launch.mockResolvedValueOnce({ success: false, error: "No objective" });
    mocks.outbox.mockResolvedValueOnce("operation-1");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await MissionsController.triggerMission({ appTokenContext: token, body: { name: "Qualify Lead", context: { jiraKey: "REQ-42" } } } as any, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", runId: null }));
    expect(mocks.outbox).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not queue a duplicate when an execution returns success without a durable receipt", async () => {
    mocks.rows.push([{ id: 12, name: "Qualify Lead" }]);
    mocks.launch.mockResolvedValueOnce({ success: true, missionId: 12 });
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await MissionsController.triggerMission({ appTokenContext: token, body: { name: "Qualify Lead" } } as any, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "unconfirmed", runId: null }));
    expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it("records transport exceptions for reconciliation rather than an automatic mission retry", async () => {
    mocks.rows.push([{ id: 12, name: "Qualify Lead" }]);
    mocks.launch.mockRejectedValueOnce(new Error("Connection lost"));
    mocks.outbox.mockResolvedValueOnce("reconcile-1");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await MissionsController.triggerMission({ appTokenContext: token, body: { name: "Qualify Lead" } } as any, res);
    expect(mocks.outbox).toHaveBeenCalledWith(888, 342, "mission-trigger-reconciliation", expect.objectContaining({ reason: "launch-outcome-unknown" }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "unconfirmed", queued: false, outboxRecordId: "reconcile-1" }));
  });
  it("prevents mutation or deletion of saved approvals and training signoffs", async () => {
    const req: any = { appTokenContext: token, query: { collection: "stakeholder_workbench_cab_approvals" }, params: { id: "cab" }, body: { commitSha: "b".repeat(40) } };
    await expect(DatasetsController.updateDataset(req, {} as any)).rejects.toThrow(/immutable/);
    await expect(DatasetsController.deleteDataset({ appTokenContext: token, query: { collection: "training_signoffs" }, params: { id: "signoff-1" } } as any, {} as any)).rejects.toThrow(/immutable/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
