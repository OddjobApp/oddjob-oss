import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
vi.mock('@server/database_service.js', () => ({ db: {} }));
import { calendarOperationSkillDraft } from './crew-operation-skill.service.js';
import { calendarArgsHash } from '@domain/tools/v1/capabilities/google-calendar.js';
import { operationSkillMarkdown } from '@shared/crew-operation-skill.js';
const room = { organizationId: 342, projectId: 7, sessionKey: 'private-room' };
const args = { calendar_id: 'private-calendar', event: { summary: 'Confidential appointment', attendees: [{ email: 'private@example.com' }] } };
const workflow = { version: 1, recipe: 'email_to_calendar', ...room, sources: [{ provider: 'gmail', messageId: 'private-message', contentHash: createHash('sha256').update('private email').digest('hex'), retrievedAt: '2026-10-09T12:00:00Z' }], calendarId: 'private-calendar', calendarTimeZone: 'America/Los_Angeles', approvedArgsHash: calendarArgsHash(args), state: 'succeeded' };
const meta = { kind: 'calendar_action', actionName: 'gcal_create_event', sessionKey: room.sessionKey, projectId: 7, args };
const stored = { ...meta, workflow, outcome: { success: true, state: 'succeeded', result: { id: 'private-event', summary: 'Confidential appointment', htmlLink: 'https://provider?token=secret' } } };
it('exports a parameterized draft from verified results without provider payloads or fixed identifiers', () => {
  const draft = calendarOperationSkillDraft({ room, status: 'approved', meta, stored });
  const exportText = JSON.stringify(draft) + operationSkillMarkdown(draft);
  for (const privateValue of ['private-room', 'private-calendar', 'private-message', 'private-event', 'private@example.com', 'Confidential appointment', 'token=secret']) expect(exportText).not.toContain(privateValue);
  expect(draft.status).toBe('draft');
  expect(draft.steps.find(step => step.tool === 'gcal_create_event')?.checkpoint).toContain('Human approval');
  expect(draft.regressionScenarios).toContain('Duplicate invocation');
});
it.each(['pending', 'rejected'])('refuses %s approvals', status => {
  expect(() => calendarOperationSkillDraft({ room, status, meta, stored })).toThrow('verified');
});
it.each(['executing', 'outcome_unknown', 'failed', 'cancelled'])('refuses %s provider outcomes', state => {
  expect(() => calendarOperationSkillDraft({ room, status: 'approved', meta, stored: { ...stored, outcome: { success: false, state }, workflow: { ...workflow, state } } })).toThrow('verified');
});
it('refuses wrong scope, absent source receipts, missing provider IDs and modified inputs', () => {
  expect(() => calendarOperationSkillDraft({ room: { ...room, organizationId: 999 }, status: 'approved', meta, stored })).toThrow('verified');
  expect(() => calendarOperationSkillDraft({ room: { ...room, projectId: 8 }, status: 'approved', meta, stored })).toThrow('verified');
  expect(() => calendarOperationSkillDraft({ room, status: 'approved', meta, stored: { ...stored, workflow: { ...workflow, sources: [] } } })).toThrow('verified');
  expect(() => calendarOperationSkillDraft({ room, status: 'approved', meta, stored: { ...stored, outcome: { success: true, state: 'succeeded', result: {} } } })).toThrow('verified');
  expect(() => calendarOperationSkillDraft({ room, status: 'approved', meta: { ...meta, args: {} }, stored })).toThrow('inputs');
});
