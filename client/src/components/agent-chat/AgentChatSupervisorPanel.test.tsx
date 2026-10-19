import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AgentChatSupervisorPanel } from './AgentChatSupervisorPanel';

afterEach(cleanup);
describe('Supervisor guidance freshness', () => {
  it('keeps older guidance accessible without presenting it as current execution status', () => {
    render(<AgentChatSupervisorPanel latestRound={4} session={{ nextSteps: 'Review attire' }} notes={[{ id: 1, noteType: 'critique', content: 'Earlier critique', round: 2 }]} />);
    expect(screen.getByText(/Saved guidance predates/)).toBeTruthy();
    expect(screen.getByText('Earlier supervisor guidance').closest('details')?.open).toBe(false);
    expect(screen.getByText('Earlier critique')).toBeTruthy();
  });
  it('leaves guidance from the latest round expanded', () => {
    render(<AgentChatSupervisorPanel latestRound={4} notes={[{ id: 1, noteType: 'critique', content: 'Current critique', round: 4 }]} />);
    expect(screen.queryByText(/Saved guidance predates/)).toBeNull();
    expect(screen.getByText('Supervisor guidance').closest('details')?.open).toBe(true);
  });
});
