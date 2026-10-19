import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
import { ExportCalendarOperationSkill } from './CrewOperationSkillDraftView';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('prepares a scoped draft only after a click and presents review before download', async () => {
  request.mockResolvedValue({ json: async () => ({ type: 'crew_operation_skill_draft', version: 1, status: 'draft', recipe: 'email_to_calendar', name: 'Email to reviewed calendar event', evidenceHash: 'abc', inputs: { messageIds: 'Fresh IDs' }, steps: [{ tool: 'gcal_create_event', purpose: 'Propose', checkpoint: 'Human approval' }], scopes: ['Calendar editing'], successCriteria: ['Provider ID'], recovery: ['Reconcile unknown outcome'], regressionScenarios: ['Duplicate invocation'], limitations: ['Draft only'] }) });
  render(<ExportCalendarOperationSkill proposalId={8} organizationId={342} roomKey="room" />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Export as skill draft' }));
  expect(await screen.findByText('Email to reviewed calendar event')).toBeTruthy();
  expect(request).toHaveBeenCalledWith('POST', '/api/crew/room/operation-skill-drafts?orgId=342', { proposalId: 8 });
  expect(screen.getByText(/does not register or activate a skill/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download SKILL.md' })).toBeTruthy();
});
