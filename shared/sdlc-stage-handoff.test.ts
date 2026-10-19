import { describe, expect, it } from 'vitest';
import { handoffSourceBlocker, sameSdlcBinding, stageHandoffInputSchema } from './sdlc-stage-handoff';
const sha = 'a'.repeat(40);
const source = { version: 1, transition: 'qa_to_uat', sourceRecordId: 'gate', sourceUpdatedAt: '2026-10-14T12:00:00.000Z', commitSha: sha };
describe('stage handoff source contract', () => {
  it('never treats the launched UAT run as the QA source', () => {
    expect(stageHandoffInputSchema.safeParse({ ...source, sourceRunId: 100 }).success).toBe(false);
    expect(stageHandoffInputSchema.safeParse(source).success).toBe(true);
    expect(stageHandoffInputSchema.safeParse({ ...source, commitSha: undefined }).success).toBe(false);
  });
  it('does not accept a failed or unverified gate for the current commit', () => {
    const input = stageHandoffInputSchema.parse(source);
    expect(handoffSourceBlocker(input, { result: 'pass', evidenceKind: 'runner', commitSha: sha })).toBeNull();
    expect(handoffSourceBlocker(input, { result: 'fail', evidenceKind: 'runner', commitSha: sha })).toContain('passing');
    expect(handoffSourceBlocker(input, { result: 'pass', evidenceKind: 'manual', commitSha: sha })).toContain('runner');
    expect(handoffSourceBlocker(input, { result: 'pass', evidenceKind: 'runner', commitSha: 'b'.repeat(40) })).toContain('different commit');
  });
  it('requires successful source completion and approved source sign-off', () => {
    const input = stageHandoffInputSchema.parse({ ...source, transition: 'requirements_to_development', sourceRunId: 7, ticketKeys: ['T-1'] });
    const approved = { jiraKey: 'T-1', prdStatus: 'Approved', uxMockupStatus: 'Approved', commitSha: sha };
    expect(handoffSourceBlocker(input, approved, { status: 'active', isSuccess: null })).toContain('not completed');
    expect(handoffSourceBlocker(input, approved, { status: 'completed', isSuccess: false })).toContain('not completed');
    expect(handoffSourceBlocker(input, approved, { status: 'completed', isSuccess: true })).toBeNull();
    expect(handoffSourceBlocker(input, { ...approved, prdStatus: 'Rejected' }, { status: 'completed', isSuccess: true })).toContain('approved');
  });
  it('rejects changes to room, cycle, repository, branch and configuration revision', () => {
    const binding = { roomKey: 'room', cycleId: 8, repositoryUrl: 'https://example.test/repo', branch: 'work', revision: 'version-1' };
    expect(sameSdlcBinding({ ...binding }, binding)).toBe(true);
    for (const key of Object.keys(binding)) expect(sameSdlcBinding({ ...binding, [key]: 'changed' }, binding)).toBe(false);
  });
});
