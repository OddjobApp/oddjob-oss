import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { requireTestDatabaseUrl } from '../../../../tests/configure-test-environment.js';
import { db } from '@server/database_service.js';
import { approvalRequests, crewSessions, crewTurns } from '@shared/schema/index.js';
import { calendarArgsHash } from '@domain/tools/v1/capabilities/google-calendar.js';
import { exportCalendarOperationSkill } from './crew-operation-skill.service.js';
it('persists one review draft across repeated exports and refuses another room or organization', async () => {
  requireTestDatabaseUrl();
  const rollback = new Error('operation export rollback');
  try {
    await db.transaction(async tx => {
      const select = vi.spyOn(db, 'select').mockImplementation(tx.select.bind(tx) as any);
      const transaction = vi.spyOn(db, 'transaction').mockImplementation(tx.transaction.bind(tx) as any);
      try {
        const [room] = await tx.insert(crewSessions).values({ organizationId: 1, sessionKey: `export-${randomUUID()}` }).returning();
        const args = { calendar_id: 'private', event: { summary: 'private' } };
        const meta = { type: 'approval_request', kind: 'calendar_action', actionName: 'gcal_create_event', sessionKey: room.sessionKey, projectId: null, args };
        const workflow = { version: 1, recipe: 'email_to_calendar', organizationId: 1, projectId: null, sessionKey: room.sessionKey, calendarId: 'private', calendarTimeZone: 'UTC', approvedArgsHash: calendarArgsHash(args), state: 'succeeded', sources: [{ provider: 'gmail', messageId: 'private', contentHash: 'a'.repeat(64), retrievedAt: '2026-10-09T12:00:00Z' }] };
        const [approval] = await tx.insert(approvalRequests).values({ organizationId: 1, executionId: randomUUID(), approverType: 'user', approverEmail: 'test', token: randomUUID(), status: 'approved', toolName: 'gcal_create_event', toolArgs: meta, modifiedOutput: { ...meta, workflow, outcome: { success: true, state: 'succeeded', result: { id: 'private-event' } } } }).returning();
        const [turn] = await tx.insert(crewTurns).values({ organizationId: 1, sessionId: room.id, speakerType: 'agent', speakerName: 'Test', content: 'Proposal prepared', toolsUsed: [{ name: 'gcal_create_event', ok: true, ms: 1 }], artifacts: [{ tool: 'gcal_create_event', payload: { ...meta, proposalId: approval.id } }] }).returning();
        const first = await exportCalendarOperationSkill(room, approval.id);
        expect(await exportCalendarOperationSkill(room, approval.id)).toEqual(first);
        const [reloaded] = await tx.select().from(crewTurns).where(eq(crewTurns.id, turn.id));
        expect(reloaded.artifacts.filter(artifact => artifact.payload.type === 'crew_operation_skill_draft')).toHaveLength(1);
        expect(reloaded.artifacts[0].payload.proposalId).toBe(approval.id);
        await expect(exportCalendarOperationSkill({ ...room, organizationId: 2 }, approval.id)).rejects.toThrow('unavailable');
        await expect(exportCalendarOperationSkill({ ...room, sessionKey: 'another-room' }, approval.id)).rejects.toThrow('verified');
      } finally { select.mockRestore(); transaction.mockRestore(); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
