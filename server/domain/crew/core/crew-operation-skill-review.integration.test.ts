import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTestDatabaseUrl } from '../../../../tests/configure-test-environment.js';
const mocks = vi.hoisted(() => ({ members: vi.fn(), readiness: vi.fn() }));
vi.mock('./crew-repository.js', () => ({ crewRepository: { getMembers: mocks.members } }));
vi.mock('./crew-readiness.service.js', () => ({ getCrewReadiness: mocks.readiness }));
vi.mock('./crew-tools.service.js', () => ({ crewToolsService: { resolveForCard: async () => [
  { definition: { name: 'get_crew_readiness', parameters: z.object({}) } },
  { definition: { name: 'gmail_get_message', parameters: z.object({ message_id: z.string() }) } },
  { definition: { name: 'gcal_get_calendar', parameters: z.object({ calendar_id: z.string() }) } },
  { definition: { name: 'gcal_create_event', parameters: z.object({ event: z.object({ summary: z.string(), start: z.object({ date: z.string() }), end: z.object({ date: z.string() }) }).refine(event => event.end.date > event.start.date) }) } },
] } }));
import { db } from '@server/database_service.js';
import { crewSessions, crewTurns, agentCards, skills, skillReviews, skillAugmentations, approvalRequests } from '@shared/schema/index.js';
import { submitOperationSkillReview, approveOperationSkillReview } from './crew-operation-skill-review.service.js';
import { calendarOperationSkillDraft } from './crew-operation-skill.service.js';
import { calendarArgsHash } from '@domain/tools/v1/capabilities/google-calendar.js';
it('submits an immutable disabled version, approves through governance once, and denies foreign scope or failed access', async () => {
  requireTestDatabaseUrl(); const rollback = new Error('skill review rollback');
  try { await db.transaction(async tx => {
    const spies = [vi.spyOn(db, 'select').mockImplementation(tx.select.bind(tx) as any), vi.spyOn(db, 'insert').mockImplementation(tx.insert.bind(tx) as any), vi.spyOn(db, 'update').mockImplementation(tx.update.bind(tx) as any), vi.spyOn(db, 'transaction').mockImplementation(tx.transaction.bind(tx) as any)];
    try {
      const [room] = await tx.insert(crewSessions).values({ organizationId: 1, sessionKey: `review-${randomUUID()}` }).returning();
      const [card] = await tx.insert(agentCards).values({ organizationId: 1, name: `review-${randomUUID()}`, description: 'Test', personaType: 'general' }).returning();
      mocks.members.mockResolvedValue([card]);
      mocks.readiness.mockResolvedValue({ checks: ['Gmail reading', 'Calendar reading', 'Calendar editing'].map(label => ({ label, state: 'passed', detail: 'Mock credential preflight' })) });
      const args = { calendar_id: 'private', event: { summary: 'Private' } };
      const meta = { type: 'approval_request', kind: 'calendar_action', actionName: 'gcal_create_event', sessionKey: room.sessionKey, projectId: null, args };
      const stored = { ...meta, workflow: { version: 1, recipe: 'email_to_calendar', organizationId: 1, projectId: null, sessionKey: room.sessionKey, calendarId: 'private', calendarTimeZone: 'UTC', approvedArgsHash: calendarArgsHash(args), state: 'succeeded', sources: [{ provider: 'gmail', messageId: 'private', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-09T12:00:00Z' }] }, outcome: { success: true, state: 'succeeded', result: { id: 'private-event' } } };
      const [approval] = await tx.insert(approvalRequests).values({ organizationId: 1, executionId: randomUUID(), approverType: 'user', approverEmail: 'test', token: randomUUID(), status: 'approved', toolArgs: meta, modifiedOutput: stored }).returning();
      const draft = calendarOperationSkillDraft({ room, status: 'approved', meta, stored });
      await tx.insert(crewTurns).values({ organizationId: 1, sessionId: room.id, speakerType: 'agent', speakerName: 'Test', content: 'Draft', toolsUsed: [{ name: 'gcal_create_event', ok: true, ms: 1 }], artifacts: [{ tool: 'gcal_create_event', payload: { ...meta, proposalId: approval.id } }, { tool: draft.type, payload: { ...draft } }] });
      const edits = { name: 'Reviewed email calendar skill', inputs: draft.inputs, targetAgentId: card.id };
      const [storedApproval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, approval.id));
      expect(calendarOperationSkillDraft({ room, status: storedApproval.status, meta: storedApproval.toolArgs, stored: storedApproval.modifiedOutput }).evidenceHash).toBe(draft.evidenceHash);
      const registered = await submitOperationSkillReview(room, draft.evidenceHash, edits, 'test-reviewer');
      expect(await submitOperationSkillReview(room, draft.evidenceHash, edits, 'test-reviewer')).toEqual(registered);
      const [disabled] = await tx.select().from(skills).where(eq(skills.id, registered.skillId));
      expect(disabled.isInstalled).toBe(false); expect(disabled.organizationId).toBe(1); expect(disabled.language).toBe('workflow_contract');
      const [pending] = await tx.select().from(skillReviews).where(eq(skillReviews.id, registered.reviewId)); expect(pending.status).toBe('pending');
      await expect(submitOperationSkillReview(room, draft.evidenceHash, { ...edits, name: 'Changed version' }, 'test-reviewer')).rejects.toThrow('immutable');
      await expect(submitOperationSkillReview({ ...room, organizationId: 2 }, draft.evidenceHash, edits, 'test-reviewer')).rejects.toThrow('unavailable');
      mocks.readiness.mockResolvedValueOnce({ checks: [] });
      await expect(approveOperationSkillReview(room, draft.evidenceHash, 'test-reviewer')).rejects.toThrow('current access');
      expect((await approveOperationSkillReview(room, draft.evidenceHash, 'test-reviewer')).status).toBe('approved');
      await approveOperationSkillReview(room, draft.evidenceHash, 'test-reviewer');
      const [enabled] = await tx.select().from(skills).where(eq(skills.id, registered.skillId)); expect(enabled.isInstalled).toBe(true);
      const augmentations = await tx.select().from(skillAugmentations).where(eq(skillAugmentations.reviewId, registered.reviewId)); expect(augmentations).toHaveLength(1);
      const [approved] = await tx.select().from(skillReviews).where(eq(skillReviews.id, registered.reviewId)); expect(approved.status).toBe('augmented'); expect(approved.reviewerId).toBe('test-reviewer');
    } finally { spies.forEach(spy => spy.mockRestore()); }
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
});
