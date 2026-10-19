import type { ForecastHorizon, EnvironmentalCoFactors, MultiHorizonPoint } from '@shared/prediction-studio-crew';

export interface PredictionStudioPodProps {
  /**
   * The models, forecast points and drift readings to show.
   *
   * All optional and all empty by default. This pod used to carry its own
   * fixtures -- three surrogates with accuracy figures, four horizons of
   * percentile points, PSI scores, and a tick that moved the forecast with
   * Math.random() -- which read as live telemetry and was not. A number a person
   * reads as a measurement comes from here or is not drawn at all.
   */
  surrogates?: SurrogateModelItem[];
  points?: InferenceDataPoint[];
  driftMetrics?: DriftMetric[];
  modelId?: string;
  modelName?: string;
  streamId?: string;
  activeHorizon?: ForecastHorizon;
  environmental?: EnvironmentalCoFactors;
  organizationId?: number | null;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onPopOut?: () => void;
  onFocusInChat?: (
    selection: { id: string; label: string; sublabel?: string; type: string },
    promptSuggestion?: string
  ) => void;
  className?: string;
}

export interface SurrogateModelItem {
  id: string;
  name: string;
  framework: "onnx" | "pytorch" | "lightgbm" | "python_script" | "kinematic_surrogate";
  version: string;
  latencyBudgetMs: number;
  driftThreshold: number;
  horizonSeconds: number;
  inputFeatures: string[];
  status: "active" | "training" | "offline" | "calibrating";
  p50Accuracy: number;
}

export interface InferenceDataPoint {
  step: number;
  timestamp: string;
  p10: number;
  p50: number;
  p90: number;
  actual?: number;
  isBreach?: boolean;
}

export interface DriftMetric {
  featureName: string;
  psiScore: number;
  status: "stable" | "warning" | "drifted";
  meanShift: number;
}
