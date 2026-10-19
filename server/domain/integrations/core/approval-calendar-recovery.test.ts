/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], saved: undefined as any, returning: [{ id: 99 }] as any[], reconcile: vi.fn(), execute: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.rows.shift()] }) }) }),
  update: () => ({ set: (value: any) => { state.saved = value; return { where: () => ({ returning: async () => state.returning }) }; } }),
} }));
vi.mock('@domain/core/auth/jwt.service.js', () => ({ validateExternalToken: vi.fn(), generateExternalToken: vi.fn() }));
vi.mock('./external.service.js', () => ({ externalService: {} }));
vi.mock('../../mission/core/mission-run.service.js', () => ({ missionRunService: {} }));
vi.mock('@domain/queue/queue.service.js', () => ({ queueService: {}, JobPriority: {} }));
vi.mock('../workers/approval-notification.worker.js', () => ({ ApprovalNotificationType: {} }));
vi.mock('../../governor/core/decision-router.js', () => ({ decisionRouter: {} }));
vi.mock('@domain/core/infrastructure/event-stream.service.js', () => ({ eventStream: {} }));
vi.mock('@domain/tools/v1/capabilities/google-calendar.js', () => ({ reconcileCalendarApproval: state.reconcile,
  executeCalendarApproval: state.execute, calendarFailure: (error: Error) => ({ success: false, error: error.message }) }));
import { approvalService } from './approval.service.js';

const request = () => ({ id: 99, status: 'approved', organizationId: 342, approverId: 'reviewer', approverEmail: 'reviewer@example.com',
  toolArgs: { kind: 'calendar_action', actionName: 'gcal_create_event', args: { reviewed: true }, projectId: 3, sessionKey: 'room', workflow: { version: 1 } },
  modifiedOutput: { outcome: { success: false, state: 'outcome_unknown' } } });
describe('persisted Calendar outcome recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); state.rows = [request()]; state.saved = undefined; state.returning = [{ id: 99 }]; state.reconcile.mockResolvedValue({ id: 'event123' }); });
  it('checks the stored action and preserves scope, ignoring client replacement arguments', async () => {
    const result = await approvalService.processDecision(99, { decision: 'approved', modifiedOutput: { args: { redirected: true } } }, 'reviewer', 'reviewer@example.com');
    expect(state.reconcile).toHaveBeenCalledWith({ reviewed: true }, { organizationId: 342, projectId: 3, sessionKey: 'room', calendarWorkflow: { version: 1 } }, 99);
    expect(state.execute).not.toHaveBeenCalled();
    expect(result.calendarAction).toMatchObject({ success: true, state: 'succeeded', recovered: true, result: { id: 'event123' } });
    expect(state.saved.modifiedOutput.workflow.state).toBe('succeeded');
  });
  it('rejects an unrelated approver before any provider read or persistence', async () => {
    await expect(approvalService.processDecision(99, { decision: 'approved' }, 'other', 'other@example.com')).rejects.toThrow('designated approver');
    expect(state.reconcile).not.toHaveBeenCalled();
    expect(state.saved).toBeUndefined();
  });
  it('returns an already verified result without a provider call', async () => {
    state.rows[0].modifiedOutput.outcome = { success: true, result: { id: 'event123' } };
    const result = await approvalService.processDecision(99, { decision: 'approved' }, 'reviewer', 'reviewer@example.com');
    expect(result.calendarAction.success).toBe(true);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it('keeps an unresolved read unknown and never creates again', async () => {
    state.reconcile.mockRejectedValue(new Error('Not found'));
    const result = await approvalService.processDecision(99, { decision: 'approved' }, 'reviewer', 'reviewer@example.com');
    expect(result.calendarAction).toMatchObject({ success: false, state: 'outcome_unknown' });
    expect(state.execute).not.toHaveBeenCalled();
  });
  it('returns the concurrent executor result when the recovery snapshot is stale', async () => {
    state.returning = [];
    state.rows.push({ modifiedOutput: { outcome: { success: true, state: 'succeeded', result: { id: 'concurrent' } } } });
    const result = await approvalService.processDecision(99, { decision: 'approved' }, 'reviewer', 'reviewer@example.com');
    expect(result.calendarAction.result.id).toBe('concurrent');
    expect(state.execute).not.toHaveBeenCalled();
  });
});
