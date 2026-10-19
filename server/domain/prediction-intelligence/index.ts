// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — Public Barrel
// ============================================================================

// Quant Pod
export * from "./quant/types.js";
export { quantPod } from "./quant/quant-pod.service.js";
export type { QuantPod } from "./quant/quant-pod.service.js";

// Quant Plugins
export { registerAllQuantPlugins, registerQuantPlugins } from "./quant/plugins/index.js";
export {
    quantGeneratorPlugin, quantEpistemicPlugin,
    quantTrajectoryPlugin,
    quantResonancePlugin, quantInterferencePlugin,
    quantRelationshipPlugin,
    quantFieldSummaryPlugin,
    quantBranchInfluencePlugin, quantHiddenStateInfluencePlugin,
    quantDecayPlugin, quantCollapseDetectorPlugin,
} from "./quant/plugins/index.js";

// Plugin Runtime Pod — all public contracts (explicit to avoid Provenance name clash with quant/types.ts)
export type {
    ExecutionMode, LatencyClass, ExecutionModeSpec, PluginType, RolloutStatus,
    TraceContext, PluginManifest, PluginDecision, PluginContext,
    PluginWarning, PluginError, PluginMetrics, PluginStatus,
    PluginResult, PluginExplanation, PluginHealth, PluginHealthStatus,
    PodHealth, PodCapability, PluginRuntimeHealth, PluginPolicyDecision,
    PredictionPlugin, SubPodPlugin,
    PluginExecutionRequest, PluginExecutionResponse,
    PluginRegistryEntry, PluginFilter, PluginRuntimePort,
    StorageReadQuery, StorageWriteCommand, StorageWriteResult, StorageTransaction,
    VectorPort, VectorSearchInput, VectorSearchResult, VectorUpsertInput, VectorUpsertResult,
    VectorDeleteInput, VectorDeleteResult,
    GraphPath, GraphEdgeInput, GraphEdgeResult,
    CachePort, EventBusPort,
    AgentAssistRequest, AgentAssistResult,
    DomainPod,
} from "./plugin-runtime/types.js";


export { pluginRegistry } from "./plugin-runtime/plugin-registry.js";
export { pluginExecutor } from "./plugin-runtime/plugin-executor.js";
export { pluginRuntime, createPluginContext } from "./plugin-runtime/plugin-runtime.js";
export type { PluginRuntime } from "./plugin-runtime/plugin-runtime.js";

// Realm Mesh Pod — types
export type {
    RealmContribution,
    RealmName,
    RealmEffect,
    RealmTargetType,
    RealmWarning,
    BranchConstraintType,
    BranchConstraint,
    RealmExecutionPlan,
    RealmExecutionTrace,
    RealmAgreementScore,
    RealmConflictAction,
    RealmConflictReport,
    WindowSummary as RealmWindowSummary,
    PredictionBranch as RealmPredictionBranch,
    HiddenStateEstimate as RealmHiddenStateEstimate,
    QuantRealmInput,
    QuantRealmOutput,
    EventRealmInput,
    EventRealmOutput,
    BranchRealmInput,
    BranchRealmOutput,
    HiddenStateRealmInput,
    HiddenStateRealmOutput,
    RealmPlugin,
    RealmQuantProcessingInput,
    RealmEventProcessingInput,
    RealmBranchContributionInput,
    RealmBranchContributionResult,
    RealmHiddenStateContributionInput,
    RealmHiddenStateContributionResult,
    RealmAgreementInput,
    RealmConflictInput,
    RealmProcessingResult,
    RealmMeshPort,
} from "./realm-mesh/types.js";

// Realm Mesh Pod — service
export { realmMesh } from "./realm-mesh/realm-mesh.service.js";
export type { RealmMesh } from "./realm-mesh/realm-mesh.service.js";

// Realm Mesh Plugins — registration
// Prediction Pod
export * from "./prediction/types.js";
export { predictionPod } from "./prediction/prediction-pod.service.js";
export type { PredictionPod } from "./prediction/prediction-pod.service.js";

// Prediction Plugins
export { registerAllPredictionPlugins } from "./prediction/plugins/index.js";
export {
    predictionModePlannerPlugin,
    predicateGeneratorPlugin,
    branchGeneratorPlugin,
    forwardChamberPlugin,
    predictionEntropyPlugin,
    predictionConfidencePlugin,
    predictionContractPlugin,
} from "./prediction/plugins/index.js";

export { registerAllRealmPlugins } from "./realm-mesh/plugins/index.js";
export {
    realmExecutionPlannerPlugin, temporalRealmPlugin, semanticRealmPlugin,
    epistemicRealmPlugin, attentionRealmPlugin, realmAggregatorPlugin, realmAgreementPlugin,
} from "./realm-mesh/plugins/index.js";

// Explanation Pod
export type {
    ExplanationType,
    ExplanationAudience,
    ExplanationEvidence,
    QuantContribution,
    ExplanationRealmContribution,
    HiddenStateNarrative,
    BranchNarrative,
    CausalNarrative,
    EpistemicNarrative,
    GovernanceNarrative,
    ConfidenceNarrative,
    EntropyNarrative,
    CounterfactualExplanation,
    CalibrationNarrative,
    ExplanationRedaction,
    PredictionExplanation,
    PredictionDiffExplanation,
    RenderedExplanation,
    PredictionExplanationInput,
    BranchExplanationInput,
    HiddenStateExplanationInput,
    CounterfactualInput,
    PredictionDiffInput,
    ExplanationRenderInput,
    ExplanationPort,
} from "./explanation/types.js";
export { explanationPod } from "./explanation/explanation-pod.service.js";
export type { ExplanationPod } from "./explanation/explanation-pod.service.js";

// Calibration Pod
export type {
    ObservedOutcome,
    OutcomeMatchType,
    OutcomeMatch,
    TrueBranchStatus,
    CalibrationOutcome,
    CalibrationSignalTargetType,
    CalibrationSignalType,
    CalibrationSignal,
    CalibrationErrorType,
    CalibrationErrorAnalysis,
    CalibrationReport,
    OutcomeIntakeInput,
    OutcomeMatchingInput,
    PredictionCalibrationInput,
    CalibrationErrorAnalysisInput,
    CalibrationSignalInput,
    CalibrationReplayInput,
    CalibrationReplayResult,
    CalibrationReportInput,
    OutcomeMatchingPluginInput,
    PredictionAccuracyPluginInput,
    FalsePruneDetectorPluginInput,
    ConfidenceCalibrationPluginInput,
    CalibrationPort,
} from "./calibration/types.js";
export { OVERCONFIDENCE_THRESHOLD, UNDERCONFIDENCE_THRESHOLD, LUCKY_CORRECT_THRESHOLD, SEMANTIC_SYNONYM_PAIRS } from "./calibration/types.js";
export { calibrationPod } from "./calibration/calibration-pod.service.js";
export type { CalibrationPod } from "./calibration/calibration-pod.service.js";
export { registerAllCalibrationPlugins } from "./calibration/plugins/index.js";
export {
    outcomeIntakePlugin,
    outcomeMatchingPlugin,
    predictionAccuracyPlugin,
    falsePruneDetectorPlugin,
    confidenceCalibrationPlugin,
} from "./calibration/plugins/index.js";

// Governance Pod
export type {
    GovernanceDecisionType,
    ActionAuthorityLevel,
    RiskClass,
    GovernanceRedaction,
    GovernanceConstraintType,
    GovernanceConstraint,
    PolicyTrace,
    GovernanceDecision,
    GovernanceSubject,
    GovernanceActionType,
    GovernanceAction,
    GovernanceResource,
    GovernanceEvaluationInput,
    PolicyEvaluationInput,
    ActionAuthorizationInput,
    MemoryGovernanceInput,
    AgentGovernanceInput,
    RiskClassificationInput,
    RiskClassificationResult,
    GovernanceSimulationInput,
    GovernanceSimulationResult,
    TenantIsolationPluginInput,
    SensitivityEnforcementPluginInput,
    ConfidenceGatingPluginInput,
    GovernancePort,
} from "./governance/types.js";
export { CURRENT_POLICY_VERSION, CONFIDENCE_GATE, MAX_AUTHORITY_BY_RISK, ACTION_AUTHORITY_RANK, RISK_CLASS_RANK } from "./governance/types.js";
export { governancePod } from "./governance/governance-pod.service.js";
export type { GovernancePod } from "./governance/governance-pod.service.js";
export { registerAllGovernancePlugins } from "./governance/plugins/index.js";
export {
    tenantIsolationPlugin,
    sensitivityEnforcementPlugin,
    riskClassificationPlugin,
    confidenceGatingPlugin,
    actionAuthorizationPlugin,
    policyEnginePlugin,
} from "./governance/plugins/index.js";

// Diff Pod
export type {
    DiffType,
    DiffRecord,
    DiffTriggerType,
    DiffTrigger,
    DiffResult,
    DriftResult,
    SignificanceResult,
    DiffInput,
    QuantFieldDiffInput,
    HiddenStateDiffInput,
    GraphDiffForDiffPodInput,
    DriftInput,
    SignificanceInput,
    EventSummary,
    EventDiffPluginInput,
    QuantDiffPluginInput,
    QuantFieldDiffPluginInput,
    HiddenStateDiffPluginInput,
    VelocityPluginInput,
    SignificanceScoringPluginInput,
    DiffTriggerPluginInput,
    DiffPort,
} from "./diff/types.js";
export { PREDICTION_IMPACT_WEIGHT, SIGNIFICANCE_THRESHOLD, DRIFT_WINDOW_MS, DIFF_EPSILON } from "./diff/types.js";
export { diffPod } from "./diff/diff-pod.service.js";
export type { DiffPod } from "./diff/diff-pod.service.js";
export { registerAllDiffPlugins } from "./diff/plugins/index.js";
export {
    eventDiffPlugin,
    quantDiffPlugin,
    hiddenStateDiffPlugin,
    velocityPlugin,
    significanceScoringPlugin,
    diffTriggerPlugin,
} from "./diff/plugins/index.js";

// Hidden State Pod
export type {
    HiddenStateType,
    HiddenStateCandidate,
    HiddenStateEstimate,
    HiddenStateTransitionType,
    HiddenStateTransition,
    AttractorAlignment,
    HiddenStateSplit,
    HiddenStateCollapseSignal,
    HiddenStateOutputEffect,
    HiddenStateInfluence as HiddenStateOutputInfluence,
    HiddenStateCandidatePluginInput,
    HiddenStateScoringPluginInput,
    HiddenStateEntropyPluginInput,
    HiddenStateEntropyResult,
    HiddenStatePersistencePluginInput,
    HiddenStatePersistenceResult,
    HiddenStateInfluencePluginInput,
    HiddenStateEstimateInput,
    HiddenStateCandidateInput,
    HiddenStateScoringInput,
    HiddenStateTransitionInput,
    HiddenStateSplitInput,
    HiddenStateCollapseInput,
    HiddenStateInfluenceInput,
    HiddenStatePort,
} from "./hidden-state/types.js";
export { CANDIDATE_LIMITS, QUANT_TYPE_TO_STATE, EVENT_LABEL_KEYWORDS, HS_EPSILON } from "./hidden-state/types.js";
export { hiddenStatePod } from "./hidden-state/hidden-state-pod.service.js";
export type { HiddenStatePod } from "./hidden-state/hidden-state-pod.service.js";
export { registerAllHiddenStatePlugins } from "./hidden-state/plugins/index.js";
export {
    hiddenStateCandidatePlugin,
    hiddenStateScorerPlugin,
    hiddenStateEntropyPlugin,
    hiddenStatePersistencePlugin,
    hiddenStateInfluencePlugin,
} from "./hidden-state/plugins/index.js";

// Graph Pod
export type {
    GraphNodeType,
    GraphEdgeType,
    GraphNode,
    GraphEdge,
    GraphNeighborhood,
    RelationshipPath,
    GraphFeatureSet,
    GraphDiffChangeType,
    GraphDiffChange,
    GraphDiff,
    GraphSnapshot,
    GraphProjection,
    UpsertGraphNodeInput,
    UpsertGraphEdgeInput,
    GraphNeighborInput,
    GraphPathInput,
    GraphFeatureInput,
    GraphDiffInput,
    GraphProjectionInput,
    GraphSnapshotInput,
    EventGraphPluginInput,
    QuantGraphPluginInput,
    BranchGraphPluginInput,
    GraphTraversalPluginInput,
    GraphFeaturePluginInput,
    GraphPort,
} from "./graph/types.js";
export { GRAPH_DEPTH_LIMITS, GRAPH_EPSILON } from "./graph/types.js";
export { graphPod } from "./graph/graph-pod.service.js";
export type { GraphPod } from "./graph/graph-pod.service.js";
export { registerAllGraphPlugins } from "./graph/plugins/index.js";
export {
    eventGraphPlugin,
    quantGraphPlugin,
    branchGraphPlugin,
    graphTraversalPlugin,
    graphFeatureExtractorPlugin,
} from "./graph/plugins/index.js";

// Memory Pod
export type {
    MemoryType,
    PatternType,
    AttractorType,
    HistoricalOutcomeSummary,
    PatternMemory,
    AttractorMemory,
    HistoricalOutcome,
    BaselineMemory,
    MemoryRecallResult,
    MemoryRecallInput,
    ShortTermMemoryPluginInput,
    PatternMemoryPluginInput,
    BaselineMemoryPluginInput,
    OutcomeMemoryPluginInput,
    AttractorMemoryPluginInput,
    MemoryRecallScorerInput,
    StorePatternInput,
    StoreOutcomeInput,
    BaselineRecallInput,
    AttractorRecallInput,
    MemoryConsolidationInput,
    MemoryConsolidationResult,
    MemoryDecayInput,
    MemoryDecayResult,
    MemoryPort,
} from "./memory/types.js";
export { MEMORY_LIMITS, QDRANT_COLLECTIONS, MEMORY_EPSILON, MEMORY_DECAY_LAMBDA } from "./memory/types.js";
export { memoryPod } from "./memory/memory-pod.service.js";
export type { MemoryPod } from "./memory/memory-pod.service.js";
export { registerAllMemoryPlugins } from "./memory/plugins/index.js";
export {
    shortTermMemoryPlugin,
    patternMemoryPlugin,
    baselineMemoryPlugin,
    outcomeMemoryPlugin,
    attractorMemoryPlugin,
    memoryRecallScorerPlugin,
} from "./memory/plugins/index.js";

// Pruning Pod
export type {
    BranchStatus,
    BranchScoreBreakdown,
    SuppressionDecision,
    BranchMergeDecision,
    BranchGenealogyEventType,
    BranchGenealogyEvent,
    PruningDecisionType,
    PruningDecision,
    PruningResult,
    PruningInput,
    BranchScoringInput,
    HardPruneInput,
    SoftSuppressionInput,
    AnomalyReserveInput,
    EntropyPruningInput,
    BranchGenealogyInput,
    BranchMergeInput,
    PruningPort,
} from "./pruning/types.js";
export { BRANCH_LIMITS, CONSEQUENCE_LABELS, PRUNING_EPSILON } from "./pruning/types.js";
export { pruningPod } from "./pruning/pruning-pod.service.js";
export type { PruningPod } from "./pruning/pruning-pod.service.js";
export { registerAllPruningPlugins } from "./pruning/plugins/index.js";
export {
    branchScoringPlugin,
    hardPrunePlugin,
    softSuppressionPlugin,
    anomalyReservePlugin,
    entropyPruningPlugin,
    branchGenealogyPlugin,
} from "./pruning/plugins/index.js";

// Canonical Event Pod
export type {
    EventKind,
    EventClassification,
    SensitivityLevel,
    SensitivityCategory,
    SensitivityProfile,
    EventLineage,
    CanonicalEventProvenance,
    EventRepairType,
    EventRepairInfo,
    EventRejectionInfo,
    CanonicalEvent as PredictionCanonicalEvent,
    RawEventEnvelope,
    ValidationError,
    ValidationWarning,
    ValidationReport,
    RedactionResult,
    CanonicalEventResult,
    EventCorrectionInput,
    EventRetractionInput,
    DeduplicationCandidate,
    EventNormalizationRule,
    CanonicalEventPort,
} from "./canonical-event/types.js";
export { SOURCE_ACTION_MAP, SENSITIVE_FIELD_PATTERNS, MAX_PAYLOAD_SIZE_BYTES, SCHEMA_VERSION } from "./canonical-event/types.js";
export { canonicalEventService } from "./canonical-event/canonical-event.service.js";
export type { CanonicalEventService } from "./canonical-event/canonical-event.service.js";
export { missionEventBridge } from "./canonical-event/mission-event-bridge.js";

// Context Pod
export type {
    ContextType,
    ContextStatus,
    ContextRelationType,
    ContextPermissions,
    ContextProvenance,
    PredictionContext as ManagedPredictionContext,
    ContextCandidate,
    ContextResolutionResult,
    ContextResolutionInput,
    ContextCreationInput,
    ContextLifecycleInput,
    ContextMergeInput,
    ContextSplitInput,
    ContextScope,
    LegacyContextPort,
    ContextPort,
} from "./context/types.js";
export { DEFAULT_CONTEXT_PERMISSIONS, CONTEXT_IDLE_TIMEOUT_MS, CONTEXT_CLOSE_TIMEOUT_MS, CANDIDATE_SCORE_THRESHOLD } from "./context/types.js";
export { contextService } from "./context/context.service.js";
export type { ContextService } from "./context/context.service.js";
export { registerAllContextPlugins } from "./context/plugins/index.js";
export {
    contextCandidateGeneratorPlugin,
    contextScorerPlugin,
    contextCreatorPlugin,
    contextLifecyclePlugin,
} from "./context/plugins/index.js";

// Temporal / Windowing Pod
export type {
    WindowType,
    DensityMode,
    TemporalRelation,
    WindowSummary,
    TemporalFeatures,
    ActiveWindowSet,
    BurstDetectionResult,
    SilenceDetectionResult,
    TemporalValidityResult,
    TimestampNormalizationInput,
    TimestampNormalizationResult,
    EventSequencingInput,
    EventSequenceResult,
    WindowAssignmentInput,
    WindowSummaryInput,
    TemporalFeatureInput,
    BurstDetectionInput,
    SilenceDetectionInput,
    TemporalValidityInput,
    RollingWindowPluginInput,
    DensityModePluginInput,
    RecencyScoringPluginInput,
    FrequencyScoringPluginInput,
    Window,
    WindowConfig,
    WindowingPort,
    TemporalWindowingPort,
} from "./windowing/types.js";
export { ROLLING_WINDOW_DURATIONS, DEFAULT_RECENCY_LAMBDA, BURST_RATIO_THRESHOLD, SILENCE_RATIO_THRESHOLD, TEMPORAL_EPSILON } from "./windowing/types.js";
export { windowingService } from "./windowing/windowing.service.js";
export type { WindowingService } from "./windowing/windowing.service.js";
export { registerAllWindowingPlugins } from "./windowing/plugins/index.js";
export {
    timestampNormalizerPlugin,
    eventSequencerPlugin,
    rollingWindowPlugin,
    densityModePlugin,
    recencyScoringPlugin,
    frequencyScoringPlugin,
    burstDetectionPlugin,
    silenceDetectionPlugin,
} from "./windowing/plugins/index.js";

// Storage Pod
export type {
    StorageObject, TemporalRecord, VectorRecord, Snapshot,
    PersistInput, PersistResult, RetrieveInput, RetrieveResult,
    QueryInput, QueryResult, SnapshotInput,
    ReplayInput, ReplayResult, StorageDiffInput, StorageDiffResult,
    ArchiveInput, ArchiveResult, StoragePort,
} from "./storage/types.js";
export { STORAGE_QDRANT_COLLECTIONS } from "./storage/types.js";
export { storagePod } from "./storage/storage-pod.service.js";
export type { StoragePod } from "./storage/storage-pod.service.js";

// Observability Pod
export type {
    TelemetrySeverity, TelemetrySource, TraceStatus, TraceStageType,
    TelemetryEvent, TraceStage, PredictionTrace, BranchLifecycleEvent,
    MetricsResult, ObservabilityQueryResult, StateReconstructionResult,
    TelemetryInput, TraceInput, ObservabilityQueryInput,
    StateReconstructionInput, AlertInput, MetricsInput, ObservabilityPort,
} from "./observability/types.js";
export { observabilityPod } from "./observability/observability-pod.service.js";
export type { ObservabilityPod } from "./observability/observability-pod.service.js";

// Agent Assist Pod
export type {
    AgentType, AgentPriority, AgentExecutionStatus, AgentGovernanceLevel, AgentOutputType,
    AgentConstraints, AgentTask, AgentTrace, AgentOutput, AgentExecution, AgentExplanation,
    AgentTaskInput, AgentValidationInput, ValidationResult as AgentValidationResult,
    MultiAgentInput, MultiAgentResult, AgentReplayInput, AgentAssistPort,
} from "./agent-assist/types.js";
export { DEFAULT_AGENT_CONSTRAINTS } from "./agent-assist/types.js";
export { agentAssistPod } from "./agent-assist/agent-assist-pod.service.js";
export type { AgentAssistPod } from "./agent-assist/agent-assist-pod.service.js";

// API Pod
export type {
    ApiRequestMode, ApiStatus, ApiErrorCategory,
    ApiRequestOptions, ApiRequestEnvelope, ApiError, ApiWarning,
    PaginationInfo, ApiTraceSummary, ApiResponseEnvelope, HealthResponse,
    CreateEventRequest, CreateEventResponse, CreatePredictionRequest,
    OutcomeIntakeApiRequest, HttpRequest, HttpResponse,
    StreamRequest, StreamHandle, ApiRuntimeContext, ApiPodPort,
} from "./api/types.js";
export { CURRENT_API_VERSION } from "./api/types.js";
export { apiPod } from "./api/api-pod.service.js";
export type { ApiPod } from "./api/api-pod.service.js";
