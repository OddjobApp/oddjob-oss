import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CrewSurfaceRequestCard } from './CrewSurfaceRequestCard';
import { surfaceRequestSchema } from '@shared/crew-surface-request';
import { apiRequest } from '@/lib/queryClient';
vi.mock('./InlineApprovalCard', () => ({ InlineApprovalCard: () => <div>Governed approval</div> }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn(() => Promise.reject(new Error('Forbidden'))) }));
const request = surfaceRequestSchema.parse({ source: 'crew-surface-request', version: 1, roomKey: 'r', requestId: 'x', kind: 'question', title: 'Requirement?', fields: [{ key: 'answer', label: 'Answer', required: true }] });
it('requires valid answers before returning them to the originating surface', () => {
  const finish = vi.fn();
  render(<CrewSurfaceRequestCard pending={{ request, appTitle: 'SDLC', finish }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Return answers' }));
  expect(finish).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer *' }), { target: { value: 'Draft only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Return answers' }));
  expect(finish).toHaveBeenCalledWith('submitted', { answer: 'Draft only' });
});
it('does not render approval controls or return a decision when access fails', async () => {
  const finish = vi.fn();
  const approval = surfaceRequestSchema.parse({ source: 'crew-surface-request', version: 1, roomKey: 'r', requestId: 'a', kind: 'approval', title: 'Untrusted title', approvalId: 42 });
  render(<CrewSurfaceRequestCard pending={{ request: approval, appTitle: 'SDLC', finish, approvalUrl: '/guarded' }} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unavailable'));
  expect(screen.queryByText('Governed approval')).toBeNull();
  expect(finish).not.toHaveBeenCalled();
});
it('returns an already-recorded decision without another approval action', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ json: async () => ({ status: 'approved', proposalId: 42 }) } as Response);
  const finish = vi.fn();
  const approval = surfaceRequestSchema.parse({ source: 'crew-surface-request', version: 1, roomKey: 'r', requestId: 'a', kind: 'approval', title: 'Proposal', approvalId: 42 });
  render(<CrewSurfaceRequestCard pending={{ request: approval, appTitle: 'SDLC', finish, approvalUrl: '/guarded' }} />);
  await waitFor(() => expect(finish).toHaveBeenCalledWith('submitted', { approvalId: 42, decision: 'approved' }));
});
