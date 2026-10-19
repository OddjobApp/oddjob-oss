import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { Loader2 } from "lucide-react";
import Layout from "@domain-ui/core/ui/components/layout/Layout";

// ControlOverview is the primary landing page of this SPA — load it eagerly so
// navigating to /control never shows a multi-second Suspense spinner in dev mode.
import ControlOverview from "@/modules/control/pages/ControlOverview";

// Fallback loading component
function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
    </div>
  );
}

// ============================================================================
// INTELLIGENCE DOMAIN PAGES
// ============================================================================

const ROIAnalytics = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/ROIAnalytics"));
const CostDashboard = lazy(() => import("@domain-ui/core/ui/modules/pages/CostDashboard"));
const AssistantWorkbench = lazy(() => import("@domain-ui/core/ui/modules/pages/AssistantWorkbench"));
const InsightsOverview = lazy(() => import("@/modules/insights/pages/InsightsOverview"));
const GovernanceDashboard = lazy(() => import("@domain-ui/governor/ui/modules/governance/pages/GovernanceDashboard"));
const ImprovementInbox = lazy(() => import("@domain-ui/improvement/ui/modules/improvement/pages/ImprovementInbox"));
const PolicyManager = lazy(() => import("@domain-ui/governor/ui/modules/governance/pages/PolicyManager"));
const PolicyEditor = lazy(() => import("@domain-ui/governor/ui/modules/governance/pages/PolicyEditor"));
const OverrideVisualizer = lazy(() => import("@domain-ui/governor/ui/modules/governance/pages/OverrideVisualizer"));
const AgentIdentityControl = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/AgentIdentityControl"));
const PredictiveDashboardPage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/PredictiveDashboard"));
const FailurePredictionsPage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/FailurePredictions"));
const ResourceOptimizationPage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/ResourceOptimization"));
const WorkflowIntelligencePage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/WorkflowIntelligence"));
const PredictiveMonitoringPage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/PredictiveMonitoring"));
const PredictiveConfigPage = lazy(() => import("@domain-ui/analytics/ui/modules/analytics/pages/PredictiveConfig"));
const AgentAnalyticsView = lazy(() => import("@domain-ui/ai/ui/modules/agent-ai/pages/AgentAnalyticsView"));
const AgentAnalyticsDashboard = lazy(() => import("@domain-ui/ai/ui/modules/agent-ai/pages/AgentAnalyticsDashboard").then(m => ({ default: m.AgentAnalyticsDashboard })));
const PredictionIntelligenceDashboard = lazy(() => import("@/modules/operations/pages/PredictionIntelligenceDashboard"));
const BIScoringDashboard = lazy(() => import("@domain-ui/analytics/ui/modules/scoring/pages/ScoringDashboard"));
const BIModelDetail = lazy(() => import("@domain-ui/analytics/ui/modules/scoring/pages/ModelDetail"));
const BILiveScores = lazy(() => import("@domain-ui/analytics/ui/modules/scoring/pages/LiveScores"));
const BISignalInspector = lazy(() => import("@domain-ui/analytics/ui/modules/scoring/pages/SignalInspector"));

// ============================================================================
// OBSERVABILITY DOMAIN PAGES (merged from ObservabilityRouting)
// ============================================================================

const AlertsPage = lazy(() => import("@domain-ui/analytics/ui/modules/observability/pages/Alerts"));
const EventsPage = lazy(() => import("@domain-ui/analytics/ui/modules/observability/pages/Events"));
const MonitoringPage = lazy(() => import("@domain-ui/analytics/ui/modules/observability/pages/Monitoring"));
const UnifiedObservability = lazy(() => import("@domain-ui/analytics/ui/modules/observability/pages/UnifiedObservability"));
const SystemPulse = lazy(() => import("@domain-ui/analytics/ui/modules/observability/pages/SystemPulse"));
const ErrorDiagnoses = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/ErrorDiagnoses"));
const InfraHealth = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/InfraHealth"));
const HealthOverview = lazy(() => import("@/modules/health/pages/HealthOverview"));
const TestHealthDashboard = lazy(() => import("@/modules/health/pages/TestHealthDashboard"));
const ChaosEngineeringPanel = lazy(() => import("@domain-ui/core/ui/modules/pages/ChaosEngineeringPanel"));

// Signal Intelligence
const SignalDashboardPage = lazy(() => import("@/components/signal-intelligence/SignalDashboard"));
const SignalIntelligenceWizardPage = lazy(() => import("@/components/signal-intelligence/spatial/SignalIntelligenceWizard"));
const WorkflowHistoryPage = lazy(() => import("@/components/signal-intelligence/spatial/WorkflowHistoryPage"));
const WorkflowDetailPage = lazy(() => import("@/components/signal-intelligence/spatial/WorkflowDetailView"));
const WorkflowEditPage = lazy(() => import("@/components/signal-intelligence/spatial/WorkflowEditPage"));

// Other shared
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

// Agent Memory redirect — canonical path is now /armory/run-memory (Requirement 6.2, 6.5)
function AgentMemoryRedirect() {
  React.useEffect(() => {
    window.location.replace('/armory/run-memory' + window.location.search + window.location.hash);
  }, []);
  return null;
}

/**
 * IntelligenceRouting handles the routes specifically for the AI Intelligence SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 */
export function IntelligenceRouting() {
  return (
    <OrgProvider>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            {/* Mach 3 Multi-SPA Ejection Failsafes */}
            <Route path="/"><Reload /></Route>
            <Route path="/launchpad"><Reload /></Route>
            <Route path="/launch"><Reload /></Route>
            <Route path="/auth"><Reload /></Route>
            <Route path="/auth/:rest*"><Reload /></Route>
            <Route path="/app"><Reload /></Route>
            <Route path="/app/:rest*"><Reload /></Route>
            <Route path="/a"><Reload /></Route>
            <Route path="/a/:rest*"><Reload /></Route>
            <Route path="/r"><Reload /></Route>
            <Route path="/r/:rest*"><Reload /></Route>
            <Route path="/h"><Reload /></Route>
            <Route path="/h/:rest*"><Reload /></Route>
            <Route path="/external"><Reload /></Route>
            <Route path="/external/:rest*"><Reload /></Route>
            <Route path="/hil-form"><Reload /></Route>
            <Route path="/hil-form/:rest*"><Reload /></Route>
            <Route path="/trust"><Reload /></Route>
            <Route path="/trust/:rest*"><Reload /></Route>
            <Route path="/armory"><Reload /></Route>
            <Route path="/armory/:rest*"><Reload /></Route>
            <Route path="/apps"><Reload /></Route>
            <Route path="/apps/:rest*"><Reload /></Route>
            <Route path="/missions"><Reload /></Route>
            <Route path="/missions/:rest*"><Reload /></Route>
            <Route path="/agents"><Reload /></Route>
            <Route path="/agents/:rest*"><Reload /></Route>
            <Route path="/scheduled-agents"><Reload /></Route>
            <Route path="/scheduled-agents/:rest*"><Reload /></Route>
            <Route path="/scheduled-jobs"><Reload /></Route>
            <Route path="/scheduled-jobs/:rest*"><Reload /></Route>
            <Route path="/jobs"><Reload /></Route>
            <Route path="/jobs/:rest*"><Reload /></Route>
            <Route path="/schedules"><Reload /></Route>
            <Route path="/schedules/:rest*"><Reload /></Route>

            <Route path="/knowledge-store"><Reload /></Route>
            <Route path="/knowledge-store/:rest*"><Reload /></Route>
            <Route path="/knowledge"><Reload /></Route>
            <Route path="/knowledge/:rest*"><Reload /></Route>
            <Route path="/datasets"><Reload /></Route>
            <Route path="/datasets/:rest*"><Reload /></Route>
            
            <Route path="/pipelines"><Reload /></Route>
            <Route path="/pipelines/:rest*"><Reload /></Route>

            <Route path="/credentials"><Reload /></Route>
            <Route path="/credentials/:rest*"><Reload /></Route>
            <Route path="/connections"><Reload /></Route>
            <Route path="/connections/:rest*"><Reload /></Route>
            <Route path="/account-admin"><Reload /></Route>
            <Route path="/account-admin/:rest*"><Reload /></Route>
            <Route path="/platform-maintenance"><Reload /></Route>
            <Route path="/platform-maintenance/:rest*"><Reload /></Route>
            <Route path="/users"><Reload /></Route>
            <Route path="/users/:rest*"><Reload /></Route>
            <Route path="/settings"><Reload /></Route>
            <Route path="/settings/:rest*"><Reload /></Route>
            <Route path="/profile"><Reload /></Route>
            <Route path="/profile/:rest*"><Reload /></Route>
            <Route path="/organizations"><Reload /></Route>
            <Route path="/organizations/:rest*"><Reload /></Route>
            <Route path="/admin"><Reload /></Route>
            <Route path="/admin/:rest*"><Reload /></Route>
            <Route path="/tactics"><Reload /></Route>
            <Route path="/tactics/:rest*"><Reload /></Route>
            <Route path="/dashboard"><Reload /></Route>
            <Route path="/dashboard/:rest*"><Reload /></Route>
            <Route path="/billing"><Reload /></Route>
            <Route path="/saas"><Reload /></Route>

            {/* Insights */}
            <Route path="/insights/roi" component={ROIAnalytics} />
            <Route path="/insights/costs" component={CostDashboard} />
            <Route path="/insights/tools">
              {() => (
                <AgentAnalyticsView
                  title="Tool Analytics"
                  description="Tool usage patterns and capability invocation frequency across agent runs."
                />
              )}
            </Route>
            <Route path="/insights/agents" component={AgentAnalyticsDashboard} />
            <Route path="/insights/scoring/models/:id" component={BIModelDetail} />
            <Route path="/insights/scoring/live" component={BILiveScores} />
            <Route path="/insights/scoring/explain/:entityType/:entityId" component={BISignalInspector} />
            <Route path="/insights/scoring" component={BIScoringDashboard} />
            <Route path="/insights/prediction/dashboard" component={PredictiveDashboardPage} />
            <Route path="/insights/prediction/failures" component={FailurePredictionsPage} />
            <Route path="/insights/prediction/resources" component={ResourceOptimizationPage} />
            <Route path="/insights/prediction/workflows" component={WorkflowIntelligencePage} />
            <Route path="/insights/prediction/monitoring" component={PredictiveMonitoringPage} />
            <Route path="/insights/prediction/config" component={PredictiveConfigPage} />
            <Route path="/insights/prediction" component={PredictionIntelligenceDashboard} />
            <Route path="/insights" component={InsightsOverview} />

            {/* Signal Intelligence.
                A hard load of these paths is served operations.html (see
                isOperationsRoute in server/vite.ts), so these registrations
                exist for client-side navigation from elsewhere in this SPA
                rather than for direct entry.
                The wizard and dashboard take their own props, so they render as
                children — `component` would hand them RouteComponentProps. */}
            <Route path="/signal-intelligence/wizard">{() => <SignalIntelligenceWizardPage />}</Route>
            <Route path="/signal-intelligence/workflows/:id/edit" component={WorkflowEditPage} />
            <Route path="/signal-intelligence/workflows/:id">{() => <WorkflowDetailPage />}</Route>
            <Route path="/signal-intelligence/workflows" component={WorkflowHistoryPage} />
            <Route path="/signal-intelligence">{() => <SignalDashboardPage />}</Route>

            {/* Assistant */}
            <Route path="/assistant/workbench" component={AssistantWorkbench} />
            <Route path="/assistant"><Redirect to="/assistant/workbench" /></Route>

            {/* Legacy analytics redirects */}
            <Route path="/analytics/roi"><Redirect to="/insights/roi" /></Route>
            <Route path="/analytics"><Redirect to="/insights/costs" /></Route>

            {/* Legacy predictive redirects */}
            <Route path="/predictive/dashboard"><Redirect to="/insights/prediction/dashboard" /></Route>
            <Route path="/predictive/failures"><Redirect to="/insights/prediction/failures" /></Route>
            <Route path="/predictive/resources"><Redirect to="/insights/prediction/resources" /></Route>
            <Route path="/predictive/workflows"><Redirect to="/insights/prediction/workflows" /></Route>
            <Route path="/predictive/monitoring"><Redirect to="/insights/prediction/monitoring" /></Route>
            <Route path="/predictive/config"><Redirect to="/insights/prediction/config" /></Route>
            <Route path="/predictive"><Redirect to="/insights/prediction" /></Route>
            <Route path="/prediction-intelligence"><Redirect to="/insights/prediction" /></Route>

            {/* Agent AI */}
            <Route path="/agent/memory" component={AgentMemoryRedirect} />
            <Route path="/agent/analytics"><Redirect to="/insights/agents" /></Route>

            {/* Fine-Tuning moved under Knowledge */}
            <Route path="/fine-tuning/datasets/:id">{(params) => <Redirect to={`/knowledge/fine-tuning/datasets/${params.id}`} />}</Route>
            <Route path="/fine-tuning/datasets"><Redirect to="/knowledge/fine-tuning/datasets" /></Route>
            <Route path="/fine-tuning"><Redirect to="/knowledge/fine-tuning" /></Route>

            {/* Governance */}
            <Route path="/approvals/:id"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/approvals"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/governance/board-room"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/governance/visualizer"><Redirect to="/control/visualizer" /></Route>
            <Route path="/governance/simulator"><Redirect to="/control/policies?mode=simulate" /></Route>
            <Route path="/governance/dashboard"><Redirect to="/control/status" /></Route>
            <Route path="/governance/:id">{(params) => <Redirect to={`/control/policies/${params.id}`} />}</Route>
            <Route path="/governance"><Redirect to="/control/policies" /></Route>

            <Route path="/control/decisions/:id"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/control/decisions"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/control/board-room"><Redirect to="/assistant/workbench" /></Route>
            <Route path="/control/visualizer" component={OverrideVisualizer} />
            <Route path="/control/simulator"><Redirect to="/control/policies?mode=simulate" /></Route>
            <Route path="/control/status" component={GovernanceDashboard} />
            <Route path="/control/agent-identities" component={AgentIdentityControl} />
            <Route path="/control/policies/:id" component={PolicyEditor} />
            <Route path="/control/policies" component={PolicyManager} />
            {/* Mounted under /control because that prefix is already registered
                in BOTH the dev matcher and the production sendFile list in
                server/vite.ts. A new top-level prefix has to be added to both,
                and one added to only one works in dev and lands on the auth SPA
                in production. /governance was unusable here: every /governance
                path redirects, and /governance/:id would swallow this one. */}
            <Route path="/control/improvement" component={ImprovementInbox} />
            <Route path="/control" component={ControlOverview} />

            {/* Behavioral Intelligence — Scoring */}
            <Route path="/intelligence/scoring/models/:id">{(params) => <Redirect to={`/insights/scoring/models/${params.id}`} />}</Route>
            <Route path="/intelligence/scoring/live"><Redirect to="/insights/scoring/live" /></Route>
            <Route path="/intelligence/scoring/explain/:entityType/:entityId">
              {(params) => <Redirect to={`/insights/scoring/explain/${params.entityType}/${params.entityId}`} />}
            </Route>
            <Route path="/intelligence/scoring"><Redirect to="/insights/scoring" /></Route>

            {/* Observability / Health canonical routes (merged from ObservabilityRouting) */}
            <Route path="/health/observability" component={UnifiedObservability} />
            {/*
              The kind segment states which table :id belongs to. This page resolves
              pipeline step executions only; four call sites previously linked here
              with ids from four different tables and every mismatch showed up as an
              unexplained 404 instead of a bad link.
            */}
            <Route path="/health/monitoring/step/:id">
              {(params) => <MonitoringPage id={params.id} kind="step" />}
            </Route>
            {/* agent_run_steps — autonomous activity. A separate kind because ids
                35 and 48-51 exist in both tables, so the id alone is ambiguous. */}
            <Route path="/health/monitoring/agent-step/:id">
              {(params) => <MonitoringPage id={params.id} kind="agent-step" />}
            </Route>
            {/* Legacy shape. Historically always meant a step execution, so existing
                links and bookmarks keep resolving. */}
            <Route path="/health/monitoring/:id">
              {(params) => <Redirect to={`/health/monitoring/step/${params.id}`} />}
            </Route>
            <Route path="/health/monitoring">
              {() => <MonitoringPage />}
            </Route>
            <Route path="/health/alerts" component={AlertsPage} />
            <Route path="/health/events" component={EventsPage} />
            <Route path="/health/pulse" component={SystemPulse} />
            <Route path="/health/incidents" component={ErrorDiagnoses} />
            <Route path="/health/infra-health" component={InfraHealth} />
            <Route path="/health/e2e-tests" component={TestHealthDashboard} />
            <Route path="/health/chaos" component={ChaosEngineeringPanel} />
            <Route path="/health" component={HealthOverview} />

            {/* Observability legacy redirects */}
            <Route path="/monitoring/:id">
              {(params) => <MonitoringPage id={params.id} />}
            </Route>
            <Route path="/monitoring"><Redirect to="/health/monitoring" /></Route>
            <Route path="/observability"><Redirect to="/health/observability" /></Route>
            <Route path="/pulse"><Redirect to="/health/pulse" /></Route>
            <Route path="/alerts"><Redirect to="/health/alerts" /></Route>
            <Route path="/events"><Redirect to="/health/events" /></Route>

            {/* 404 handler for this entry point */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </OrgProvider>
  );
}

