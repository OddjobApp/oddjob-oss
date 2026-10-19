import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CrewTranscriptScrubber } from './CrewTranscriptScrubber';

describe('CrewTranscriptScrubber', () => {
  const mockTurns: any[] = [
    { id: 1, speakerType: 'user', speakerName: 'Developer', content: 'What is our Q3 strategy?' },
    { id: 2, speakerType: 'agent', speakerName: 'Ava', content: 'We should scale out the architecture.' },
    { id: 3, speakerType: 'agent', speakerName: 'Ethan', content: 'We need to benchmark first.' },
    { id: 4, speakerType: 'supervisor', speakerName: 'Supervisor', content: 'Let us synthesize.' },
    { id: 5, speakerType: 'agent', speakerName: 'Ava', content: 'Agreed on synthesis.' },
    { id: 6, speakerType: 'user', speakerName: 'Developer', content: 'Let us proceed.' },
  ];

  it('does not render when turn count is less than 5', () => {
    const { container } = render(<CrewTranscriptScrubber turns={mockTurns.slice(0, 3)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders navigation dots and handles turn click navigation', () => {
    const onTurnClick = vi.fn();
    render(<CrewTranscriptScrubber turns={mockTurns} onTurnClick={onTurnClick} />);

    expect(screen.getByTestId('crew-transcript-scrubber')).toBeInTheDocument();

    const turnButtons = screen.getAllByRole('button', { name: /Jump to turn/i });
    expect(turnButtons).toHaveLength(6);

    fireEvent.click(turnButtons[1]);
    expect(onTurnClick).toHaveBeenCalledWith(2);
  });

  it('displays tooltip preview on hover', () => {
    render(<CrewTranscriptScrubber turns={mockTurns} />);

    const firstTurnBtn = screen.getByRole('button', { name: /Jump to turn 1 by Developer/i });
    fireEvent.mouseEnter(firstTurnBtn);

    expect(screen.getByText('What is our Q3 strategy?')).toBeInTheDocument();
  });
});
