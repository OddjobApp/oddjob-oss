import { useState, useEffect } from 'react';
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import {
  X,
  Sliders,
  Sparkles,
  Activity,
  Clock,
  Radio,
  Webhook,
  Bot,
  Filter,
  Check,
  Zap,
  Info,
  ShieldCheck,
  Compass,
  MapPin,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { H3SpatialPalette, type SpatialRegionSelection } from './H3SpatialPalette';
import { SpatialConditionEditor } from './SpatialConditionEditor';
import type { SpatialCellGroup, SpatialCondition } from '@shared/contracts/spatial-predicates';
import { useOrgTimezone } from "@/hooks/use-org-timezone";

export interface EvaluatorConfig {
  // Field Threshold
  field?: string;
  operator?: string;
  value?: string;

  // Spatial & Geofence
  spatialRegionName?: string;
  centerLat?: number;
  centerLng?: number;
  selectedHexes?: string[];
  radiusKm?: number;
  /** Named tile sets painted on the H3 map palette. */
  cellGroups?: SpatialCellGroup[];
  /** The spatial predicate this evaluator asserts, if any. */
  spatialCondition?: SpatialCondition;

  // Semantic Judge
  model?: string;
  thesisPrompt?: string;
  minConfidence?: number;
  temperature?: number;

  // Anomaly Scorer
  zScoreCutoff?: number;
  h3Resolution?: string;
  baselineWindowDays?: number;

  // Freshness Decay
  halfLifeHours?: number;
  maxAgeHours?: number;
  decayFunction?: string;

  // Sliding Window
  windowMinutes?: number;
  minEventCount?: number;
  groupBy?: string;

  // Webhook Action
  endpointUrl?: string;
  httpMethod?: string;
  headers?: { key: string; value: string }[];
  payloadFormat?: string;

  // Response Cycle Action
  targetCycleId?: string;
  priority?: string;
  requireHIL?: boolean;
}

interface EvaluatorConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nodeType: string; // 'field_threshold' | 'semantic_judge' | 'anomaly_scorer' | 'freshness_decay' | 'sliding_window' | 'webhook' | 'response_cycle'
  nodeLabel: string;
  initialConfig?: EvaluatorConfig;
  onSave: (updatedConfig: EvaluatorConfig, updatedLabelSummary: string) => void;
  embeddedInModule?: boolean;
  onSpatialExpandChange?: (isExpanded: boolean) => void;
}

export function parseH3Resolution(val: string | number | undefined): number {
  if (typeof val === 'number') {
    return val >= 0 && val <= 15 ? val : 7;
  }
  if (!val) return 7;
  const match = String(val).match(/Res\s*(\d+)/i) || String(val).match(/^(\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (parsed >= 0 && parsed <= 15) return parsed;
  }
  return 7;
}

export function EvaluatorConfigDrawer({
  isOpen,
  onClose,
  nodeType,
  nodeLabel,
  initialConfig = {},
  onSave,
  embeddedInModule = true,
  onSpatialExpandChange,
}: EvaluatorConfigDrawerProps) {
  const panelRef = useModalBehavior<HTMLDivElement>({ isOpen, onClose });
  // Opening map centre follows the organization's configured zone.
  const orgTimeZone = useOrgTimezone();
  const [customLabel, setCustomLabel] = useState(nodeLabel);
  const isInitiallySpatial =
    nodeType === 'anomaly_scorer' ||
    initialConfig.field?.includes('spatial') ||
    initialConfig.field?.includes('h3') ||
    initialConfig.field === 'jurisdiction' ||
    nodeLabel?.toLowerCase().includes('spatial') ||
    nodeLabel?.toLowerCase().includes('h3');

  const [showSpatialPalette, setShowSpatialPalette] = useState(isInitiallySpatial);
  const [config, setConfig] = useState<EvaluatorConfig>({
    field: 'confidenceScore',
    operator: '>=',
    value: '0.8',
    model: 'gemini-1.5-pro',
    thesisPrompt: 'Evaluate whether this signal indicates a critical supply chain disruption affecting Tier 1 suppliers.',
    minConfidence: 0.85,
    temperature: 0.2,
    zScoreCutoff: 2.5,
    h3Resolution: 'Res 7 (~5km)',
    baselineWindowDays: 7,
    halfLifeHours: 6,
    maxAgeHours: 24,
    decayFunction: 'exponential',
    windowMinutes: 60,
    minEventCount: 5,
    groupBy: 'targetSector',
    endpointUrl: 'https://api.company.com/webhooks/signal-triage',
    httpMethod: 'POST',
    headers: [{ key: 'Authorization', value: 'Bearer secret_token_123' }],
    payloadFormat: 'full_primitive',
    targetCycleId: 'cycle_defense_triage_v1',
    priority: 'P1 Critical',
    requireHIL: true,
    ...initialConfig,
  });

  useEffect(() => {
    setCustomLabel(nodeLabel);
    if (isInitiallySpatial) {
      setShowSpatialPalette(true);
    }
  }, [nodeLabel, isInitiallySpatial]);

  useEffect(() => {
    onSpatialExpandChange?.(showSpatialPalette);
  }, [showSpatialPalette, onSpatialExpandChange]);

  useEffect(() => {
    if (initialConfig && Object.keys(initialConfig).length > 0) {
      setConfig((prev) => ({ ...prev, ...initialConfig }));
    }
  }, [initialConfig]);

  if (!isOpen) return null;

  const generateSummaryLabel = (): string => {
    switch (nodeType) {
      case 'field_threshold':
        return `[Filter] ${config.field} ${config.operator} ${config.value}`;
      case 'semantic_judge':
        return `[AI Logic] Semantic Judge (${config.model === 'gemini-1.5-pro' ? 'Gemini Pro' : 'Claude 3.5'}, ≥ ${config.minConfidence})`;
      case 'anomaly_scorer':
        return `[AI Logic] Anomaly Scorer (Z ≥ ${config.zScoreCutoff}, ${config.h3Resolution})`;
      case 'freshness_decay':
        return `[Temporal] Freshness Decay (Half-life ${config.halfLifeHours}h, Max ${config.maxAgeHours}h)`;
      case 'sliding_window':
        return `[Temporal] Sliding Window (${config.windowMinutes}m, ≥ ${config.minEventCount} events by ${config.groupBy})`;
      case 'webhook':
        return `[Actions] Webhook POST to ${config.endpointUrl ? new URL(config.endpointUrl).hostname : 'API'}`;
      case 'response_cycle':
        return `[Actions] Trigger Cycle: ${config.targetCycleId} (${config.priority})`;
      default:
        return nodeLabel;
    }
  };

  const handleSave = () => {
    const summary = customLabel.trim() || generateSummaryLabel();
    onSave(config, summary);
    onClose();
  };

  /**
   * Folds a map-palette selection into config, keeping the spatial condition's
   * geometry in step. The condition and the drawer's flat spatial fields are
   * two views of one selection, so they are always written together.
   */
  const applyRegionSelection = (sel: SpatialRegionSelection, setValue = false) => {
    setConfig((c) => ({
      ...c,
      spatialRegionName: sel.regionName,
      centerLat: sel.centerLat,
      centerLng: sel.centerLng,
      h3Resolution: `Res ${sel.h3Resolution} (~${sel.radiusKm}km)`,
      selectedHexes: sel.selectedHexes,
      cellGroups: sel.cellGroups,
      ...(setValue ? { value: sel.regionName } : {}),
      spatialCondition: {
        // Default to a containment test — the most common intent when someone
        // paints a region — but keep whatever the operator already configured.
        type: 'spatial',
        mode: 'topological',
        predicate: 'there',
        ...c.spatialCondition,
        geometry: {
          ...c.spatialCondition?.geometry,
          regionName: sel.regionName,
          centerLat: sel.centerLat,
          centerLng: sel.centerLng,
          h3Resolution: sel.h3Resolution,
          h3Cells: sel.selectedHexes,
          cellGroups: sel.cellGroups,
        },
      } as SpatialCondition,
    }));
    setCustomLabel(sel.summaryLabel);
    setShowSpatialPalette(false);
  };

  const spatialCondition: SpatialCondition = config.spatialCondition ?? {
    type: 'spatial',
    mode: 'topological',
    predicate: 'there',
    geometry: {
      regionName: config.spatialRegionName,
      centerLat: config.centerLat,
      centerLng: config.centerLng,
      h3Cells: config.selectedHexes,
      cellGroups: config.cellGroups,
      h3Resolution: parseH3Resolution(config.h3Resolution),
    },
  };

  /** The spatial predicate editor, shared by every evaluator that can be spatial. */
  const spatialConditionSection = (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-cyan-300">
        <Compass className="h-4 w-4" /> Spatial Condition
      </div>
      <SpatialConditionEditor
        condition={spatialCondition}
        onChange={(next) => setConfig((c) => ({ ...c, spatialCondition: next }))}
        onEditGeometry={() => setShowSpatialPalette(true)}
      />
    </div>
  );

  if (embeddedInModule) {
    return (
      <div className="w-full h-full p-6 flex flex-col justify-between overflow-y-auto bg-muted/40 animate-in fade-in duration-200">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Evaluator Settings</h3>
                <p className="text-xs text-muted-foreground">Configure parameters &amp; label</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Rule Name / Label Editor */}
          <div className="mt-4 pb-4 border-b border-border/60">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rule Display Name / Label</label>
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="e.g. Critical Defense Intrusions Rule"
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Form Content by Node Type */}
          <div className="mt-5 space-y-5">
            {/* 1. FIELD THRESHOLD */}
            {nodeType === 'field_threshold' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Target Primitive Field</label>
                  <select
                    value={config.field}
                    onChange={(e) => {
                      const val = e.target.value;
                      setConfig((c) => ({ ...c, field: val }));
                      if (val === 'jurisdiction' || val === 'spatial_drift > h3_resolution') {
                        setShowSpatialPalette(true);
                      }
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="confidenceScore">confidenceScore (0.0 - 1.0)</option>
                    <option value="severity">severity (Critical, High, Medium, Low)</option>
                    <option value="targetSector">targetSector (Defense, Finance, Tech)</option>
                    <option value="jurisdiction">jurisdiction (Spatial Region / Defense Zone)</option>
                    <option value="spatial_drift > h3_resolution">spatial_drift &gt; h3_resolution (H3 Eulerian Hex)</option>
                    <option value="event_type">eventType (Regulatory, Market, SupplyChain)</option>
                  </select>
                </div>

                {/* Spatial Map Palette Trigger Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowSpatialPalette(!showSpatialPalette)}
                    className="w-full py-2 px-3 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-semibold flex items-center justify-between transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-cyan-400" />
                      <span>{showSpatialPalette ? 'Hide H3 Map Palette' : '🗺️ Select Region in H3 Map Palette'}</span>
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-900/60 px-2 py-0.5 rounded">
                      {config.spatialRegionName ? config.spatialRegionName.slice(0, 18) + '...' : 'Interactive H3'}
                    </span>
                  </button>
                </div>

                {/* Embedded H3 Spatial Map Palette */}
                {showSpatialPalette && (
                  <div className="pt-2 animate-in fade-in duration-200">
                    <H3SpatialPalette
                      timeZone={orgTimeZone}
                      initialRegion={config.spatialRegionName || 'Pacific Maritime Hub (Port of LA / Long Beach)'}
                      initialResolution={parseH3Resolution(config.h3Resolution)}
                      initialHexes={config.selectedHexes || []}
                      initialGroups={config.cellGroups}
                      onSelectRegion={(sel: SpatialRegionSelection) => applyRegionSelection(sel, true)}
                      onClose={() => setShowSpatialPalette(false)}
                    />
                  </div>
                )}

                {/* Full spatial predicate builder — triggers, containment, flux */}
                {spatialConditionSection}

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Operator</label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {['>=', '<=', '==', 'contains', 'in', 'equals'].map((op) => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => setConfig((c) => ({ ...c, operator: op }))}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                          config.operator === op
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background hover:bg-accent'
                        )}
                      >
                        {op}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Threshold Cutoff / Target Region</label>
                  <input
                    type="text"
                    value={config.value}
                    onChange={(e) => setConfig((c) => ({ ...c, value: e.target.value }))}
                    placeholder="e.g. Pacific Maritime Hub or 0.85"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {/* 2. SEMANTIC JUDGE (AI LLM) */}
            {nodeType === 'semantic_judge' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <Sparkles className="h-4 w-4" /> AI LLM Thesis Verification Judge
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Evaluates incoming unstructured signals against a high-level thesis prompt using generative AI models.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Verification LLM Model</label>
                  <select
                    value={config.model}
                    onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Recommended - Deep Reasoning)</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra Fast Edge)</option>
                    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Complex Analysis)</option>
                    <option value="llama-3-70b">Llama 3 70B (Local On-Premises)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Thesis Prompt / Verification Criterion</label>
                  <textarea
                    rows={4}
                    value={config.thesisPrompt}
                    onChange={(e) => setConfig((c) => ({ ...c, thesisPrompt: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-xs text-foreground outline-none focus:border-primary leading-relaxed"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>Minimum Confidence Score Threshold</span>
                    <span className="text-primary font-bold">{Math.round((config.minConfidence || 0.85) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.0"
                    step="0.05"
                    value={config.minConfidence}
                    onChange={(e) => setConfig((c) => ({ ...c, minConfidence: parseFloat(e.target.value) }))}
                    className="mt-2 w-full accent-primary"
                  />
                </div>
              </div>
            )}

            {/* 3. ANOMALY SCORER (H3 EIGENVALUE) */}
            {nodeType === 'anomaly_scorer' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
                    <Activity className="h-4 w-4" /> H3 Spatial Eigenvalue Surprise Model
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Detects statistical deviation and spatial density anomalies across Eulerian H3 hexagonal tiles.
                  </p>
                </div>

                {/* Spatial Map Palette Button for Anomaly Scorer */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowSpatialPalette(!showSpatialPalette)}
                    className="w-full py-2 px-3 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-semibold flex items-center justify-between transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-cyan-400" />
                      <span>{showSpatialPalette ? 'Hide H3 Map Palette' : '🗺️ Open H3 Map Palette & Geographic Search'}</span>
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-900/60 px-2 py-0.5 rounded">
                      {config.spatialRegionName ? config.spatialRegionName.slice(0, 18) + '...' : 'Map Selector'}
                    </span>
                  </button>
                </div>

                {/* Embedded H3 Spatial Map Palette */}
                {showSpatialPalette && (
                  <div className="pt-2 animate-in fade-in duration-200">
                    <H3SpatialPalette
                      timeZone={orgTimeZone}
                      initialRegion={config.spatialRegionName || 'Pacific Maritime Hub (Port of LA / Long Beach)'}
                      initialResolution={parseH3Resolution(config.h3Resolution)}
                      initialHexes={config.selectedHexes || []}
                      initialGroups={config.cellGroups}
                      onSelectRegion={(sel: SpatialRegionSelection) => applyRegionSelection(sel)}
                      onClose={() => setShowSpatialPalette(false)}
                    />
                  </div>
                )}

                {/* Full spatial predicate builder — triggers, containment, flux */}
                {spatialConditionSection}

                <div>
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>Surprise Z-Score Cutoff</span>
                    <span className="text-cyan-400 font-bold">Z ≥ {config.zScoreCutoff}</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="4.0"
                    step="0.1"
                    value={config.zScoreCutoff}
                    onChange={(e) => setConfig((c) => ({ ...c, zScoreCutoff: parseFloat(e.target.value) }))}
                    className="mt-2 w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">H3 Eulerian Spatial Resolution</label>
                  <select
                    value={config.h3Resolution}
                    onChange={(e) => setConfig((c) => ({ ...c, h3Resolution: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="Res 6 (~36km)">Res 6 (~36km - Metropolitan Region)</option>
                    <option value="Res 7 (~5km)">Res 7 (~5km - District Level)</option>
                    <option value="Res 8 (~1km)">Res 8 (~1km - Neighborhood / Facility)</option>
                    <option value="Res 9 (~100m)">Res 9 (~100m - Precinct Precision)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Baseline Window Duration</label>
                  <select
                    value={config.baselineWindowDays}
                    onChange={(e) => setConfig((c) => ({ ...c, baselineWindowDays: parseInt(e.target.value) }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value={1}>24 Hours Rolling Baseline</option>
                    <option value={7}>7 Days Baseline</option>
                    <option value={30}>30 Days Baseline</option>
                  </select>
                </div>
              </div>
            )}

            {/* 4. FRESHNESS DECAY */}
            {nodeType === 'freshness_decay' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                    <Clock className="h-4 w-4" /> Temporal Recency Decay Weighting
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Applies mathematical decay weighting to penalize stale historical signals over time.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Exponential Decay Half-Life</label>
                  <div className="mt-1 grid grid-cols-4 gap-2">
                    {[1, 6, 12, 24].map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => setConfig((c) => ({ ...c, halfLifeHours: hours }))}
                        className={cn(
                          'rounded-md border py-2 text-xs font-semibold transition-colors',
                          config.halfLifeHours === hours
                            ? 'border-amber-400 bg-amber-400/15 text-amber-400'
                            : 'border-border bg-background hover:bg-accent'
                        )}
                      >
                        {hours}h
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>Hard Cutoff Max Signal Age</span>
                    <span className="text-amber-400 font-bold">{config.maxAgeHours} Hours</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="72"
                    step="3"
                    value={config.maxAgeHours}
                    onChange={(e) => setConfig((c) => ({ ...c, maxAgeHours: parseInt(e.target.value) }))}
                    className="mt-2 w-full accent-amber-400"
                  />
                </div>
              </div>
            )}

            {/* 5. SLIDING WINDOW */}
            {nodeType === 'sliding_window' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400">
                    <Radio className="h-4 w-4" /> Rolling Burst Event Window
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Triggers only when a cluster of similar signals occurs within a rolling window.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Window Duration</label>
                  <select
                    value={config.windowMinutes}
                    onChange={(e) => setConfig((c) => ({ ...c, windowMinutes: parseInt(e.target.value) }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value={15}>15 Minutes Rolling Window</option>
                    <option value={60}>1 Hour Rolling Window</option>
                    <option value={360}>6 Hours Rolling Window</option>
                    <option value={1440}>24 Hours Rolling Window</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>Minimum Event Burst Count</span>
                    <span className="text-indigo-400 font-bold">≥ {config.minEventCount} Events</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="20"
                    step="1"
                    value={config.minEventCount}
                    onChange={(e) => setConfig((c) => ({ ...c, minEventCount: parseInt(e.target.value) }))}
                    className="mt-2 w-full accent-indigo-400"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Grouping Dimension</label>
                  <select
                    value={config.groupBy}
                    onChange={(e) => setConfig((c) => ({ ...c, groupBy: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="targetSector">Group by Target Sector</option>
                    <option value="jurisdiction">Group by Jurisdiction</option>
                    <option value="eventType">Group by Event Type</option>
                  </select>
                </div>
              </div>
            )}

            {/* 6. WEBHOOK ACTION */}
            {nodeType === 'webhook' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-400">
                    <Webhook className="h-4 w-4" /> External HTTP Webhook Notification
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Dispatches real-time JSON event payloads to an external REST endpoint upon rule match.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Destination Webhook URL</label>
                  <input
                    type="url"
                    value={config.endpointUrl}
                    onChange={(e) => setConfig((c) => ({ ...c, endpointUrl: e.target.value }))}
                    placeholder="https://api.company.com/webhooks/signal-triage"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">HTTP Method</label>
                  <div className="mt-1 flex gap-2">
                    {['POST', 'PUT'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setConfig((c) => ({ ...c, httpMethod: m }))}
                        className={cn(
                          'rounded-md border px-4 py-1.5 text-xs font-semibold transition-colors',
                          config.httpMethod === m
                            ? 'border-purple-400 bg-purple-400/15 text-purple-400'
                            : 'border-border bg-background hover:bg-accent'
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 7. RESPONSE CYCLE ACTION */}
            {nodeType === 'response_cycle' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <Bot className="h-4 w-4" /> Governed Business Response Cycle
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Spawns an autonomous, human-governed business response cycle to coordinate organizational mitigation.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Target Response Cycle</label>
                  <select
                    value={config.targetCycleId}
                    onChange={(e) => setConfig((c) => ({ ...c, targetCycleId: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="cycle_defense_triage_v1">Defense Triage &amp; Risk Mitigation Cycle</option>
                    <option value="cycle_supply_chain_reroute">Supply Chain Rerouting &amp; Procurement</option>
                    <option value="cycle_regulatory_compliance">Regulatory Compliance &amp; Disclosure</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Priority Override</label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {['P1 Critical', 'P2 High', 'P3 Medium', 'P4 Low'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setConfig((c) => ({ ...c, priority: p }))}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                          config.priority === p
                            ? 'border-emerald-400 bg-emerald-400/15 text-emerald-400'
                            : 'border-border bg-background hover:bg-accent'
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-background/60 p-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Require HIL Approval</p>
                    <p className="text-[10px] text-muted-foreground">Human sign-off before cycle execution</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.requireHIL}
                    onChange={(e) => setConfig((c) => ({ ...c, requireHIL: e.target.checked }))}
                    className="h-4 w-4 accent-emerald-400 rounded"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Check className="h-4 w-4" /> Save Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-modal flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Evaluator configuration"
        className="w-full max-w-lg border-l border-border bg-card p-6 shadow-2xl flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="flex items-center justify-between border-b border-border/80 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Evaluator Settings</h3>
                <p className="text-xs text-muted-foreground">{nodeLabel}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border/80 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <Check className="h-4 w-4" /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
