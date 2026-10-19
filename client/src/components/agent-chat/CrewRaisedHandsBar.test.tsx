import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CrewRaisedHandsBar } from './CrewRaisedHandsBar';
describe('Contribution indicator', () => {
  it('keeps suggestions collapsed until requested without sending a message', () => {
    const onCallOnAgent = vi.fn();
    render(<CrewRaisedHandsBar raisedHands={[{ agentCardId: 2, agentName: 'Analyst', reason: 'Relevant experience' } as any]} dismissedHands={new Set()} setDismissedHands={vi.fn()} isSending={false} onCallOnAgent={onCallOnAgent} pendingAttestation={null} />);
    expect(screen.getByText('Analyst')).not.toBeVisible();
    fireEvent.click(screen.getByText('1 agent ready to contribute'));
    expect(screen.getByText('Analyst')).toBeVisible();
    expect(onCallOnAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Analyst'));
    expect(onCallOnAgent).toHaveBeenCalledWith('Analyst');
  });
});
