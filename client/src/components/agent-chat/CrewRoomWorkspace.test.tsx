import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CrewRoomWorkspace, roomProgress } from './CrewRoomWorkspace';

const product = { type: 'crew_work_product', documentKey: 'brief', title: 'Findings', content: 'Current finding', changeSummary: 'Added evidence' };
const props = {
  session: { status: 'active', memory: { roomBrief: { objective: 'Compare providers', successCriteria: ['Cite sources'], constraints: [] } } } as any,
  turns: [{ id: 2, speakerName: 'Analyst', artifacts: [{ payload: product }], toolsUsed: [{ name: 'lookup', ok: false, error: 'Timeout' }] }] as any,
  commitments: [], decisions: [], claims: [], issues: [], working: false,
  onSaveBrief: vi.fn(), onSaveProduct: vi.fn(), onRequest: vi.fn(),
};
describe('CrewRoomWorkspace', () => {
  it('places direction in Supervisor and deliverables and execution in Blackboard', () => {
    const view = render(<CrewRoomWorkspace {...props} placement="supervisor" />);
    expect(screen.getByText('Compare providers')).toBeTruthy();
    expect(screen.queryByLabelText('Work product version')).toBeNull();
    expect(screen.queryByText(/lookup · Failed/)).toBeNull();
    view.rerender(<CrewRoomWorkspace {...props} placement="blackboard" />);
    expect(screen.queryByText('Compare providers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit room brief' })).toBeNull();
    expect(screen.getByLabelText('Work product version')).toBeTruthy();
    expect(screen.getByText(/lookup · Failed/)).toBeTruthy();
  });
  it('distinguishes closed rooms, blockers, decisions and review from completion', () => {
    const base = { closed: false, working: false, blocked: false, decisions: false, hasProduct: true };
    expect(roomProgress(base)).toBe('Ready for review');
    expect(roomProgress({ ...base, blocked: true })).toBe('Blocked');
    expect(roomProgress({ ...base, decisions: true })).toBe('Awaiting decision');
    expect(roomProgress({ ...base, closed: true })).toBe('Closed');
  });
  it('retains old versions beyond the loaded transcript and exposes failed execution', () => {
    render(<CrewRoomWorkspace {...props} workProductTurns={[{ id: 1, speakerName: 'Analyst', artifacts: [{ payload: { ...product, content: 'Earlier finding' } }] }]} />);
    expect(screen.getByText('Compare providers')).toBeTruthy();
    expect(screen.getByText(/lookup · Failed/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Work product version'), { target: { value: '1-0' } });
    expect(screen.getByText('Earlier finding')).toBeTruthy();
  });
  it('saves a user edit as a new revision linked to its source', async () => {
    const onSaveProduct = vi.fn().mockResolvedValue(undefined);
    render(<CrewRoomWorkspace {...props} onSaveProduct={onSaveProduct} />);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Human correction' } });
    fireEvent.change(screen.getByLabelText('What changed?'), { target: { value: 'Corrected an assumption' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await waitFor(() => expect(onSaveProduct).toHaveBeenCalledWith(expect.objectContaining({ content: 'Human correction', sourceTurnId: 2, documentKey: 'brief' })));
  });
  it('keeps failed edits visible and disables changes in archived rooms', async () => {
    render(<CrewRoomWorkspace {...props} session={{ ...props.session, status: 'archived' }} />);
    expect(screen.getByRole('button', { name: /^Edit$/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Closed');
  });
});
