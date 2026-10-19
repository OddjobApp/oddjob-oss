import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PredictionStudioPod } from './PredictionStudioPod';
import type { SurrogateModelItem, InferenceDataPoint, DriftMetric } from './types';

/**
 * Fixtures live here, not in the component.
 *
 * The pod used to carry these arrays itself and render them with no data
 * supplied, so a reader saw three models, a percentile fan and PSI scores that
 * described nothing. They are test data, so this is where they belong.
 */
const SURROGATES: SurrogateModelItem[] = [
  {
    id: 'surrogate-kinematic-h3',
    name: 'Coastal Trajectory Kinematic Surrogate',
    framework: 'kinematic_surrogate',
    version: 'v2.4.1',
    latencyBudgetMs: 1.8,
    driftThreshold: 0.15,
    horizonSeconds: 300,
    inputFeatures: ['h3_index', 'velocity_knots'],
    status: 'active',
    p50Accuracy: 96.4,
  },
  {
    id: 'surrogate-collision-onnx',
    name: 'Breach Proximity Estimator (ONNX)',
    framework: 'onnx',
    version: 'v3.1.0',
    latencyBudgetMs: 3.2,
    driftThreshold: 0.12,
    horizonSeconds: 600,
    inputFeatures: ['spatial_distance_m'],
    status: 'active',
    p50Accuracy: 94.8,
  },
];

const POINTS: InferenceDataPoint[] = [
  { step: 0, timestamp: '19:00', p10: 42, p50: 45, p90: 48, actual: 45 },
  { step: 1, timestamp: '19:01', p10: 44, p50: 48, p90: 53, actual: 47 },
];

const DRIFT: DriftMetric[] = [
  { featureName: 'velocity_knots', psiScore: 0.042, status: 'stable', meanShift: 0.02 },
];

const withData = () => (
  <PredictionStudioPod surrogates={SURROGATES} points={POINTS} driftMetrics={DRIFT} />
);

describe('PredictionStudioPod Component', () => {
  it('draws nothing it was not given', () => {
    // The honest default: no models, no forecast, no drift readings.
    render(<PredictionStudioPod />);

    expect(screen.getByTestId('prediction-studio-pod')).toBeInTheDocument();
    expect(screen.getByText('No model selected')).toBeInTheDocument();
    expect(screen.getByText(/No forecast yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Coastal Trajectory Kinematic Surrogate')).not.toBeInTheDocument();
  });

  it('shows an empty state on each panel rather than an empty chart', () => {
    render(<PredictionStudioPod />);

    fireEvent.click(screen.getByRole('button', { name: /Surrogates/i }));
    expect(screen.getByText(/No surrogate models yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Drift & Telemetry/i }));
    expect(screen.getByText(/No drift readings yet/i)).toBeInTheDocument();
  });

  it('renders the header and default model correctly', () => {
    render(withData());

    expect(screen.getByTestId('prediction-studio-pod')).toBeInTheDocument();
    expect(screen.getByText('Layer 1 Pod')).toBeInTheDocument();
    expect(screen.getByText('PREDICTION')).toBeInTheDocument();
    expect(screen.getByText('Coastal Trajectory Kinematic Surrogate')).toBeInTheDocument();
  });

  it('renders the four studio navigation tabs', () => {
    render(withData());

    expect(screen.getByRole('button', { name: /Inference Fan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Surrogates/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drift & Telemetry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assembler Slot/i })).toBeInTheDocument();
  });

  it('switches between tabs when clicked', () => {
    render(withData());

    // Switch to Surrogates tab
    fireEvent.click(screen.getByRole('button', { name: /Surrogates/i }));
    expect(screen.getByText(/Breach Proximity Estimator \(ONNX\)/i)).toBeInTheDocument();

    // Switch to Drift tab
    fireEvent.click(screen.getByRole('button', { name: /Drift & Telemetry/i }));
    expect(screen.getByText(/Population Stability Index \(PSI\)/i)).toBeInTheDocument();
    expect(screen.getByText('velocity_knots')).toBeInTheDocument();

    // Switch to Assembler tab
    fireEvent.click(screen.getByRole('button', { name: /Assembler Slot/i }));
    expect(screen.getByText(/Layer 1 Slot Specification/i)).toBeInTheDocument();
  });

  it('triggers onFocusInChat when Interlock Layer 1 is clicked', () => {
    const handleFocusInChat = vi.fn();
    render(
      <PredictionStudioPod
        surrogates={SURROGATES}
        points={POINTS}
        driftMetrics={DRIFT}
        onFocusInChat={handleFocusInChat}
      />,
    );

    const interlockBtn = screen.getByRole('button', { name: /Interlock Layer 1/i });
    fireEvent.click(interlockBtn);

    expect(handleFocusInChat).toHaveBeenCalledTimes(1);
    expect(handleFocusInChat).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'prediction',
        id: expect.stringContaining('prediction-'),
        label: 'Coastal Trajectory Kinematic Surrogate',
      }),
      expect.stringContaining('Incorporate prediction surrogate')
    );
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(<PredictionStudioPod onClose={handleClose} />);

    const closeBtn = screen.getByTitle('Close Prediction Studio');
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleFocusMode when maximize/minimize button is clicked', () => {
    const handleToggleFocus = vi.fn();
    render(<PredictionStudioPod onToggleFocusMode={handleToggleFocus} isFocusMode={false} />);

    const focusBtn = screen.getByTitle('Maximize Prediction Studio');
    fireEvent.click(focusBtn);

    expect(handleToggleFocus).toHaveBeenCalledTimes(1);
  });

  it('renders multi-horizon buttons and switches horizon when clicked', () => {
    render(withData());

    expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '60m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '120m' })).toBeInTheDocument();

    // Click 15m button
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    expect(screen.getByText(/Streaming Probability Fan \(15m Horizon\)/i)).toBeInTheDocument();

    // Click 60m button
    fireEvent.click(screen.getByRole('button', { name: '60m' }));
    expect(screen.getByText(/Streaming Probability Fan \(60m Horizon\)/i)).toBeInTheDocument();
  });

  it('renders environmental co-factors and risk assessment matrix', () => {
    // Supplied, not defaulted: the pod shows zeros until a caller gives it
    // conditions, because a wind speed it invented would describe nothing.
    render(
      <PredictionStudioPod
        surrogates={SURROGATES}
        points={POINTS}
        driftMetrics={DRIFT}
        environmental={{
          windSpeedKnots: 14.5,
          windDirectionDeg: 220,
          currentSpeedKnots: 2.1,
          currentDirectionDeg: 160,
          bathymetryDepthM: 8.4,
          vesselDraftM: 3.6,
        }}
      />,
    );

    expect(screen.getByText(/kn @ 220°/i)).toBeInTheDocument();
    expect(screen.getByText(/UKC 4.8m/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-Horizon Trajectory Projections/i)).toBeInTheDocument();
    expect(screen.getByText(/Safe Window/i)).toBeInTheDocument();
    expect(screen.getByText(/Grounding Risk/i)).toBeInTheDocument();
  });
});
