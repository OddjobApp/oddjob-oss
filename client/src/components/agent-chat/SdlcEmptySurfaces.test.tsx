import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { UnconnectedWorkbench } from '../../../../server/blueprints/apps/sdlc-workbench/app/components/UnconnectedWorkbench';
import { BranchDiffView } from '../../../../server/blueprints/apps/sdlc-workbench/app/components/BranchDiffView';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../../../server/blueprints/apps/sdlc-workbench/lib/workbench-bridge', () => ({ requestCrewInput: request }));
it('shows missing data instead of example rows and routes setup input to CREW', async () => {
  request.mockResolvedValue({ status: 'cancelled' });
  render(<UnconnectedWorkbench title="Sales Workbench" />);
  expect(screen.getByText(/No live data source/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Request setup input in CREW' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('cancelled'));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'question' }));
});
it('does not substitute sample files or offer a merge when no real diff is loaded', () => {
  render(<BranchDiffView />);
  expect(screen.getByRole('status')).toHaveTextContent('No repository diff');
  expect(screen.queryByRole('button')).toBeNull();
});
