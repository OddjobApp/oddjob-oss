/**
 * Tests for the Detect → Decide → Act spine.
 *
 * The rail replaced three overlapping navigations, so what matters is that it
 * behaves as the one navigation: exactly one selected stage, reachable by
 * keyboard as `tablist` semantics promise, and honest about a stage that
 * cannot do useful work yet — the previous design showed dead controls instead.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageRail, STAGE_ORDER, type StageId, type StageState } from './StageRail';

afterEach(cleanup);

const READY: Record<StageId, StageState> = {
  detect: { hint: '3 signals' },
  decide: { hint: 'Pick one' },
  act: { hint: '2 rules active' },
};

function renderRail(
  active: StageId = 'detect',
  states: Record<StageId, StageState> = READY,
  onChange = vi.fn()
) {
  const view = render(
    <StageRail activeStage={active} onStageChange={onChange} states={states} />
  );
  return { ...view, onChange };
}

describe('structure', () => {
  it('renders the three stages in order', () => {
    renderRail();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('data-testid'))).toEqual([
      'stage-tab-detect',
      'stage-tab-decide',
      'stage-tab-act',
    ]);
    expect(STAGE_ORDER).toEqual(['detect', 'decide', 'act']);
  });

  it('marks exactly one stage selected', () => {
    renderRail('decide');
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute('data-testid', 'stage-tab-decide');
  });

  it('surfaces each stage hint', () => {
    renderRail();
    expect(screen.getByText('3 signals')).toBeInTheDocument();
    expect(screen.getByText('2 rules active')).toBeInTheDocument();
  });

  it('exposes a blocked stage without disabling it', async () => {
    // Looking ahead is legitimate; the stage explains itself rather than
    // becoming unreachable.
    const onChange = vi.fn();
    renderRail('detect', { ...READY, act: { hint: 'Needs a signal', blocked: true } }, onChange);

    const act = screen.getByTestId('stage-tab-act');
    expect(act).toHaveAttribute('data-blocked', 'true');
    expect(act).not.toBeDisabled();

    await userEvent.click(act);
    expect(onChange).toHaveBeenCalledWith('act');
  });
});

describe('navigation', () => {
  it('reports the clicked stage', async () => {
    const { onChange } = renderRail('detect');
    await userEvent.click(screen.getByTestId('stage-tab-act'));
    expect(onChange).toHaveBeenCalledWith('act');
  });

  it('moves with arrow keys and wraps at both ends', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StageRail activeStage="detect" onStageChange={onChange} states={READY} />
    );

    screen.getByTestId('stage-tab-detect').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('decide');

    // Wrapping backwards from the first stage reaches the last.
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('act');

    rerender(<StageRail activeStage="act" onStageChange={onChange} states={READY} />);
    screen.getByTestId('stage-tab-act').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('detect');
  });

  it('jumps to the ends with Home and End', async () => {
    const onChange = vi.fn();
    render(<StageRail activeStage="decide" onStageChange={onChange} states={READY} />);

    screen.getByTestId('stage-tab-decide').focus();
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('detect');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('act');
  });

  it('keeps only the active tab in the tab order', () => {
    // Roving tabindex: one stop for the whole rail, then arrows within it.
    renderRail('decide');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getByTestId('stage-tab-decide')).toHaveAttribute('tabindex', '0');
  });

  it('points each tab at its panel', () => {
    renderRail();
    for (const stage of STAGE_ORDER) {
      expect(screen.getByTestId(`stage-tab-${stage}`)).toHaveAttribute(
        'aria-controls',
        `stage-panel-${stage}`
      );
    }
  });
});
