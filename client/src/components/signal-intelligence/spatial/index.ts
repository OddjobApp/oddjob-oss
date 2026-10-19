/**
 * Signal Intelligence — spatial surface barrel.
 *
 * Consumers live in BOTH frontend roots: `client/src` and the routers under
 * `server/domain/core/ui/components/routing/`, which import through the `@/`
 * alias. Exporting from one place keeps those two in step.
 */

// --- Rule authoring ---------------------------------------------------------
export { RuleBuilder } from './RuleBuilder';
export type { ConditionRule, ConditionGroup } from './RuleBuilder';
export { RuleBuilderModal } from './RuleBuilderModal';
export { RuleTemplates } from './RuleTemplates';

export { EvaluatorConfigDrawer } from './EvaluatorConfigDrawer';
export type { EvaluatorConfig } from './EvaluatorConfigDrawer';

export { SpatialConditionEditor, buildPreview } from './SpatialConditionEditor';

// --- H3 map palette ---------------------------------------------------------
export {
  H3SpatialPalette,
  WebMercatorProjectionSystem,
  STRATEGIC_SECTOR_PRESETS,
  parseNaturalLanguageGeofence,
  parseGeoJsonPolygon,
  tessellatePolygonToH3,
  parseCoordinateQuery,
  defaultMapCenter,
} from './H3SpatialPalette';
export type {
  SpatialRegionSelection,
  StrategicSectorPreset,
  MetricOverlayMode,
  SignalTelemetryItem,
} from './H3SpatialPalette';

// --- Rule tree → engine specification ---------------------------------------
export {
  buildRuleSpecification,
  buildThenAction,
  toDnf,
  toEngineCondition,
  slugifyRuleId,
  RuleConversionError,
  MAX_DNF_CLAUSES,
} from './rule-tree-to-spec';
export type { EngineCondition, BuildSpecOptions } from './rule-tree-to-spec';

// --- Workflow pages & views -------------------------------------------------
export { default as WorkflowEditPage } from './WorkflowEditPage';
export { default as SignalIntelligenceWizard } from './SignalIntelligenceWizard';
export { WorkflowDetailView } from './WorkflowDetailView';
export { WorkflowSummaryCard } from './WorkflowSummaryCard';
export { default as WorkflowHistoryPage } from './WorkflowHistoryPage';

// --- Panels & views ---------------------------------------------------------
export { SignalFeedPanel } from './SignalFeedPanel';
export { SignalDetectionPanel } from './SignalDetectionPanel';
export { EntityDetailPanel } from './EntityDetailPanel';
export { ActionSelectionPanel } from './ActionSelectionPanel';
export { ActionTimeline } from './ActionTimeline';
export { ActionConfirmation } from './ActionConfirmation';
export { BulkActionToolbar } from './BulkActionToolbar';
export { CycleLaunchPanel } from './CycleLaunchPanel';
export { ImpactVisualization } from './ImpactVisualization';
export { GraphView } from './GraphView';
export { EventStreamView } from './EventStreamView';
export { EventBackboneView } from './EventBackboneView';
export { EventSourceCatalog } from './EventSourceCatalog';
export { EventSourceWizard } from './EventSourceWizard';
export { ScenariosView } from './ScenariosView';
export { SourcesView } from './SourcesView';
export { SubscriptionsView } from './SubscriptionsView';
export { SimplifiedSubscriptionFlow } from './SimplifiedSubscriptionFlow';

// --- Shell & chrome ---------------------------------------------------------
export { ViewContainer } from './ViewContainer';
export { ViewSwitcher } from './ViewSwitcher';
export { SlideOverPanel } from './SlideOverPanel';
export { EmptyState } from './EmptyState';
export { FreshnessIndicator } from './FreshnessIndicator';
export { ContextualTooltip } from './ContextualTooltip';
export { OnboardingOverlay } from './OnboardingOverlay';
export { WizardNavigation } from './WizardNavigation';
export { WizardProvider, useWizard } from './WizardContext';
export type { WizardAction, WizardState } from './WizardContext';

// --- Hooks ------------------------------------------------------------------
export { useSignalAction } from './useSignalAction';
export { useSseConnection } from './useSseConnection';
export { useBulkActions } from './use-bulk-actions';
