import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CrewHeaderBar } from './CrewHeaderBar';

describe('CREW participant header', () => {
  it('shows selected and available agent pills directly', () => {
    const onToggleAgent = vi.fn();
    const props: any = { session: { title: 'Plan the launch', memory: {} }, agents: [
      { id: 1, name: 'Copilot', personaType: 'copilot' }, { id: 2, name: 'Analyst', personaType: 'analyst' },
    ], selectedIds: [1], onToggleAgent, isLoading: false, participants: [], decisions: [], claims: [] };
    render(<CrewHeaderBar {...props} />);
    expect(screen.queryByText('Plan the launch')).toBeNull();
    expect(screen.getByTestId('crew-agent-1')).toBeVisible();
    expect(screen.getByTestId('crew-agent-2')).toBeVisible();
    fireEvent.click(screen.getByTestId('crew-agent-2'));
    expect(onToggleAgent).toHaveBeenCalledWith(2);
  });
});
