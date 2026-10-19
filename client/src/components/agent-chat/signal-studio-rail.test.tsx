import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));

const signal = { signalId: 'sig-1', eventType: 'port_congestion', severity: 'High', sector: 'Logistics', confidenceScore: 0.82 };

/* The pod is stubbed: these tests are about what the rail does with its selection. */
vi.mock('@/modules/signal-studio/SignalStudioPod', () => ({
  SignalStudioPod: ({ onFocusInChat }: any) => (
    <div data-testid="signal-studio-stub">
      <button onClick={() => onFocusInChat?.({ id: 'signal:sig-1', label: 'port congestion', sublabel: 'Market & Operational Signal', type: 'signal', signal }, 'Analyze it')}>Discuss signal</button>
    </div>
  ),
}));
vi.mock('@/modules/forms/FormStudioPod', () => ({ default: () => <div data-testid="form-studio-stub" /> }));
vi.mock('@/modules/apps/AppStudioPod', () => ({ default: () => <div data-testid="app-studio-stub" /> }));
vi.mock('@/modules/scribe/ScribeStudioPod', () => ({ ScribeStudioPod: () => <div data-testid="scribe-studio-stub" /> }));

import { ModularAssemblyPuzzleRail } from './ModularAssemblyPuzzleRail';
import { assemblyScopePrefix, summariseBusinessLogic, toEditableRows } from './SelectedWorkstreamContextHUD';

afterEach(cleanup);

const signalMount = (id: number) => ({
  id,
  artifacts: [{ tool: 'mount_signal_studio', payload: { type: 'signal_studio_pod', module: 'SignalStudioPod', title: 'Signal Studio' } }],
});

function renderRail(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModularAssemblyPuzzleRail turns={[]} {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe('Signal Studio selection in the rail', () => {
  it('passes the event fields through, so the next message names the signal', () => {
    const onSelectionChange = vi.fn();
    renderRail({ turns: [signalMount(1)], onSelectionChange });
    fireEvent.click(screen.getByText('Discuss signal'));

    expect(onSelectionChange).toHaveBeenCalledWith(
      { id: 'signal:sig-1', label: 'port congestion', sublabel: 'Market & Operational Signal', type: 'signal', signal },
      'Analyze it',
    );
    const unit = onSelectionChange.mock.calls[0][0];
    // Before, this fell through to the generic "[Applies to the signal of ...]".
    expect(assemblyScopePrefix(unit)).toBe(`[Signal Studio selection: ${JSON.stringify(signal)}]`);
    expect(summariseBusinessLogic(unit)).toBe('Discussing the signal "port congestion" from Signal Studio. Your next message includes its fields.');
  });

  it('shows the fields it has, read-only, and nothing it lacks', () => {
    const rows = toEditableRows({ id: 'signal:sig-1', label: 'port congestion', type: 'signal', signal });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Event type', 'port_congestion'],
      ['Severity', 'High'],
      ['Sector', 'Logistics'],
      ['Confidence', '82%'],
    ]);
    expect(rows.every((r) => r.readOnly)).toBe(true);
  });

  it('keeps the generic prefix for a signal selection with no event behind it', () => {
    expect(assemblyScopePrefix({ id: 'signal:x', label: 'x', sublabel: 'Signal', type: 'signal' })).toMatch(/^\[Applies to the /);
  });
});
