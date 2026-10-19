import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
import { CrewOperationSkillReview } from './CrewOperationSkillReview';
import type { CrewOperationSkillDraft } from '@shared/crew-operation-skill';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('requires separate validation, submission and approval actions', async () => {
  const draft = { name: 'Email to calendar', evidenceHash: 'a'.repeat(64), inputs: { messageIds: 'Fresh IDs', calendarId: 'Selected calendar', eventRequirements: 'Verified fields', timezone: 'Calendar metadata' } } as unknown as CrewOperationSkillDraft;
  let status: string | null = null;
  request.mockImplementation(async (method, url: string) => {
    if (url.includes('/submit')) status = 'pending';
    if (url.includes('/approve')) status = 'augmented';
    return { json: async () => method === 'GET' ? { draft, agents: [{ id: 1, name: 'Copilot' }], reviewStatus: status }
      : url.includes('/validate') ? { readyForReview: true, missingTools: [], checks: [], accessChecks: [], limitations: ['No provider writes were executed'] } : {} };
  });
  render(<CrewOperationSkillReview draft={draft} roomKey="room" organizationId={342} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review and register skill' }));
  await screen.findByText(/Status: Draft/);
  expect((screen.getByRole('button', { name: 'Submit for governance review' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Validate contract and access' }));
  await screen.findByText('Ready for governance review');
  expect(request.mock.calls.some(call => String(call[1]).includes('/approve'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Submit for governance review' }));
  await screen.findByText(/Status: pending/);
  expect(request.mock.calls.some(call => String(call[1]).includes('/approve'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed contract' }));
  await waitFor(() => expect(screen.getByText(/Status: augmented/)).toBeTruthy());
  expect(request.mock.calls.some(call => String(call[1]).includes('orgId=342'))).toBe(true);
});
