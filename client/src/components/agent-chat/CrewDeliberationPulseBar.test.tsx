import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CrewDeliberationPulseBar } from './CrewDeliberationPulseBar';

describe('CrewDeliberationPulseBar', () => {
  it('renders deliberation status with data-testid crew-thinking', () => {
    render(<CrewDeliberationPulseBar />);

    expect(screen.getByTestId('crew-thinking')).toBeInTheDocument();
    expect(screen.getByText('The crew is discussing…')).toBeInTheDocument();
  });

  it('renders participating active agent avatars and allows cancellation', () => {
    const onCancel = vi.fn();
    const mockAgents: any[] = [
      { id: 1, name: 'Ava', role: 'Architect' },
      { id: 2, name: 'Ethan', role: 'Engineer' },
    ];

    render(
      <CrewDeliberationPulseBar
        agents={mockAgents}
        activeAgentIds={[1, 2]}
        onCancel={onCancel}
      />
    );

    expect(screen.getByTitle('Ava is deliberating')).toBeInTheDocument();
    expect(screen.getByTitle('Ethan is deliberating')).toBeInTheDocument();

    const cancelBtn = screen.getByTestId('cancel-deliberation-btn');
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
