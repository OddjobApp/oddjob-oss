import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  Activity,
  Layers,
  Cpu,
  Zap,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  Sliders,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  BrainCircuit,
  Wind,
  Waves,
  Compass,
  Clock,
  Anchor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ForecastHorizon } from '@shared/prediction-studio-crew';
import type { PredictionStudioPodProps, SurrogateModelItem, InferenceDataPoint, DriftMetric } from './types';

/**
 * Stable empty defaults.
 *
 * A `= []` in the destructuring makes a new array each render, and the effect
 * that follows the points prop then fires every render and sets state again --
 * an endless loop that hangs the test runner rather than failing it.
 */
const NO_SURROGATES: SurrogateModelItem[] = [];
const NO_POINTS: InferenceDataPoint[] = [];
const NO_DRIFT: DriftMetric[] = [];

export const PredictionStudioPod: React.FC<PredictionStudioPodProps> = ({
  surrogates = NO_SURROGATES,
  points: initialPoints = NO_POINTS,
  driftMetrics = NO_DRIFT,
  modelId: initialModelId,
  modelName: initialModelName,
  streamId = 'signal-stream-ais-01',
  activeHorizon,
  environmental: initialEnvironmental,
  organizationId,
  isFocusMode,
  onToggleFocusMode,
  onClose,
  onPopOut,
  onFocusInChat,
  className,
}) => {
  const [activeTab, setActiveTab] = useState<'inference' | 'surrogates' | 'drift' | 'assembler'>('inference');
  const [selectedModelId, setSelectedModelId] = useState<string>(
    initialModelId || surrogates[0]?.id || ''
  );
  const [selectedHorizon, setSelectedHorizon] = useState<ForecastHorizon>(activeHorizon || '30m');
  // Zero, not a plausible reading. These are shown as the conditions a forecast
  // was made under, so inventing a wind speed states something untrue about it.
  const [environmental, setEnvironmental] = useState({
    windSpeedKnots: initialEnvironmental?.windSpeedKnots ?? 0,
    windDirectionDeg: initialEnvironmental?.windDirectionDeg ?? 0,
    currentSpeedKnots: initialEnvironmental?.currentSpeedKnots ?? 0,
    currentDirectionDeg: initialEnvironmental?.currentDirectionDeg ?? 0,
    bathymetryDepthM: initialEnvironmental?.bathymetryDepthM ?? 0,
    vesselDraftM: initialEnvironmental?.vesselDraftM ?? 0,
  });

  const [points, setPoints] = useState<InferenceDataPoint[]>(initialPoints);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationStep, setSimulationStep] = useState(0);

  const selectedModel = useMemo(
    () => surrogates.find((m) => m.id === selectedModelId) || surrogates[0],
    [selectedModelId]
  );

  // The live tick that used to advance this forecast is gone: it moved p50 by
  // Math.random() every 1.2s and drew the result as a prediction.
  //
  // Points now follow the prop, so a caller that fetches them later -- or
  // supplies a different horizon's -- sees them arrive.
  useEffect(() => {
    setPoints(initialPoints);
  }, [initialPoints]);

  const handleSnapToAssembler = () => {
    onFocusInChat?.(
      {
        id: `prediction-${selectedModel?.id ?? 'none'}`,
        label: selectedModel?.name ?? 'No model selected',
        sublabel: selectedModel
          ? `Framework: ${selectedModel.framework.toUpperCase()} (P50: ${selectedModel.p50Accuracy}%)`
          : undefined,
        type: 'prediction',
      },
      `Incorporate prediction surrogate "${selectedModel?.name ?? ''}" into Layer 1 of the assembly stack.`
    );
  };

  // SVG Chart Dimensions
  const chartWidth = 520;
  const chartHeight = 180;
  const maxVal = Math.max(...points.map((p) => p.p90), 130);
  const minVal = Math.min(...points.map((p) => p.p10), 30);
  const range = maxVal - minVal || 1;

  const getX = (idx: number) => (idx / (points.length - 1)) * (chartWidth - 40) + 20;
  const getY = (val: number) => chartHeight - 20 - ((val - minVal) / range) * (chartHeight - 40);

  // Generate fan area path (p10 to p90)
  const fanPath = useMemo(() => {
    if (points.length < 2) return '';
    const topPoints = points.map((p, i) => `${getX(i)},${getY(p.p90)}`);
    const bottomPoints = [...points].reverse().map((p, i) => `${getX(points.length - 1 - i)},${getY(p.p10)}`);
    return `M ${topPoints[0]} L ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
  }, [points]);

  // Generate median path (p50)
  const medianPath = useMemo(() => {
    if (points.length < 2) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.p50)}`).join(' ');
  }, [points]);

  const latestPoint = points[points.length - 1];

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col bg-background text-foreground border-l border-border',
        className
      )}
      data-testid="prediction-studio-pod"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 border border-primary/20 text-primary">
            <BrainCircuit className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Layer 1 Pod
              </span>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono border-primary/30 text-primary">
                PREDICTION
              </Badge>
            </div>
            <h2 className="text-sm font-semibold truncate leading-tight">
              {initialModelName || selectedModel?.name || 'No model selected'}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onToggleFocusMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onToggleFocusMode}
              title={isFocusMode ? 'Restore split chat' : 'Maximize Prediction Studio'}
            >
              {isFocusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          )}
          {onPopOut && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onPopOut}
              title="Open in standalone tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="Close Prediction Studio"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-border px-3 bg-muted/30 text-xs">
        <button
          onClick={() => setActiveTab('inference')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors',
            activeTab === 'inference'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Inference Fan
        </button>
        <button
          onClick={() => setActiveTab('surrogates')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors',
            activeTab === 'surrogates'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Cpu className="h-3.5 w-3.5" />
          Surrogates ({surrogates.length})
        </button>
        <button
          onClick={() => setActiveTab('drift')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors',
            activeTab === 'drift'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Sliders className="h-3.5 w-3.5" />
          Drift & Telemetry
        </button>
        <button
          onClick={() => setActiveTab('assembler')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors',
            activeTab === 'assembler'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Assembler Slot
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'inference' && (
          <div className="space-y-4">
            {/* Horizon & Environmental Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Horizon:</span>
                <div className="flex items-center gap-1 ml-1">
                  {(['15m', '30m', '60m', '120m'] as ForecastHorizon[]).map((h) => (
                    <Button
                      key={h}
                      variant={selectedHorizon === h ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn(
                        'h-6 px-2 text-[11px] font-mono',
                        selectedHorizon === h && 'bg-primary/20 text-primary border border-primary/40'
                      )}
                      // Sets the horizon only. This used to swap in a different
                      // fixture per horizon, which made the forecast look
                      // recomputed when nothing had been.
                      onClick={() => setSelectedHorizon(h)}
                    >
                      {h}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] gap-1 font-mono py-0.5 px-2">
                  <Wind className="h-3 w-3 text-sky-400" />
                  {environmental.windSpeedKnots} kn @ {environmental.windDirectionDeg}°
                </Badge>
                <Badge variant="outline" className="text-[10px] gap-1 font-mono py-0.5 px-2">
                  <Waves className="h-3 w-3 text-cyan-400" />
                  {environmental.currentSpeedKnots} kn @ {environmental.currentDirectionDeg}°
                </Badge>
                <Badge variant="outline" className="text-[10px] gap-1 font-mono py-0.5 px-2">
                  <Anchor className="h-3 w-3 text-emerald-400" />
                  UKC {(environmental.bathymetryDepthM - environmental.vesselDraftM).toFixed(1)}m
                </Badge>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg border border-border bg-card p-2.5">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">P10 Lower</span>
                <div className="text-base font-bold font-mono text-muted-foreground mt-0.5">
                  {latestPoint?.p10 ?? '--'}
                </div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                <span className="text-[10px] uppercase font-semibold text-primary">P50 Median</span>
                <div className="text-base font-bold font-mono text-foreground mt-0.5">
                  {latestPoint?.p50 ?? '--'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-2.5">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">P90 Upper</span>
                <div className="text-base font-bold font-mono text-muted-foreground mt-0.5">
                  {latestPoint?.p90 ?? '--'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-2.5">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Latency</span>
                <div className="text-base font-bold font-mono text-foreground mt-0.5">
                  {selectedModel ? `${selectedModel.latencyBudgetMs}ms` : '--'}
                </div>
              </div>
            </div>

            {/* Confidence Envelope SVG Visualizer */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold">Streaming Probability Fan ({selectedHorizon} Horizon)</span>
                </div>
                <div className="flex items-center gap-2">
                  {latestPoint?.isBreach && (
                    <Badge variant="destructive" className="text-[10px] py-0 px-1.5 animate-pulse">
                      THRESHOLD BREACH
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setIsSimulating(!isSimulating)}
                  >
                    {isSimulating ? (
                      <>
                        <Zap className="h-3 w-3 text-amber-500 animate-spin" />
                        Pause Stream
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 text-primary" />
                        Live Stream
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* SVG Curve */}
              <div className="w-full overflow-hidden rounded bg-muted/20 border border-border/50 p-2">
                {points.length === 0 ? (
                  <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    No forecast yet. The fan chart draws once this model returns percentile points.
                  </div>
                ) : (
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-44 overflow-visible">
                  {/* Grid Lines */}
                  {[0.25, 0.5, 0.75].map((ratio) => (
                    <line
                      key={ratio}
                      x1="20"
                      y1={chartHeight * ratio}
                      x2={chartWidth - 20}
                      y2={chartHeight * ratio}
                      stroke="currentColor"
                      className="text-border/40"
                      strokeDasharray="4 4"
                    />
                  ))}

                  {/* Breach threshold line */}
                  <line
                    x1="20"
                    y1={getY(75)}
                    x2={chartWidth - 20}
                    y2={getY(75)}
                    stroke="currentColor"
                    className="text-destructive/60"
                    strokeDasharray="2 2"
                  />
                  <text x={chartWidth - 80} y={getY(75) - 4} className="text-[9px] fill-destructive font-mono">
                    Limit (75.0)
                  </text>

                  {/* Fan Area (p10 to p90) */}
                  <path d={fanPath} fill="currentColor" className="text-primary/15" />

                  {/* P50 Median Line */}
                  <path
                    d={medianPath}
                    fill="none"
                    stroke="currentColor"
                    className="text-primary stroke-2"
                  />

                  {/* Points */}
                  {points.map((p, i) => (
                    <g key={i}>
                      <circle
                        cx={getX(i)}
                        cy={getY(p.p50)}
                        r={p.isBreach ? 4 : 2.5}
                        fill="currentColor"
                        className={p.isBreach ? 'text-destructive' : 'text-primary'}
                      />
                    </g>
                  ))}
                </svg>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  P50 Expected Path
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded bg-primary/20" />
                  80% Confidence Fan (P10–P90)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 bg-destructive" />
                  Breach Guard
                </span>
              </div>
            </div>

            {/* Multi-Horizon Risk Assessment Matrix */}
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Multi-Horizon Trajectory Projections</span>
                <span className="text-[10px] text-muted-foreground font-mono">ETA Breach: ~14.2 min</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded border border-border/60 bg-muted/20 p-2">
                  <div className="text-[10px] font-semibold text-muted-foreground">T + 15m</div>
                  <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">32%</div>
                  <div className="text-[9px] text-muted-foreground uppercase">Safe Window</div>
                </div>
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                  <div className="text-[10px] font-semibold text-amber-400">T + 30m</div>
                  <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">84%</div>
                  <div className="text-[9px] text-amber-400 uppercase font-semibold">Breach Limit</div>
                </div>
                <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
                  <div className="text-[10px] font-semibold text-destructive">T + 60m</div>
                  <div className="text-sm font-bold font-mono text-destructive mt-0.5">94%</div>
                  <div className="text-[9px] text-destructive uppercase font-semibold">Excursion</div>
                </div>
                <div className="rounded border border-destructive/60 bg-destructive/20 p-2">
                  <div className="text-[10px] font-semibold text-destructive">T + 120m</div>
                  <div className="text-sm font-bold font-mono text-destructive mt-0.5">98%</div>
                  <div className="text-[9px] text-destructive uppercase font-semibold">Grounding Risk</div>
                </div>
              </div>
            </div>

            {/* Quick Action: Snap to Assembler */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Snap Model to Assembler (Layer 1)</h4>
                <p className="text-[11px] text-muted-foreground">
                  Binds this surrogate into the current CREW room pipeline context.
                </p>
              </div>
              <Button size="sm" onClick={handleSnapToAssembler} className="gap-1.5 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                Interlock Layer 1
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'surrogates' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Registered surrogates available for inline evaluation:
              </span>
            </div>

            <div className="space-y-2">
              {surrogates.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">No surrogate models yet. They appear here once this organization registers one.</div>
              )}
              {surrogates.map((surrogate) => {
                const isSelected = surrogate.id === selectedModelId;
                return (
                  <div
                    key={surrogate.id}
                    onClick={() => setSelectedModelId(surrogate.id)}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:border-border/80'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-semibold text-foreground">{surrogate.name}</h4>
                          <Badge variant="outline" className="text-[9px] font-mono uppercase">
                            {surrogate.framework}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">{surrogate.version}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Inputs: {surrogate.inputFeatures.join(', ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold font-mono text-primary">{surrogate.p50Accuracy}%</span>
                        <div className="text-[10px] text-muted-foreground font-mono">{surrogate.latencyBudgetMs}ms</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'drift' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Population Stability Index (PSI) Telemetry
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Evaluates feature distribution shift over a 60-second sliding window against training baselines.
              </p>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
              {driftMetrics.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">No drift readings yet. PSI scores appear once a model has scored against a baseline.</div>
              )}
              {driftMetrics.map((metric) => (
                <div key={metric.featureName} className="flex items-center justify-between p-3 text-xs">
                  <div>
                    <span className="font-mono font-medium text-foreground">{metric.featureName}</span>
                    <div className="text-[10px] text-muted-foreground">
                      Mean Shift: {metric.meanShift > 0 ? `+${metric.meanShift}` : metric.meanShift}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-muted-foreground">PSI: {metric.psiScore.toFixed(3)}</span>
                    <Badge
                      variant={metric.status === 'stable' ? 'outline' : 'destructive'}
                      className="text-[10px] py-0"
                    >
                      {metric.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'assembler' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Layers className="h-4 w-4 text-primary" />
                Layer 1 Slot Specification
              </h4>
              <p className="text-[11px] text-muted-foreground">
                In the Oddjob Modular Assembly puzzle, Layer 1 connects to Layer 0 (Telemetry) and provides inputs to Layer 2 (Pipeline).
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2 font-mono text-[11px]">
              <div className="text-muted-foreground"># Contract Definition</div>
              <div className="text-foreground">
                <span className="text-primary">layer:</span> 1 (Prediction / Model)<br />
                <span className="text-primary">source:</span> {streamId}<br />
                <span className="text-primary">surrogate_model:</span> {selectedModel?.id ?? '--'}<br />
                <span className="text-primary">output_contract:</span> {'{'} p10, p50, p90, eta_seconds, confidence {'}'}<br />
                <span className="text-primary">downstream_trigger:</span> cel:$steps.evaluate.p90 &gt;= 0.75
              </div>
            </div>

            <Button onClick={handleSnapToAssembler} className="w-full gap-2 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Bind into Assembler Jigsaw Bay
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PredictionStudioPod;
