import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CrewComposer } from './CrewComposer';

describe('CrewComposer Slash Commands', () => {
  const agents = [
    { id: 1, name: 'Architect', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true },
  ];

  it('displays slash command popover when typing "/"', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/' } });

    expect(screen.getByTestId('crew-slash-command-popover')).toBeInTheDocument();
    expect(screen.getByTestId('crew-slash-option-teach')).toBeInTheDocument();
    expect(screen.getByTestId('crew-slash-option-studio')).toBeInTheDocument();
  });

  it('selects /teach command from popover on click', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/' } });

    fireEvent.click(screen.getByTestId('crew-slash-option-teach'));
    expect(textarea).toHaveValue('/teach ');
  });

  it('triggers task demonstration on /teach submit', () => {
    const onSend = vi.fn();
    const eventSpy = vi.fn();
    window.addEventListener('oddjob:open-teach-task', eventSpy);

    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/teach Download quarterly tax report' } });
    fireEvent.click(screen.getByTestId('crew-send'));

    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining('Download quarterly tax report')
    );
    expect(eventSpy).toHaveBeenCalled();
  });

  it('displays /present and /app in slash command popover', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/' } });

    expect(screen.getByTestId('crew-slash-option-present')).toBeInTheDocument();
    expect(screen.getByTestId('crew-slash-option-app')).toBeInTheDocument();
    expect(screen.getByTestId('crew-slash-option-doc')).toBeInTheDocument();
    expect(screen.getByTestId('crew-slash-option-diagram')).toBeInTheDocument();
  });

  it('extracts /present slash command and attaches outputIntent: present on submit', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/present Q3 Incident Postmortem Review' } });
    fireEvent.click(screen.getByTestId('crew-send'));

    expect(onSend).toHaveBeenCalledWith(
      'Q3 Incident Postmortem Review',
      { outputIntent: 'present' }
    );
  });

  it('extracts /app slash command and attaches outputIntent: build_app on submit', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: '/app mortgage calculator with loan tape' } });
    fireEvent.click(screen.getByTestId('crew-send'));

    expect(onSend).toHaveBeenCalledWith(
      'mortgage calculator with loan tape',
      { outputIntent: 'build_app' }
    );
  });

  it('allows selecting output intent from mode dropdown and includes it in submission', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    // Open dropdown
    const trigger = screen.getByTestId('crew-output-intent-trigger');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    // Select presentation deck
    const option = screen.getByTestId('crew-intent-option-present');
    fireEvent.click(option);

    // Verify active mode pill appears
    expect(screen.getByTestId('crew-active-intent-pill')).toHaveTextContent('Presentation Deck & Deliverable');

    // Type regular message
    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: 'Summarize the meeting key takeaways' } });
    fireEvent.click(screen.getByTestId('crew-send'));

    expect(onSend).toHaveBeenCalledWith(
      'Summarize the meeting key takeaways',
      { outputIntent: 'present' }
    );
  });

  it('clears active output intent when clear button is clicked', () => {
    const onSend = vi.fn();
    render(<CrewComposer onSend={onSend} disabled={false} memberCount={1} agents={agents as any} />);

    // Open dropdown and select diagram
    const trigger = screen.getByTestId('crew-output-intent-trigger');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(screen.getByTestId('crew-intent-option-diagram'));

    expect(screen.getByTestId('crew-active-intent-pill')).toHaveTextContent('Workflow Diagram / X-Ray');

    // Clear intent
    fireEvent.click(screen.getByTestId('crew-clear-output-intent'));

    expect(screen.queryByTestId('crew-active-intent-pill')).not.toBeInTheDocument();

    // Type message and submit
    const textarea = screen.getByTestId('crew-composer');
    fireEvent.change(textarea, { target: { value: 'Regular question' } });
    fireEvent.click(screen.getByTestId('crew-send'));

    expect(onSend).toHaveBeenCalledWith('Regular question', undefined);
  });

  describe('Busy Indicator & Text Entry Blocking State', () => {
    it('allows successive queued submissions while keeping cancellation available', () => {
      const onSend = vi.fn();
      const onCancel = vi.fn();
      render(<CrewComposer onSend={onSend} onCancel={onCancel} disabled={false} isBusy allowQueue memberCount={1} agents={agents as any} />);
      const input = screen.getByTestId('crew-composer');
      expect(input).not.toBeDisabled();
      fireEvent.change(input, { target: { value: 'First follow-up' } });
      fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
      fireEvent.change(input, { target: { value: 'Second follow-up' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSend.mock.calls.map(([message]) => message)).toEqual(['First follow-up', 'Second follow-up']);
      expect(input).toHaveValue('');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });
    it('keeps response progress and cancellation without the deliberation banner', () => {
      const onSend = vi.fn();
      const onCancel = vi.fn();
      render(
        <CrewComposer
          onSend={onSend}
          disabled={true}
          isBusy={true}
          onCancel={onCancel}
          memberCount={2}
          agents={agents as any}
        />
      );

      // Verify busy indicator banner
      expect(screen.queryByTestId('crew-composer-busy-indicator')).not.toBeInTheDocument();


      // Verify progress pulse line
      expect(screen.getByTestId('crew-composer-busy-progress')).toBeInTheDocument();

      // Verify textarea placeholder indicates paused entry
      const textarea = screen.getByTestId('crew-composer');
      expect(textarea).toBeDisabled();
      expect(textarea).toHaveAttribute('placeholder', 'Agents are responding…');

      // Verify cancel link in banner works
      const cancelLink = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelLink);
      expect(onCancel).toHaveBeenCalled();
    });

    it('infers isBusy when disabled is true and onCancel is provided', () => {
      const onSend = vi.fn();
      const onCancel = vi.fn();
      render(
        <CrewComposer
          onSend={onSend}
          disabled={true}
          onCancel={onCancel}
          memberCount={2}
          agents={agents as any}
        />
      );

      expect(screen.queryByTestId('crew-composer-busy-indicator')).not.toBeInTheDocument();
    });

    it('does not display busy indicator when disabled is false', () => {
      const onSend = vi.fn();
      render(
        <CrewComposer
          onSend={onSend}
          disabled={false}
          memberCount={2}
          agents={agents as any}
        />
      );

      expect(screen.queryByTestId('crew-composer-busy-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('crew-composer-busy-progress')).not.toBeInTheDocument();
    });
  });
});
