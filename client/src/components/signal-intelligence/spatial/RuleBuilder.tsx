import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GripVertical,
  Plus,
  Trash2,
  SlidersHorizontal,
  Shield,
  Clock,
  Sparkles,
  Webhook,
  Search,
  Maximize2,
  Minimize2,
  Check,
  Bot,
  Play,
  Save,
  Filter,
  Activity,
  Zap,
  Wand2,
  Send,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Pencil,
  Compass,
  MapPin,
  ChevronLeft,
  ChevronRight,
  MoveHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import type { IntelligenceSignal } from './utils';
import { EvaluatorConfigDrawer, type EvaluatorConfig } from './EvaluatorConfigDrawer';
import { H3SpatialPalette, type SpatialRegionSelection } from './H3SpatialPalette';
import { buildRuleSpecification, slugifyRuleId } from './rule-tree-to-spec';
import { createEmptyRuleTree, createRescueDispatchGeoRuleTree } from './rule-builder-state';
import { useOrgTimezone } from "@/hooks/use-org-timezone";

/** Suite every rule authored in this builder is written into. */
const RULE_SUITE_ID = 'signal-routing-triage';
const RULE_DEPLOY_TIMEOUT_MS = 15_000;

export interface ConditionRule {
  id: string;
  type: 'condition';
  field: string;
  operator: string;
  value: string;
  label?: string;
  evaluatorType?: string;
  config?: EvaluatorConfig;
}

export interface ConditionGroup {
  id: string;
  type: 'group';
  logic: 'AND' | 'OR';
  children: Array<ConditionRule | ConditionGroup>;
}

export interface RuleBuilderProps {
  /**
   * Rendered inside a host that already provides page chrome — currently the
   * wizard's step 3.
   *
   * The builder is a standalone tool with its own title, "Native Tokenized
   * Surface" badge and Full Screen control. Stacked under the wizard's header
   * and progress rail, that produced three levels of chrome and printed
   * "Signal Routing Triage" twice on one screen. Embedded mode drops the
   * page-level furniture and keeps the working surface.
   */
  embedded?: boolean;
  selectedSignal?: IntelligenceSignal | null;
  onSaveDraft?: (rules: ConditionGroup) => void;
  onDeploy?: (rules: ConditionGroup) => void;
  initialRuleTree?: ConditionGroup;
  initialDeliveryMode?: 'context_only' | 'replan' | 'trigger' | 'gate' | 'notify';
  initialCooldownMinutes?: number;
}

const COMMON_FIELDS = [
  { value: 'targetSector', label: 'Target Sector', options: ['Defense & Maritime Security', 'Logistics & Global Trade', 'Energy & Power Infrastructure', 'Finance & Capital Markets', 'Cybersecurity & Critical Tech'] },
  { value: 'severity', label: 'Severity Level', options: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
  { value: 'confidenceScore', label: 'Confidence Score', options: ['0.95 (Ultra High)', '0.85 (High)', '0.70 (Medium)', '0.50 (Low)'] },
  { value: 'eventType', label: 'Event Type', options: ['SPATIAL_DRIFT_ALERT', 'GEOFENCE_BREACH', 'ANOMALY_DETECTION', 'SUPPLY_CHAIN_DISRUPTION', 'REGULATORY_CHANGE'] },
  { value: 'jurisdiction', label: 'Jurisdiction / Spatial Zone', options: ['Pacific Maritime Hub', 'Northwest Defense Corridor', 'EU Trade Zone', 'Global Operations'] },
  { value: 'spatial_drift > h3_resolution', label: 'Spatial H3 Hex Resolution', options: ['Res 6 (~36km)', 'Res 7 (~5.1km)', 'Res 8 (~1.0km)', 'Res 9 (~170m)'] },
  { value: 'riskClass', label: 'Risk Class / Operational Tag', options: ['Tier 1 Supply Chain', 'High-Risk Asset', 'Autonomous Intercept', 'Critical Infrastructure'] },
];

export function RuleBuilder({
  selectedSignal,
  onSaveDraft,
  onDeploy,
  embedded = false,
  initialRuleTree,
  initialDeliveryMode,
  initialCooldownMinutes,
}: RuleBuilderProps) {
  // Opening map centre follows the organization's configured zone.
  const orgTimeZone = useOrgTimezone();

  const isRescueDispatchContext = React.useMemo(() => {
    if (initialRuleTree && initialRuleTree.children.length > 0) return true;
    if (typeof window !== 'undefined') {
      const search = window.location.search;
      if (search.includes('lat=34.0522') || search.includes('rescue') || search.includes('8828308281fffff')) {
        return true;
      }
    }
    if (selectedSignal) {
      const titleOrRaw = `${selectedSignal.title} ${selectedSignal.event?.rawText || ''}`;
      if (
        selectedSignal.event?.h3Index === '8828308281fffff' ||
        selectedSignal.event?.subjectId === 'AST-8842' ||
        titleOrRaw.includes('GEN-8842') ||
        titleOrRaw.includes('Commercial Generator #4') ||
        selectedSignal.event?.eventType === 'Operational_Disruption'
      ) {
        return true;
      }
    }
    return false;
  }, [selectedSignal, initialRuleTree]);

  const [deliveryMode, setDeliveryMode] = useState<'context_only' | 'replan' | 'trigger' | 'gate' | 'notify'>(() => {
    if (initialDeliveryMode) return initialDeliveryMode;
    if (isRescueDispatchContext) return 'trigger';
    return 'context_only';
  });
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(() => {
    if (initialCooldownMinutes !== undefined) return initialCooldownMinutes;
    if (isRescueDispatchContext) return 5;
    return 15;
  });
  const [activeTab, setActiveTab] = useState<'triage' | 'policy' | 'logs' | 'simulation'>('triage');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [editingLabelNodeId, setEditingLabelNodeId] = useState<string | null>(null);
  const [inlineLabelText, setInlineLabelText] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [showGlobalSpatialPalette, setShowGlobalSpatialPalette] = useState(false);
  const [isSpatialDrawerExpanded, setIsSpatialDrawerExpanded] = useState(false);
  const [customTrayWidth, setCustomTrayWidth] = useState<number | null>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [draftSaved, setDraftSaved] = useState(false);

  // ─── Simulation & Backtest State ──────────────────────────────────────────
  const [sampleEventData, setSampleEventData] = useState({
    eventType: selectedSignal?.event?.eventType || 'SPATIAL_DRIFT_ALERT',
    targetSector: selectedSignal?.event?.targetSector || 'Defense & Maritime Security',
    jurisdiction: selectedSignal?.event?.jurisdiction || 'Pacific Maritime Hub',
    severity: selectedSignal?.event?.severity || 'HIGH',
    confidenceScore: selectedSignal?.score ? selectedSignal.score / 100 : 0.85,
    rawText: selectedSignal?.title || 'Maritime supply route diversion and AIS drift detected.',
  });
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<any[] | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Sync sample event with selected signal when selection changes
  useEffect(() => {
    if (selectedSignal?.event) {
      setSampleEventData({
        eventType: selectedSignal.event.eventType || 'SPATIAL_DRIFT_ALERT',
        targetSector: selectedSignal.event.targetSector || 'Defense & Maritime Security',
        jurisdiction: selectedSignal.event.jurisdiction || 'Pacific Maritime Hub',
        severity: selectedSignal.event.severity || 'HIGH',
        confidenceScore: selectedSignal.score ? selectedSignal.score / 100 : 0.85,
        rawText: selectedSignal.title || 'Maritime supply route diversion and AIS drift detected.',
      });
    }
  }, [selectedSignal]);

  // ─── Evaluation Logs & Audits State ───────────────────────────────────────
  const [auditOutcomeFilter, setAuditOutcomeFilter] = useState<'all' | 'matched' | 'no_match' | 'error'>('all');

  const { data: historicalSignals = [] } = useQuery<any[]>({
    queryKey: ['/api/event-primitives?limit=10'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/event-primitives?limit=10');
      return res.json();
    },
    enabled: activeTab === 'simulation',
  });

  const { data: auditLogs = [], isLoading: auditsLoading, refetch: refetchAudits } = useQuery<any[]>({
    queryKey: [`/api/rule-suites/${RULE_SUITE_ID}/audits`, auditOutcomeFilter],
    queryFn: async () => {
      const url = auditOutcomeFilter === 'all'
        ? `/api/rule-suites/${RULE_SUITE_ID}/audits?limit=50`
        : `/api/rule-suites/${RULE_SUITE_ID}/audits?limit=50&outcome=${auditOutcomeFilter}`;
      const res = await apiRequest('GET', url);
      return res.json();
    },
    enabled: activeTab === 'logs',
    refetchInterval: activeTab === 'logs' ? 10_000 : false,
  });

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    setSimulationError(null);
    setSimulationResult(null);
    try {
      const ruleName = selectedSignal
        ? `Triage Rule: ${selectedSignal.title.slice(0, 35)}`
        : 'Signal Routing Triage Rule';
      const ruleId = slugifyRuleId(ruleName);
      const { specification } = buildRuleSpecification(ruleTree, {
        ruleId,
        ruleName,
        deliveryMode,
        enabled: true,
        priorityWeight: 70,
      });

      const res = await apiRequest('POST', '/api/rule-suites/simulate', {
        specification,
        sampleEvent: sampleEventData,
      });
      const data = await res.json();
      setSimulationResult(data);
    } catch (err: any) {
      setSimulationError(err?.message || 'Simulation execution failed.');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleRunBatchBacktest = async () => {
    if (!historicalSignals || historicalSignals.length === 0) return;
    setIsBatchRunning(true);
    setSimulationError(null);
    setBatchResults(null);
    try {
      const ruleName = selectedSignal
        ? `Triage Rule: ${selectedSignal.title.slice(0, 35)}`
        : 'Signal Routing Triage Rule';
      const ruleId = slugifyRuleId(ruleName);
      const { specification } = buildRuleSpecification(ruleTree, {
        ruleId,
        ruleName,
        deliveryMode,
        enabled: true,
        priorityWeight: 70,
      });

      const results = await Promise.all(
        historicalSignals.map(async (sig) => {
          try {
            const res = await apiRequest('POST', '/api/rule-suites/simulate', {
              specification,
              sampleEvent: {
                eventType: sig.eventType || 'SPATIAL_DRIFT_ALERT',
                targetSector: sig.targetSector || 'General',
                jurisdiction: sig.jurisdiction || 'Global',
                severity: sig.severity || 'Medium',
                confidenceScore: sig.confidenceScore || 0.8,
                rawText: sig.rawText || sig.title || '',
              },
            });
            const data = await res.json();
            return {
              signal: sig,
              matched: data.matched,
              score: data.masterPriorityScore,
              disposition: data.disposition,
            };
          } catch {
            return {
              signal: sig,
              matched: false,
              score: 0,
              disposition: 'ERROR',
            };
          }
        })
      );
      setBatchResults(results);
    } catch (err: any) {
      setSimulationError(err?.message || 'Batch simulation failed.');
    } finally {
      setIsBatchRunning(false);
    }
  };

  /** Tray width bounds. Below MIN the catalog is unreadable; above MAX the
   *  builder canvas is squeezed out. */
  const TRAY_MIN_W = 280;
  const TRAY_MAX_W = 1100;
  const TRAY_COLLAPSED_W = 320;
  const TRAY_EXPANDED_W = 840;

  /**
   * Drag the tray edge to resize.
   *
   * The handle advertised `cursor-ew-resize` and "drag to adjust width" but only
   * ever click-toggled — `isDraggingHandle` was declared and never assigned. A
   * drag that moves less than a few pixels is treated as a click, so the
   * toggle behaviour survives.
   */
  const handleTrayHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    // Measure the tray rather than trusting state: on first drag the width is
    // still driven by the responsive class, so customTrayWidth is null.
    const trayEl = target.closest('[data-tray-root]') as HTMLElement | null;
    const startWidth = customTrayWidth ?? trayEl?.getBoundingClientRect().width ?? TRAY_COLLAPSED_W;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      // The tray sits on the right, so dragging LEFT widens it.
      const delta = startX - ev.clientX;
      if (Math.abs(delta) > 3) moved = true;
      const next = Math.min(TRAY_MAX_W, Math.max(TRAY_MIN_W, startWidth + delta));
      setCustomTrayWidth(next);
      setIsSpatialDrawerExpanded(next > 500);
    };

    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setIsDraggingHandle(false);

      if (!moved) {
        // Treat as a click: toggle between collapsed and expanded.
        const expanded = (customTrayWidth ?? startWidth) > 500;
        setCustomTrayWidth(expanded ? TRAY_COLLAPSED_W : TRAY_EXPANDED_W);
        setIsSpatialDrawerExpanded(!expanded);
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
    setIsDraggingHandle(true);
  };

  /**
   * Opens the H3 palette in the tools tray, widened enough to work a map in.
   *
   * Deliberately not a modal. The palette is a tool of the builder — you pick a
   * geofence while looking at the rule you are attaching it to — and a
   * full-screen overlay hides exactly the thing that gives the choice meaning.
   * It also closes any evaluator config open in the tray, since both cannot
   * occupy it at once.
   */
  const openSpatialPalette = () => {
    setSelectedNodeForConfig(null);
    setShowGlobalSpatialPalette(true);
    setIsSpatialDrawerExpanded(true);
    setCustomTrayWidth((w) => (w && w >= TRAY_EXPANDED_W ? w : TRAY_EXPANDED_W));
  };

  /** Restores the tray to the catalog after the palette is dismissed. */
  const closeSpatialPalette = () => {
    setShowGlobalSpatialPalette(false);
    setIsSpatialDrawerExpanded(false);
    setCustomTrayWidth(null);
  };

  /** Keyboard resizing — a pointer-only resize is unreachable without a mouse. */
  const handleTrayHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = customTrayWidth ?? TRAY_COLLAPSED_W;
    const step = e.shiftKey ? 100 : 20;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(
        TRAY_MAX_W,
        Math.max(TRAY_MIN_W, current + (e.key === 'ArrowLeft' ? step : -step))
      );
      setCustomTrayWidth(next);
      setIsSpatialDrawerExpanded(next > 500);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const expanded = current > 500;
      setCustomTrayWidth(expanded ? TRAY_COLLAPSED_W : TRAY_EXPANDED_W);
      setIsSpatialDrawerExpanded(!expanded);
    }
  };

  const [ruleTree, setRuleTree] = useState<ConditionGroup>(() => {
    if (initialRuleTree) return initialRuleTree;
    if (isRescueDispatchContext) return createRescueDispatchGeoRuleTree();
    return createEmptyRuleTree();
  });
  const hasConditions = ruleTree.children.length > 0;

  // Sync rule tree if initialRuleTree or rescue context changes and tree was empty
  useEffect(() => {
    if (initialRuleTree) {
      setRuleTree(initialRuleTree);
      if (initialDeliveryMode) setDeliveryMode(initialDeliveryMode);
      if (initialCooldownMinutes !== undefined) setCooldownMinutes(initialCooldownMinutes);
      return;
    }
    if (isRescueDispatchContext && ruleTree.children.length === 0) {
      setRuleTree(createRescueDispatchGeoRuleTree());
      setDeliveryMode('trigger');
      setCooldownMinutes(5);
    }
  }, [isRescueDispatchContext, initialRuleTree, initialDeliveryMode, initialCooldownMinutes]);

  // Modal for editing or adding condition
  const [editingCondition, setEditingCondition] = useState<{ groupId: string; condition?: ConditionRule } | null>(null);
  const [editField, setEditField] = useState('targetSector');
  const [editOp, setEditOp] = useState('equals');
  const [editVal, setEditVal] = useState('Defense & Security');

  // Pre-fill entire rule tree from current selected signal
  const handlePrefillFromSignal = () => {
    // `event` holds the fields a rule is built from. Three call sites construct a
    // signal through `as any`, so it can be missing at runtime whatever the type
    // says - and reading through it used to take the whole view down.
    if (!selectedSignal?.event) return;
    const evt = selectedSignal.event;

    // If the signal is the generator anomaly or contains spatial telemetry, generate the full geo event rule:
    if (
      evt.h3Index === '8828308281fffff' ||
      evt.subjectId === 'AST-8842' ||
      evt.eventType === 'Operational_Disruption' ||
      (evt.rawText && evt.rawText.includes('GEN-8842-X'))
    ) {
      setRuleTree(createRescueDispatchGeoRuleTree());
      setDeliveryMode('trigger');
      setCooldownMinutes(5);
      return;
    }

    const signalRuleTree: ConditionGroup = {
      id: 'root-and',
      type: 'group',
      logic: 'AND',
      children: [
        {
          id: `cond-sig-1-${Date.now()}`,
          type: 'condition',
          field: 'targetSector',
          operator: 'equals',
          value: selectedSignal.event.targetSector,
          label: `targetSector equals "${selectedSignal.event.targetSector}"`,
        },
        ...(typeof selectedSignal.score === 'number'
          ? [{
              id: `cond-sig-2-${Date.now()}`,
              type: 'condition',
              field: 'confidenceScore',
              operator: '>=',
              value: `${selectedSignal.score / 100}`,
              label: `confidenceScore >= ${selectedSignal.score / 100}`,
            } as ConditionRule]
          : []),
        {
          id: `group-sig-or-${Date.now()}`,
          type: 'group',
          logic: 'OR',
          children: [
            {
              id: `cond-sig-3-${Date.now()}`,
              type: 'condition',
              field: 'severity',
              operator: 'equals',
              value: selectedSignal.event.severity,
              label: `severity equals "${selectedSignal.event.severity}"`,
            },
            {
              id: `cond-sig-4-${Date.now()}`,
              type: 'condition',
              field: 'jurisdiction',
              operator: 'equals',
              value: selectedSignal.event.jurisdiction,
              label: `jurisdiction equals "${selectedSignal.event.jurisdiction}"`,
            },
          ],
        },
      ],
    };
    setRuleTree(signalRuleTree);
  };

  // Deterministic local parser. Keep the UI honest until this uses a model service.
  const handleCopilotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotPrompt.trim()) return;

    const lower = copilotPrompt.toLowerCase();
    let newLogic: 'AND' | 'OR' = lower.includes('or') ? 'OR' : 'AND';
    let field = 'targetSector';
    let val = 'Defense & Security';

    if (lower.includes('logistics') || lower.includes('trade')) val = 'Logistics & Trade';
    if (lower.includes('critical') || lower.includes('high')) { field = 'severity'; val = 'HIGH'; }
    if (lower.includes('confidence')) { field = 'confidenceScore'; val = '>= 0.85'; }

    const generatedRule: ConditionGroup = {
      id: 'root-generated',
      type: 'group',
      logic: newLogic,
      children: [
        {
          id: `cond-gen-1-${Date.now()}`,
          type: 'condition',
          field: 'Copilot AI Query',
          operator: 'matches',
          value: copilotPrompt,
          label: `Copilot Rule: "${copilotPrompt}"`,
        },
        {
          id: `cond-gen-2-${Date.now()}`,
          type: 'condition',
          field,
          operator: 'equals',
          value: val,
          label: `${field} equals "${val}"`,
        },
      ],
    };

    setRuleTree(generatedRule);
    setCopilotPrompt('');
  };

  // Helper functions for modifying condition tree recursively
  const addConditionToGroup = (groupId: string, newRule: ConditionRule) => {
    const updateGroup = (group: ConditionGroup): ConditionGroup => {
      if (group.id === groupId) {
        return { ...group, children: [...group.children, newRule] };
      }
      return {
        ...group,
        children: group.children.map((child) =>
          child.type === 'group' ? updateGroup(child) : child
        ),
      };
    };
    setRuleTree(updateGroup(ruleTree));
  };

  const addGroupToGroup = (groupId: string, logic: 'AND' | 'OR') => {
    const newGroup: ConditionGroup = {
      id: `group-${Date.now()}`,
      type: 'group',
      logic,
      children: [
        {
          id: `cond-${Date.now()}`,
          type: 'condition',
          field: 'confidenceScore',
          operator: '>=',
          value: '0.85',
          label: 'confidenceScore >= 0.85',
        },
      ],
    };
    const updateGroup = (group: ConditionGroup): ConditionGroup => {
      if (group.id === groupId) {
        return { ...group, children: [...group.children, newGroup] };
      }
      return {
        ...group,
        children: group.children.map((child) =>
          child.type === 'group' ? updateGroup(child) : child
        ),
      };
    };
    setRuleTree(updateGroup(ruleTree));
  };

  const removeNodeFromGroup = (nodeId: string) => {
    const removeNode = (group: ConditionGroup): ConditionGroup => {
      return {
        ...group,
        children: group.children
          .filter((child) => child.id !== nodeId)
          .map((child) => (child.type === 'group' ? removeNode(child) : child)),
      };
    };
    setRuleTree(removeNode(ruleTree));
  };

  /**
   * Persists the tree as a GRIE rule specification.
   *
   * The previous implementation POSTed the raw builder tree to
   * `/api/subscriptions` as an opaque `filters` blob and swallowed every error,
   * so a failed save was indistinguishable from a successful one and the rule
   * engine never saw the rule at all.
   */
  const persistRule = async (enabled: boolean) => {
    const ruleName = selectedSignal
      ? `Triage Rule: ${selectedSignal.title.slice(0, 35)}`
      : isRescueDispatchContext
      ? 'Critical Generator Geo-Spatial Anomaly & Dwell Policy'
      : 'Signal Routing Triage Rule';
    const ruleId = slugifyRuleId(ruleName);

    // Conversion can legitimately fail (no conditions, or a tree that expands
    // past the DNF budget). Surface that instead of saving something wrong.
    const { specification, warnings } = buildRuleSpecification(ruleTree, {
      ruleId,
      ruleName,
      deliveryMode,
      enabled,
      priorityWeight: enabled ? 70 : 50,
    });

    await apiRequest('POST', '/api/rule-suites/deploy', {
      suite: {
        suiteId: RULE_SUITE_ID,
        suiteName: 'Signal Routing Triage',
        category: 'Defense & Maritime Security',
        description: 'Rules authored in the Signal Intelligence Rule Builder.',
      },
      rule: specification,
    }, RULE_DEPLOY_TIMEOUT_MS);

    return { ruleId, warnings };

  };

  const handleSaveDraft = async () => {
    setSaveError(null);
    setSaveWarnings([]);
    try {
      const { warnings } = await persistRule(false);
      setSaveWarnings(warnings);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
      if (onSaveDraft) onSaveDraft(ruleTree);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Could not save the draft.');
    }
  };

  const handleDeploy = async () => {
    setSaveError(null);
    setSaveWarnings([]);
    setIsDeploying(true);
    try {
      const { warnings } = await persistRule(true);
      setSaveWarnings(warnings);
      setDeploySuccess(true);
      if (onDeploy) onDeploy(ruleTree);
      setTimeout(() => setDeploySuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Could not deploy this rule.');
    } finally {
      setIsDeploying(false);
    }
  };

  const [selectedNodeForConfig, setSelectedNodeForConfig] = useState<{
    node: ConditionRule;
    label: string;
    type: string;
  } | null>(null);

  const getEvaluatorTypeFromNode = (node: ConditionRule): string => {
    if (node.evaluatorType) return node.evaluatorType;
    const f = node.field.toLowerCase();
    if (f.includes('semantic')) return 'semantic_judge';
    if (f.includes('anomaly')) return 'anomaly_scorer';
    if (f.includes('freshness')) return 'freshness_decay';
    if (f.includes('sliding')) return 'sliding_window';
    if (f.includes('webhook')) return 'webhook';
    if (f.includes('response')) return 'response_cycle';
    return 'field_threshold';
  };

  const handleSaveNodeConfig = (updatedConfig: EvaluatorConfig, updatedLabel: string) => {
    if (!selectedNodeForConfig) return;
    const { node } = selectedNodeForConfig;

    const updateNodeInGroup = (group: ConditionGroup): ConditionGroup => {
      return {
        ...group,
        children: group.children.map((child) => {
          if (child.type === 'condition' && child.id === node.id) {
            return {
              ...child,
              label: updatedLabel,
              config: updatedConfig,
            };
          }
          if (child.type === 'group') {
            return updateNodeInGroup(child);
          }
          return child;
        }),
      };
    };

    setRuleTree(updateNodeInGroup(ruleTree));
    setSelectedNodeForConfig(null);
  };

  const handleRenameNode = (nodeId: string, newLabel: string) => {
    if (!newLabel.trim()) {
      setEditingLabelNodeId(null);
      return;
    }
    const updateNodeLabel = (group: ConditionGroup): ConditionGroup => ({
      ...group,
      children: group.children.map((child) => {
        if (child.type === 'condition' && child.id === nodeId) {
          return { ...child, label: newLabel.trim() };
        }
        if (child.type === 'group') {
          return updateNodeLabel(child);
        }
        return child;
      }),
    });
    setRuleTree(updateNodeLabel(ruleTree));
    setEditingLabelNodeId(null);
  };

  const handleToolAdd = (toolName: string, category: string) => {
    // The spatial zone tool opens the map in the tray rather than dropping a
    // blank condition: the geofence IS the condition, so there is nothing
    // meaningful to add until a region has been picked.
    if (toolName.includes('H3 Spatial')) {
      openSpatialPalette();
      return;
    }

    let type = 'field_threshold';
    if (toolName.includes('Semantic')) type = 'semantic_judge';
    else if (toolName.includes('Anomaly')) type = 'anomaly_scorer';
    else if (toolName.includes('Freshness')) type = 'freshness_decay';
    else if (toolName.includes('Sliding')) type = 'sliding_window';
    else if (toolName.includes('Webhook')) type = 'webhook';
    else if (toolName.includes('Response')) type = 'response_cycle';

    const newCond: ConditionRule = {
      id: `cond-tool-${Date.now()}`,
      type: 'condition',
      field: toolName.toLowerCase().replace(/\s+/g, '_'),
      operator: 'active',
      value: 'true',
      label: `[${category}] ${toolName} condition active`,
      evaluatorType: type,
      config: {},
    };
    addConditionToGroup(ruleTree.id, newCond);
    setSelectedNodeForConfig({ node: newCond, label: toolName, type });
  };

  // Render a Condition Node (Pill) matching HTML example item style
  const renderCondition = (cond: ConditionRule) => {
    const isConfigured = cond.config && Object.keys(cond.config).length > 0;
    const evaluatorType = getEvaluatorTypeFromNode(cond);
    const isRenaming = editingLabelNodeId === cond.id;

    return (
      <div
        key={cond.id}
        className="flex items-center gap-3 group"
        data-testid="rule-condition-row"
        data-field={cond.field}
        data-operator={cond.operator}
      >
        <div className="cursor-move text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>
        <div
          onClick={() => {
            if (!isRenaming) {
              setSelectedNodeForConfig({ node: cond, label: cond.label || cond.field, type: evaluatorType });
            }
          }}
          className={cn(
            'bg-muted border rounded-full px-4 py-2 text-foreground flex-1 max-w-fit hover:scale-[1.01] transition-all text-sm flex items-center gap-3 shadow-sm cursor-pointer',
            isConfigured ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:border-primary/50'
          )}
        >
          {isRenaming ? (
            <input
              type="text"
              autoFocus
              value={inlineLabelText}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setInlineLabelText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameNode(cond.id, inlineLabelText);
                if (e.key === 'Escape') setEditingLabelNodeId(null);
              }}
              onBlur={() => handleRenameNode(cond.id, inlineLabelText)}
              className="bg-background border border-primary text-foreground px-2.5 py-0.5 rounded text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingLabelNodeId(cond.id);
                setInlineLabelText(cond.label || cond.field);
              }}
              className="cursor-pointer"
              title="Double-click to rename rule"
            >
              {cond.label ? (
                cond.label
              ) : (
                <>
                  <span className="text-muted-foreground">{cond.field}</span>{' '}
                  <span className="text-primary font-semibold">{cond.operator}</span>{' '}
                  <span className="font-semibold text-foreground">{cond.value}</span>
                </>
              )}
            </span>
          )}

          <div className="flex items-center gap-1.5 ml-2 border-l border-border pl-2.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingLabelNodeId(cond.id);
                setInlineLabelText(cond.label || cond.field);
              }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent/50 flex items-center gap-1 text-[11px]"
              title="Rename Rule"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedNodeForConfig({ node: cond, label: cond.label || cond.field, type: evaluatorType });
              }}
              className="text-primary hover:text-foreground transition-colors p-1 rounded hover:bg-primary/20 flex items-center gap-1 text-[11px] font-semibold"
              title="Configure Evaluator Settings"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeNodeFromGroup(cond.id);
              }}
              className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-0.5 ml-1"
              title="Remove condition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render a Logical Group (AND / OR bracketed box) matching HTML structure
  const renderGroup = (group: ConditionGroup, isRoot = false) => {
    const isAnd = group.logic === 'AND';

    return (
      <div key={group.id} className={cn('relative pl-12 font-mono text-sm', !isRoot && 'mt-3')}>
        {/* Bracket Line and Logic Badge */}
        <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col items-center">
          {/* Top Horizontal Line */}
          <div className={cn('absolute top-[22px] left-3 w-3 h-[2px]', isAnd ? 'bg-primary' : 'bg-amber-500')} />
          {/* Vertical Line */}
          <div className={cn('absolute top-[22px] bottom-[22px] left-3 w-[2px]', isAnd ? 'bg-primary' : 'bg-amber-500')} />
          {/* Bottom Horizontal Line */}
          <div className={cn('absolute bottom-[22px] left-3 w-3 h-[2px]', isAnd ? 'bg-primary' : 'bg-amber-500')} />
          {/* Logic Badge */}
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-1 rounded-full z-10 border shadow-md',
              isAnd
                ? 'bg-primary/20 text-primary-foreground border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                : 'bg-amber-900/40 text-amber-300 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.1)]'
            )}
          >
            {group.logic}
          </div>
        </div>

        {/* Inner Group Container */}
        <div
          className={cn(
            'flex flex-col gap-3',
            !isRoot && 'bg-card border border-border rounded-xl p-4'
          )}
        >
          {group.children.map((child) =>
            child.type === 'condition' ? renderCondition(child) : renderGroup(child)
          )}

          {/* Group Action Buttons */}
          <div className="flex items-center gap-4 mt-2 ml-8">
            <button
              onClick={() => setEditingCondition({ groupId: group.id })}
              className="text-primary hover:text-primary/90 text-sm font-medium flex items-center gap-1 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add filter
            </button>
            <button
              onClick={() => addGroupToGroup(group.id, isAnd ? 'OR' : 'AND')}
              className="text-primary hover:text-primary/90 text-sm font-medium flex items-center gap-1 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add inner group ({isAnd ? 'OR' : 'AND'})
            </button>
            {!isRoot && (
              <button
                onClick={() => removeNodeFromGroup(group.id)}
                className="text-muted-foreground hover:text-destructive text-xs font-medium flex items-center gap-1 transition-colors ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove group
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const catalogTools = [
    { name: 'Boolean Group', desc: 'Drag or click to add nested logic', cat: 'Filters', icon: Filter, color: 'text-primary' },
    { name: 'Field Threshold', desc: 'Score & severity cutoffs', cat: 'Filters', icon: SlidersHorizontal, color: 'text-primary' },
    // The H3 palette belongs in the catalog alongside every other evaluator.
    // It had been reachable only from a quick-action pill that opened a
    // full-screen modal, so it stopped reading as a tool of the builder at all.
    { name: 'H3 Spatial Zone', desc: 'Pick a geofence on the map', cat: 'Filters', icon: MapPin, color: 'text-cyan-400' },
    { name: 'Semantic Judge', desc: 'AI LLM thesis verification', cat: 'AI Logic', icon: Sparkles, color: 'text-emerald-400' },
    { name: 'Anomaly Scorer', desc: 'H3 Eigenvalue surprise model', cat: 'AI Logic', icon: Activity, color: 'text-emerald-400' },
    { name: 'Freshness Decay', desc: 'Temporal recency weighting', cat: 'Temporal', icon: Clock, color: 'text-amber-300' },
    { name: 'Sliding Window', desc: 'Rolling 7-day burst detector', cat: 'Temporal', icon: Clock, color: 'text-amber-300' },
    { name: 'Webhook Action', desc: 'External HTTP notification', cat: 'Actions', icon: Webhook, color: 'text-purple-400' },
    { name: 'Response Cycle', desc: 'Trigger governed cycle', cat: 'Actions', icon: Zap, color: 'text-purple-400' },
  ].filter(
    (t) =>
      toolSearch === '' ||
      t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
      t.cat.toLowerCase().includes(toolSearch.toLowerCase())
  );

  const selectedFieldObj = COMMON_FIELDS.find((f) => f.value === editField);

  return (
    <div className={cn('flex flex-col gap-6 w-full text-foreground', isFullScreen && 'fixed inset-0 z-50 bg-background p-6 overflow-hidden')}>
      {/* Copilot Natural Language Assistant Bar */}
      <div className="bg-background border border-border rounded-xl p-4 flex flex-col gap-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-green-900/30 border border-green-800 flex items-center justify-center shrink-0 text-green-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground text-sm">Quick Rule Parser</span>
                <span className="text-xs bg-green-900/30 text-green-400 border border-green-800/50 px-2 py-0.5 rounded font-mono">
                  LOCAL PARSER
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Convert a short plain-language rule into editable conditions, or pre-fill from the selected signal.
              </p>
            </div>
          </div>
          {selectedSignal && (
            <button
              onClick={handlePrefillFromSignal}
              className="px-3 py-1.5 bg-primary/20 border border-primary/40 text-primary-foreground hover:bg-primary/30 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Pre-fill from Signal
            </button>
          )}
        </div>

        {/* Natural Language Prompt Input */}
        <form onSubmit={handleCopilotSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder='e.g. "Route all defense signals with high severity or score above 80..."'
            value={copilotPrompt}
            onChange={(e) => setCopilotPrompt(e.target.value)}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-primary-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Generate Rule
          </button>
        </form>
      </div>

      {/* Main App Container (Native Tokenized Surface)
          `max-h` is what makes this a MODULE rather than a page section: with
          only a min-height it grew to its content, the page scrolled instead of
          the condition tree, and the sticky toolbar inside scrolled away with
          it. Bounded, `overflow-hidden` here plus `overflow-y-auto` on the
          column below finally engage. min-h wins on very short viewports, which
          is the desired fallback. */}
      <div data-testid="rule-builder" className="bg-card rounded-xl border border-border flex flex-col shadow-2xl overflow-hidden min-h-[600px] max-h-[85vh]">
        {/* App Toolbar */}
        <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-background/50">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm text-primary-foreground">
              {embedded ? 'Rule configuration' : 'Signal Routing Triage'}
            </span>
            {!embedded && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-green-900/30 text-green-400 border border-green-800/50">
                Native Tokenized Surface
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Kept when embedded: a large condition tree genuinely benefits
                from the room, and this is duplicated by nothing. Only the
                title and the surface badge were repeating the host. */}
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="text-sm text-muted-foreground hover:text-primary-foreground flex items-center gap-1.5 transition-colors"
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              {isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
            </button>
          </div>
        </div>

        {/* App Tabs */}
        <div className="flex items-center border-b border-border px-4 py-2 gap-2 bg-card">
          <button
            onClick={() => setActiveTab('triage')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-colors',
              activeTab === 'triage'
                ? 'bg-background border border-primary/30 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Triage & Semantic
          </button>
          <button
            onClick={() => setActiveTab('simulation')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-colors',
              activeTab === 'simulation'
                ? 'bg-background border border-primary/30 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Activity className="w-4 h-4" />
            Test Simulation
          </button>
          <button
            onClick={() => setActiveTab('policy')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-colors',
              activeTab === 'policy'
                ? 'bg-background border border-primary/30 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Shield className="w-4 h-4" />
            Policy Definitions
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-colors',
              activeTab === 'logs'
                ? 'bg-background border border-primary/30 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Clock className="w-4 h-4" />
            Evaluation Logs
          </button>
        </div>

        {/* App Workspace
            `min-h-0` on the row and the column below: a flex item defaults to
            min-height:auto, so it refuses to shrink below its content and the
            overflow-y-auto never actually overflows. Without it the column
            simply grew and the page scrolled instead of the condition tree. */}
        {activeTab === 'triage' && (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* Left Column (Builder Canvas) */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
              {/* Builder Header
                  Sticky within this scroll container so the delivery mode,
                  cooldown and Deploy stay reachable when the condition tree
                  grows past the viewport — otherwise a tall rule forces a
                  scroll back to the top for every action. */}
              <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border/60 p-6 pb-4 flex justify-between items-start gap-4 flex-wrap">
                <div>
                  {/* Standalone, this bar has to name the surface. Embedded,
                      the host's header and the module toolbar already do — and
                      the "Conditions" label below would then say it a third
                      time in the space of two lines. */}
                  {!embedded && (
                    <>
                      <h2 className="text-2xl font-semibold text-foreground mb-1">Signal Routing Triage</h2>
                      <p className="text-muted-foreground text-sm">
                        Define deterministic inclusion rules before semantic evaluation.
                      </p>
                    </>
                  )}
                  {/* Section label lives in the sticky bar rather than below it:
                      two stacked `sticky top-0` blocks in one scroll container
                      pin at the same offset and overlap. */}
                  <div className={cn('flex items-baseline gap-2', !embedded && 'mt-3')}>
                    <span className="text-sm font-medium text-foreground">Conditions</span>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Inclusion Filters
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-1.5">
                    <span className="text-xs text-muted-foreground font-medium">Delivery:</span>
                    <select
                      value={deliveryMode}
                      onChange={(e) => setDeliveryMode(e.target.value as any)}
                      className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer font-semibold"
                    >
                      <option value="context_only" className="bg-background text-foreground">context_only</option>
                      <option value="replan" className="bg-background text-foreground">replan</option>
                      <option value="trigger" className="bg-background text-foreground">trigger</option>
                      <option value="gate" className="bg-background text-foreground">gate</option>
                      <option value="notify" className="bg-background text-foreground">notify</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-1.5">
                    <span className="text-xs text-muted-foreground font-medium">Cooldown (m):</span>
                    <input
                      type="number"
                      min={0}
                      value={cooldownMinutes}
                      onChange={(e) => setCooldownMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                      className="bg-transparent text-xs text-foreground focus:outline-none w-12 font-semibold"
                    />
                  </div>
                  <button
                    onClick={handleSaveDraft}
                    disabled={!hasConditions}
                    data-testid="rule-save-draft"
                    className="px-4 py-2 text-sm font-medium rounded-md border border-border bg-muted hover:bg-accent text-foreground flex items-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {draftSaved ? (
                      <Check className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {draftSaved ? 'Saved' : 'Save Draft'}
                  </button>
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying || !hasConditions}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-primary hover:bg-primary/90 text-primary-foreground transition-colors flex items-center gap-2 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="rule-deploy"
                  >
                    {isDeploying ? (
                      <Activity className="w-4 h-4 animate-spin" />
                    ) : deploySuccess ? (
                      <Check className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    {isDeploying ? 'Deploying...' : deploySuccess ? 'Deployed!' : 'Deploy to Edge'}
                  </button>
                </div>

                {/* Save feedback. Previously every failure was swallowed, so a
                    rule that never reached the engine looked identical to one
                    that did. */}
                {saveError && (
                  <div
                    role="alert"
                    data-testid="rule-save-error"
                    className="w-full flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                    <span>{saveError}</span>
                  </div>
                )}
                {saveWarnings.length > 0 && (
                  <div
                    data-testid="rule-save-warnings"
                    className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-0.5"
                  >
                    {saveWarnings.map((w) => (
                      <div key={w} className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Builder Canvas (Conditions Logic Tree) */}
              <div className="p-6 pt-4 flex-1">
                {/* Render Condition Logic Tree */}
                {hasConditions ? (
                  renderGroup(ruleTree, true)
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
                    <p className="text-sm font-semibold text-foreground">Start with a blank rule</p>
                    <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                      Add a filter, use the local parser, or pre-fill from the selected signal. Nothing is assumed until you choose it.
                    </p>
                  </div>
                )}

                {/* Top Level Action Buttons */}
                <div className="mt-8 flex items-center gap-3">
                  <button
                    onClick={() => setEditingCondition({ groupId: ruleTree.id })}
                    className="px-4 py-2 bg-muted border border-border rounded-lg text-primary hover:bg-accent hover:text-foreground text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
                    data-testid="rule-add-condition"
                  >
                    <Plus className="w-4 h-4" />
                    Add filter
                  </button>
                  <button
                    onClick={() => addGroupToGroup(ruleTree.id, 'OR')}
                    className="px-4 py-2 bg-muted border border-border rounded-lg text-primary hover:bg-accent hover:text-foreground text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add group
                  </button>
                </div>
              </div>
            </div>

            {/* Right Sidebar (Tools Catalog OR Evaluator Settings Panel) */}
            {(() => {
              const isSpatialRuleActive =
                selectedNodeForConfig &&
                (selectedNodeForConfig.type === 'anomaly_scorer' ||
                  selectedNodeForConfig.node.field?.includes('spatial') ||
                  selectedNodeForConfig.node.field?.includes('h3') ||
                  selectedNodeForConfig.node.field === 'jurisdiction' ||
                  selectedNodeForConfig.label?.toLowerCase().includes('spatial') ||
                  selectedNodeForConfig.label?.toLowerCase().includes('h3') ||
                  isSpatialDrawerExpanded);

              const effectiveWidthStyle = customTrayWidth
                ? { width: `${customTrayWidth}px` }
                : undefined;

              return (
                <div
                  data-tray-root
                  style={effectiveWidthStyle}
                  className={cn(
                    'relative border-t md:border-t-0 md:border-l border-border bg-muted/50 flex flex-col shrink-0',
                    // Animating width fights a live drag — the tray lags the
                    // cursor. Transition only when not dragging.
                    isDraggingHandle ? '' : 'transition-all duration-300 ease-in-out',
                    !customTrayWidth &&
                      (isSpatialRuleActive
                        ? 'w-full md:w-[740px] lg:w-[840px] xl:w-[900px]'
                        : 'w-full md:w-80')
                  )}
                >
                  {/* Interactive Tray Handle (Draggable & Click-to-Toggle)
                      Wrapped in a zero-height sticky rail so the grip stays at
                      the vertical centre of whatever is currently on screen.
                      Anchoring it to the tray with `absolute top-1/2` centred it
                      on the full module height, which drifts off-screen as soon
                      as the module grows taller than the viewport. */}
                  <div className="hidden md:block sticky top-1/2 z-30 h-0 w-0">
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize tools tray"
                      onPointerDown={handleTrayHandleDown}
                      onKeyDown={handleTrayHandleKey}
                      tabIndex={0}
                      className={cn(
                        'absolute -left-3.5 -translate-y-1/2 flex flex-col items-center justify-center cursor-ew-resize select-none touch-none',
                        'h-20 w-7 rounded-full bg-card border shadow-2xl transition-all group',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
                        isDraggingHandle
                          ? 'border-cyan-400 bg-cyan-950/90'
                          : 'border-border hover:border-cyan-400 hover:bg-cyan-950/90'
                      )}
                      title="Drag to resize the tray, or click to expand/collapse"
                    >
                      <GripVertical
                        className={cn(
                          'w-3.5 h-3.5 transition-colors',
                          isDraggingHandle ? 'text-cyan-300' : 'text-muted-foreground group-hover:text-cyan-300'
                        )}
                      />
                      <span className="text-[9px] text-cyan-400 font-bold mt-0.5">
                        {(customTrayWidth && customTrayWidth > 500) || isSpatialRuleActive ? (
                          <ChevronRight className="w-3 h-3 text-cyan-400" />
                        ) : (
                          <ChevronLeft className="w-3 h-3 text-cyan-400" />
                        )}
                      </span>
                    </div>
                  </div>

                  {showGlobalSpatialPalette ? (
                    /* The map lives IN the tray, beside the rule it is being
                       attached to — same surface as every other tool, and
                       resizable by the same handle. */
                    <div className="flex flex-col h-full min-h-0 p-3">
                      <H3SpatialPalette
                      timeZone={orgTimeZone}
                        initialRegion=""
                        initialResolution={7}
                        onSelectRegion={(sel: SpatialRegionSelection) => {
                          const newCond: ConditionRule = {
                            id: `cond-spatial-${Date.now()}`,
                            type: 'condition',
                            field: 'spatial_drift > h3_resolution',
                            operator: 'in',
                            value: sel.regionName,
                            label: sel.summaryLabel,
                            evaluatorType: 'anomaly_scorer',
                            config: {
                              spatialRegionName: sel.regionName,
                              centerLat: sel.centerLat,
                              centerLng: sel.centerLng,
                              h3Resolution: `Res ${sel.h3Resolution} (~${sel.radiusKm}km)`,
                              selectedHexes: sel.selectedHexes,
                              value: sel.regionName,
                            },
                          };
                          addConditionToGroup(ruleTree.id, newCond);
                          closeSpatialPalette();
                        }}
                        onClose={closeSpatialPalette}
                      />
                    </div>
                  ) : selectedNodeForConfig ? (
                    <EvaluatorConfigDrawer
                      isOpen={!!selectedNodeForConfig}
                      onClose={() => {
                        setSelectedNodeForConfig(null);
                        setIsSpatialDrawerExpanded(false);
                        setCustomTrayWidth(null);
                      }}
                      nodeType={selectedNodeForConfig.type}
                      nodeLabel={selectedNodeForConfig.label}
                      initialConfig={selectedNodeForConfig.node.config || {}}
                      onSave={handleSaveNodeConfig}
                      embeddedInModule={true}
                      onSpatialExpandChange={(expanded) => {
                        setIsSpatialDrawerExpanded(expanded);
                        if (expanded && (!customTrayWidth || customTrayWidth < 500)) {
                          setCustomTrayWidth(840);
                        }
                      }}
                    />
                  ) : (
                    <div className="p-6 flex flex-col h-full">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Tools Catalog</h3>

                      {/* Search Bar */}
                      <div className="relative mb-6">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm h-4 w-4" />
                        <input
                          type="text"
                          placeholder="Filter tools..."
                          value={toolSearch}
                          onChange={(e) => setToolSearch(e.target.value)}
                          className="w-full bg-background border border-border rounded-md py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-6">
                        {['Filters', 'AI Logic', 'Temporal', 'Actions'].map((category) => {
                          const categoryItems = catalogTools.filter((t) => t.cat === category);
                          if (categoryItems.length === 0) return null;

                          return (
                            <div key={category}>
                              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                                {category}
                              </h4>
                              <div className="space-y-2">
                                {categoryItems.map((tool) => {
                                  const IconComponent = tool.icon;
                                  return (
                                    <div
                                      key={tool.name}
                                      onClick={() => handleToolAdd(tool.name, tool.cat)}
                                      className="group bg-card border border-border rounded-lg p-3 hover:border-primary transition-all cursor-pointer shadow-sm"
                                    >
                                      <div className="flex items-center gap-3">
                                        <IconComponent className={cn('h-5 w-5', tool.color)} />
                                        <div className="flex-1">
                                          <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                                            {tool.name}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground">{tool.desc}</div>
                                        </div>
                                        <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* In-Module Quick Evaluators Dock Tray with Drag Handle */}
        {activeTab === 'triage' && (
          <div className="border-t border-border bg-background/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 relative">
            <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none">
              <div className="h-1 w-12 rounded-full bg-accent/70 hover:bg-cyan-500/60 transition-colors" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pt-1">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0 mr-1.5 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                Quick Evaluators Tray:
              </span>
              <button
                type="button"
                onClick={() => handleToolAdd('Field Threshold', 'Filters')}
                className="px-2.5 py-1 bg-card border border-border hover:border-primary text-xs font-semibold text-foreground rounded-full hover:text-primary transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Filter className="w-3 h-3 text-primary" /> + Field Threshold
              </button>
              <button
                type="button"
                onClick={openSpatialPalette}
                data-testid="open-spatial-palette"
                className="px-2.5 py-1 bg-cyan-950/40 border border-cyan-500/50 hover:border-cyan-400 text-xs font-semibold text-cyan-300 rounded-full hover:text-cyan-200 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Compass className="w-3 h-3 text-cyan-400" /> + 🗺️ H3 Spatial Palette
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Semantic Judge', 'AI Logic')}
                className="px-2.5 py-1 bg-card border border-border hover:border-emerald-400 text-xs font-semibold text-foreground rounded-full hover:text-emerald-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Sparkles className="w-3 h-3 text-emerald-400" /> + Semantic Judge
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Anomaly Scorer', 'AI Logic')}
                className="px-2.5 py-1 bg-card border border-border hover:border-cyan-400 text-xs font-semibold text-foreground rounded-full hover:text-cyan-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Activity className="w-3 h-3 text-cyan-400" /> + Anomaly Scorer
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Freshness Decay', 'Temporal')}
                className="px-2.5 py-1 bg-card border border-border hover:border-amber-400 text-xs font-semibold text-foreground rounded-full hover:text-amber-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Clock className="w-3 h-3 text-amber-400" /> + Freshness Decay
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Sliding Window', 'Temporal')}
                className="px-2.5 py-1 bg-card border border-border hover:border-indigo-400 text-xs font-semibold text-foreground rounded-full hover:text-indigo-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Radio className="w-3 h-3 text-indigo-400" /> + Sliding Window
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Webhook Action', 'Actions')}
                className="px-2.5 py-1 bg-card border border-border hover:border-purple-400 text-xs font-semibold text-foreground rounded-full hover:text-purple-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Webhook className="w-3 h-3 text-purple-400" /> + Webhook Action
              </button>
              <button
                type="button"
                onClick={() => handleToolAdd('Response Cycle', 'Actions')}
                className="px-2.5 py-1 bg-card border border-border hover:border-emerald-400 text-xs font-semibold text-foreground rounded-full hover:text-emerald-400 transition-colors shrink-0 flex items-center gap-1 shadow-sm"
              >
                <Bot className="w-3 h-3 text-emerald-400" /> + Response Cycle
              </button>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('simulation')}
                className="px-3 py-1.5 bg-muted border border-border text-xs font-semibold text-primary-foreground rounded-lg hover:bg-accent hover:text-primary-foreground transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Play className="w-3.5 h-3.5 text-primary" /> Run Simulation
              </button>
              <button
                type="button"
                onClick={handleDeploy}
                disabled={isDeploying || !hasConditions}
                className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-md flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deploySuccess ? <Check className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                {isDeploying ? 'Deploying...' : deploySuccess ? 'Deployed!' : 'Deploy Rule'}
              </button>
            </div>
          </div>
        )}

        {/* Counterfactual Simulation Surface */}
        {activeTab === 'simulation' && (
          <div className="p-6 md:p-8 space-y-6 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Counterfactual Rule Simulation &amp; Backtesting
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Evaluate rule matching selectivity against test vectors or historical market signals before deploying to production edge.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunSimulation}
                  disabled={isSimulating || !hasConditions}
                  data-testid="btn-run-simulation"
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Play className={cn("w-3.5 h-3.5", isSimulating && "animate-spin")} />
                  <span>{isSimulating ? 'Simulating…' : 'Run Single Simulation'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRunBatchBacktest}
                  disabled={isBatchRunning || !hasConditions || historicalSignals.length === 0}
                  data-testid="btn-run-backtest"
                  className="px-3.5 py-1.5 bg-muted border border-border text-foreground hover:bg-accent text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Radio className={cn("w-3.5 h-3.5 text-primary", isBatchRunning && "animate-pulse")} />
                  <span>{isBatchRunning ? 'Backtesting…' : `Backtest Stream (${historicalSignals.length})`}</span>
                </button>
              </div>
            </div>

            {simulationError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{simulationError}</span>
              </div>
            )}

            {/* Test Vector Parameter Configuration */}
            <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Test Vector Sample Event
                </span>
                {selectedSignal && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSignal.event) {
                        setSampleEventData({
                          eventType: selectedSignal.event.eventType || 'SPATIAL_DRIFT_ALERT',
                          targetSector: selectedSignal.event.targetSector || 'Defense & Maritime Security',
                          jurisdiction: selectedSignal.event.jurisdiction || 'Pacific Maritime Hub',
                          severity: selectedSignal.event.severity || 'HIGH',
                          confidenceScore: selectedSignal.score ? selectedSignal.score / 100 : 0.85,
                          rawText: selectedSignal.title || '',
                        });
                      }
                    }}
                    className="text-primary hover:underline text-[11px] font-medium flex items-center gap-1"
                  >
                    <Wand2 className="w-3 h-3" />
                    Reset to active signal
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Event Type</label>
                  <input
                    type="text"
                    value={sampleEventData.eventType}
                    onChange={(e) => setSampleEventData({ ...sampleEventData, eventType: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Target Sector</label>
                  <input
                    type="text"
                    value={sampleEventData.targetSector}
                    onChange={(e) => setSampleEventData({ ...sampleEventData, targetSector: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Jurisdiction</label>
                  <input
                    type="text"
                    value={sampleEventData.jurisdiction}
                    onChange={(e) => setSampleEventData({ ...sampleEventData, jurisdiction: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Severity</label>
                  <select
                    value={sampleEventData.severity}
                    onChange={(e) => setSampleEventData({ ...sampleEventData, severity: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Confidence Score</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={sampleEventData.confidenceScore}
                    onChange={(e) => setSampleEventData({ ...sampleEventData, confidenceScore: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>

            {/* Single Simulation Results Display */}
            {simulationResult && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="simulation-result-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border",
                        simulationResult.matched
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                          : "bg-muted border-border text-muted-foreground"
                      )}
                    >
                      {simulationResult.matched ? "✓ MATCHED (RULE WOULD FIRE)" : "✗ NO MATCH (IGNORED)"}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      Rule ID: {simulationResult.ruleId}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Disposition: <code className="text-primary font-mono">{simulationResult.disposition || 'TRIGGER'}</code>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/50 text-xs">
                  <div className="rounded-lg bg-card/80 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Priority Score</span>
                    <p className="font-semibold text-primary font-mono text-sm">{simulationResult.masterPriorityScore ?? 70}</p>
                  </div>
                  <div className="rounded-lg bg-card/80 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Matched Branch</span>
                    <p className="font-semibold text-foreground font-mono truncate">{simulationResult.matchedBranch || 'Branch 0 (Root)'}</p>
                  </div>
                  <div className="rounded-lg bg-card/80 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Spatial Score</span>
                    <p className="font-semibold text-cyan-400 font-mono text-sm">{simulationResult.spatialScore ?? 1.0}</p>
                  </div>
                  <div className="rounded-lg bg-card/80 border border-border/60 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Fuzzy Evaluators</span>
                    <p className="font-semibold text-foreground font-mono truncate">
                      {simulationResult.fuzzyScores ? Object.keys(simulationResult.fuzzyScores).length : 0} passed
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Batch Historical Backtest Results Display */}
            {batchResults && (
              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Historical Stream Backtest Results
                  </h4>
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary font-mono">
                    {batchResults.filter(r => r.matched).length} / {batchResults.length} Matched ({Math.round((batchResults.filter(r => r.matched).length / batchResults.length) * 100)}% Selectivity)
                  </span>
                </div>

                <div className="divide-y divide-border/50 border border-border/60 rounded-lg overflow-hidden text-xs">
                  {batchResults.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 bg-background/50 hover:bg-muted/40 transition-colors">
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-semibold text-foreground truncate">
                          {item.signal.title || item.signal.rawText || `${item.signal.eventType} in ${item.signal.jurisdiction}`}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.signal.jurisdiction} • {item.signal.targetSector} • Severity: {item.signal.severity}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border shrink-0",
                          item.matched
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                            : "bg-muted border-border text-muted-foreground"
                        )}
                      >
                        {item.matched ? "Matched" : "No Match"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Policy Definitions View */}
        {activeTab === 'policy' && (
          <div className="p-6 md:p-8 space-y-6 overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Active Governance Matrix &amp; Execution Policies
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enforced guardrails, tenant isolation barriers, and Multi-Attribute Utility Function (MAUF) parameters.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-primary font-semibold text-xs">
                  <SlidersHorizontal className="w-4 h-4" />
                  <span>Execution Policy: HIGHEST_PRIORITY_MAUF</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When multiple rules match the same incoming event, the rule engine computes a composite multi-attribute utility score combining rule priority weight, spatial proximity score, and confidence.
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Configured Delivery Mode &amp; Cooldown</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Active Delivery: <span className="font-mono text-foreground font-semibold uppercase">{deliveryMode}</span></p>
                  <p>Suppression Cooldown: <span className="font-mono text-foreground font-semibold">{cooldownMinutes} minutes</span> between dispatches.</p>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs">
                  <Shield className="w-4 h-4" />
                  <span>Tenant Isolation Boundary</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All rules are strictly scoped to the active organization ID via <code className="font-mono text-foreground">rule_suites.organization_id</code>. Cross-tenant evaluations are blocked at the middleware gateway.
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                  <Zap className="w-4 h-4" />
                  <span>Epistemic Confidence Floor</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Minimum confidence floor of <span className="font-mono text-foreground font-semibold">0.70</span> is required before automated response playbooks can trigger unassisted Project Studio cycle execution.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Evaluation Logs View */}
        {activeTab === 'logs' && (
          <div className="p-6 md:p-8 space-y-4 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Real-time Rule Evaluation Stream
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Trace execution history, matched branches, and condition resolution logs for suite <code className="text-primary font-mono">{RULE_SUITE_ID}</code>.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Outcome filter */}
                <div className="flex items-center gap-1 text-xs">
                  {(['all', 'matched', 'no_match', 'error'] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      onClick={() => setAuditOutcomeFilter(outcome)}
                      className={cn(
                        "rounded px-2 py-0.5 font-medium capitalize transition-colors text-[11px] border",
                        auditOutcomeFilter === outcome
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-transparent text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {outcome}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => refetchAudits()}
                  disabled={auditsLoading}
                  data-testid="btn-refresh-audits"
                  className="rounded border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1"
                >
                  <Activity className={cn("w-3 h-3 text-primary", auditsLoading && "animate-spin")} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {auditsLoading && auditLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                <Activity className="w-6 h-6 animate-spin text-primary mb-2" />
                <p className="text-xs">Fetching rule evaluation audits…</p>
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center space-y-2">
                <Clock className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-semibold text-foreground">No evaluation audits recorded yet</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Evaluation events are recorded whenever live incoming signals are evaluated against deployed rules in suite <code className="font-mono text-primary">{RULE_SUITE_ID}</code>.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('simulation')}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline font-semibold"
                >
                  <Play className="w-3 h-3" />
                  Run a Test Simulation
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border/50 border border-border/70 rounded-xl overflow-hidden text-xs">
                {auditLogs.map((audit: any, idx: number) => {
                  const isMatch = audit.outcome === 'matched';
                  const isErr = audit.outcome === 'error';
                  return (
                    <div key={audit.id || idx} className="p-3 bg-card/60 hover:bg-muted/40 transition-colors flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider border",
                              isMatch
                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                                : isErr
                                ? "bg-destructive/15 border-destructive/40 text-destructive"
                                : "bg-muted border-border text-muted-foreground"
                            )}
                          >
                            {audit.outcome}
                          </span>
                          <span className="font-semibold text-foreground font-mono text-[11px]">
                            {audit.ruleId || 'default-rule'}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Evaluated {new Date(audit.executedAt).toLocaleString()}
                        </p>
                      </div>

                      <div className="text-right text-[11px] font-mono">
                        {audit.payload?.masterPriorityScore && (
                          <span className="text-primary font-semibold">
                            Score: {audit.payload.masterPriorityScore}
                          </span>
                        )}
                        {audit.payload?.disposition && (
                          <span className="text-muted-foreground ml-2">
                            ({audit.payload.disposition})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enhanced Add/Edit Filter Modal with Smart Dropdowns */}
      {editingCondition && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 text-foreground">
            <h3 className="text-lg font-bold text-foreground">Add Custom Filter Condition</h3>
            
            {/* Field Selection */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Target Field</label>
              <select
                value={editField}
                onChange={(e) => {
                  setEditField(e.target.value);
                  const found = COMMON_FIELDS.find((f) => f.value === e.target.value);
                  if (found && found.options.length > 0) setEditVal(found.options[0]);
                }}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                data-testid="rule-condition-field"
              >
                {COMMON_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label} ({f.value})
                  </option>
                ))}
              </select>
            </div>

            {/* Operator Selection */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Operator</label>
              {/*
                Values here must be spellings `normalizeOperator` accepts.
                "greater_than_or_equals" (plural) was not one of them: it
                normalised to null, so a rule authored with "is greater or
                equal" could never match and nothing surfaced why. The
                less-than operators were also absent entirely, leaving no way
                to express a ceiling.
              */}
              <select
                value={editOp}
                onChange={(e) => setEditOp(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                data-testid="rule-condition-operator"
              >
                <option value="equals">equals (==)</option>
                <option value="not_equals">does not equal (!=)</option>
                <option value="greater_than">is greater than (&gt;)</option>
                <option value="greater_than_or_equal">is greater or equal (&gt;=)</option>
                <option value="less_than">is less than (&lt;)</option>
                <option value="less_than_or_equal">is less or equal (&lt;=)</option>
                <option value="contains">contains</option>
                <option value="in">is in set (in)</option>
                <option value="not_in">is not in set (not in)</option>
              </select>
            </div>

            {/* Value Selection with Smart Suggestions */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Value</label>
              {selectedFieldObj && selectedFieldObj.options.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {selectedFieldObj.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Or enter custom value..."
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    data-testid="rule-condition-value"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  data-testid="rule-condition-value"
                />
              )}
            </div>

            {/* Rule Display Name */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Rule Display Name / Label (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Critical Defense Sector Filter"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={() => {
                  setEditingCondition(null);
                  setEditLabel('');
                }}
                className="px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-muted text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const labelToUse = editLabel.trim() || `${editField} ${editOp} "${editVal}"`;
                  const newCond: ConditionRule = {
                    id: `cond-custom-${Date.now()}`,
                    type: 'condition',
                    field: editField,
                    operator: editOp,
                    value: editVal,
                    label: labelToUse,
                  };
                  addConditionToGroup(editingCondition.groupId, newCond);
                  setEditingCondition(null);
                  setEditLabel('');
                }}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
                data-testid="rule-condition-confirm"
              >
                Add Filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The H3 palette used to be a full-screen modal here. It now renders
          inside the tools tray — see `openSpatialPalette` — so the map sits
          beside the rule it is being attached to instead of covering it. */}
    </div>
  );
}

export default RuleBuilder;
