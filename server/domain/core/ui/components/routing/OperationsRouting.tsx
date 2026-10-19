import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useSearch } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import Layout from "@domain-ui/core/ui/components/layout/Layout";
import { Loader2 } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazy-retry";
import { AdminRoutingRoutes } from "./AdminRouting";
import OperationsSchedulesPage from "@/modules/operations/pages/OperationsSchedules";

// Fallback loading component
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

// ============================================================================
// OPERATIONS DOMAIN PAGES
// ============================================================================

const AgentLibraryPage = lazy(() => import("@domain-ui/jobs/ui/modules/jobs/pages/AgentLibrary"));
const ComputerUsePage = lazy(() => import("@/modules/computer-studio/ComputerUsePage"));
const SchedulesPage = lazy(() => import("@domain-ui/jobs/ui/modules/jobs/pages/Schedules"));
const ScheduledJobsPage = lazy(() => import("@domain-ui/jobs/ui/modules/jobs/pages/ScheduledJobs"));
const MissionsPage = lazy(() => import("@domain-ui/mission/ui/modules/missions/pages/Missions"));
const MissionDetailPage = lazy(() => import("@domain-ui/mission/ui/modules/missions/pages/MissionDetail"));
const MissionRunPage = lazy(() => import("@/modules/missions/pages/MissionRunPage"));
const MissionPlanEditorPage = lazy(() => import("@domain-ui/mission/ui/modules/missions/pages/MissionPlanEditorPage"));
const ActivityCenterPage = lazy(() => import("@domain-ui/mission/ui/modules/missions/pages/ActivityCenter"));
const CreateMissionPage = lazy(() => import("@domain-ui/mission/ui/modules/missions/pages/CreateMission"));
const AgentDetailPage = lazy(() => import("@domain-ui/jobs/ui/modules/jobs/pages/JobDetail"));
const CreateAgentPage = lazy(() => import("@domain-ui/jobs/ui/modules/jobs/pages/CreateAgent"));
const OperationsOverview = lazy(() => import("@/modules/operations/pages/OperationsOverview"));
const CyclesDashboard = lazy(() => import("@/modules/operations/pages/CyclesDashboard"));
const ProjectsDashboard = lazy(() => import("@/modules/projects/pages/ProjectsDashboard"));
const ProjectSpacePage = lazy(() => import("@/modules/projects/pages/ProjectSpacePage"));
const CycleBlueprintBuilder = lazy(() => import("@/modules/operations/pages/CycleBlueprintBuilder"));
const StageCycle = lazy(() => import("@/modules/operations/pages/StageCycle"));
const CycleDetailPage = lazy(() => import("@/modules/operations/pages/CycleDetailPage"));
const PipelinesPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/Pipelines"));
const PipelineExecutionsPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/PipelineExecutions"));
const PipelineExecutionDetailPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/PipelineExecutionDetail"));
const TemplateGallery = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/TemplateGallery"));
const TemplateWizard = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/TemplateWizard"));
const SessionDashboardPage = lazy(() => import("@domain-ui/sdlc-pipeline/ui/modules/pages/SessionDashboardPage"));
const SessionDetailPage = lazy(() => import("@domain-ui/sdlc-pipeline/ui/modules/pages/SessionDetailPage"));
const QualityMetricsPage = lazy(() => import("@domain-ui/sdlc-pipeline/ui/modules/pages/QualityMetricsPage"));
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));
const AgenticHRPage = lazy(() => import("@/modules/agents/components/AgenticHR").then(m => ({ default: m.AgenticHR })));
const UniversalStudio = lazy(() => import("@/modules/workbenches/UniversalStudio"));
const DecisionControlPanel = lazy(() => import("@/modules/workbenches/DecisionControlPanel"));
const SpatialAnalyticsPage = lazy(() => import("@/modules/operations/pages/SpatialAnalyticsPage"));
const BuilderPodsShowcasePage = lazy(() => import("@/pages/dev/BuilderPodsShowcasePage"));
const BotBuilderPage = lazy(() => import("@domain-ui/bots/ui/BotBuilderPage"));
const BotExchangePage = lazy(() => import("@domain-ui/bots/ui/BotExchangePage"));
const StudioMarketplacePage = lazy(() => import("@domain-ui/studio-marketplace/ui/StudioMarketplacePage"));

// Dashboard & Launchpad Pages
const DashboardPage = lazy(() => import("@domain-ui/core/ui/modules/pages/Dashboard"));
const WorkstreamFeedPage = lazy(() => import("@/modules/missions/pages/WorkstreamFeed"));
const CommandLaunchpadPage = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/CommandLaunchpadPage"));

// Workspace Mode Pages (Hat Menu)
const AgentChatPage = lazyWithRetry(() => import("@/components/agent-chat/AgentChatPanel"));
const SignalDashboardPage = lazyWithRetry(() => import("@/components/signal-intelligence/SignalDashboard"));
const SignalStudioPage = lazyWithRetry(() => import("@/modules/signal-studio/SignalStudio"));
const FeedsCyclesPage = lazyWithRetry(() => import("@/components/feeds-cycles/FeedsCyclesPanel"));
const SignalIntelligenceWizardPage = lazyWithRetry(() => import("@/components/signal-intelligence/spatial/SignalIntelligenceWizard"));
const WorkflowHistoryPage = lazyWithRetry(() => import("@/components/signal-intelligence/spatial/WorkflowHistoryPage"));
const WorkflowDetailPage = lazyWithRetry(() => import("@/components/signal-intelligence/spatial/WorkflowDetailView"));
const WorkflowEditPage = lazyWithRetry(() => import("@/components/signal-intelligence/spatial/WorkflowEditPage"));
const WorkspacePage = lazyWithRetry(() => import("@/components/hat-menu/ModeRouter"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

function ExternalRedirect({ to }: { to: string }) {
  React.useEffect(() => { window.location.href = to; }, [to]);
  return null;
}

/**
 * Embed mode strips the router down to the three pipeline surfaces below.
 *
 * This used to be a module-level const read once from window.location.search at
 * first import. In a client-routed SPA that value never re-evaluates, so a session
 * that first loaded on an ?embed URL stayed in embed mode for every subsequent
 * client-side navigation — /workspace/spatial and every other route fell through
 * to NotFound while the server happily served the page. Read it per render so it
 * tracks the current location.
 */
function useIsEmbed(): boolean {
  const search = useSearch();
  return new URLSearchParams(search).has("embed");
}

/**
 * OperationsRouting handles the routes specifically for the Mission Operations SPA.
 * Renders inside the standard Layout provided by CoreRouting to avoid layout nesting.
 */
export function OperationsRouting() {
  const isEmbed = useIsEmbed();

  if (isEmbed) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/pipeline/sessions/:id" component={SessionDetailPage} />
          <Route path="/pipeline/sessions" component={SessionDashboardPage} />
          <Route path="/pipeline/metrics" component={QualityMetricsPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <OrgProvider>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            {/* Mach 3 Multi-SPA Ejection Failsafes */}
            <Route path="/"><Reload /></Route>
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
            <Route path="/forms"><Reload /></Route>
            <Route path="/forms/:rest*"><Reload /></Route>
            <Route path="/knowledge-store"><Reload /></Route>
            <Route path="/knowledge-store/:rest*"><Reload /></Route>
            <Route path="/knowledge"><Reload /></Route>
            <Route path="/knowledge/:rest*"><Reload /></Route>
            <Route path="/datasets"><Reload /></Route>
            <Route path="/datasets/:rest*"><Reload /></Route>
            <Route path="/analytics"><Reload /></Route>
            <Route path="/analytics/:rest*"><Reload /></Route>
            <Route path="/insights"><Reload /></Route>
            <Route path="/insights/:rest*"><Reload /></Route>
            <Route path="/predictive"><Reload /></Route>
            <Route path="/predictive/:rest*"><Reload /></Route>
            <Route path="/control"><Reload /></Route>
            <Route path="/control/:rest*"><Reload /></Route>
            <Route path="/governance"><Reload /></Route>
            <Route path="/governance/:rest*"><Reload /></Route>
            <Route path="/fine-tuning"><Reload /></Route>
            <Route path="/fine-tuning/:rest*"><Reload /></Route>
            <Route path="/health"><Reload /></Route>
            <Route path="/health/:rest*"><Reload /></Route>
            <Route path="/credentials"><AdminRoutingRoutes /></Route>
            <Route path="/credentials/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/connections"><AdminRoutingRoutes /></Route>
            <Route path="/connections/*"><AdminRoutingRoutes /></Route>
            <Route path="/account-admin"><AdminRoutingRoutes /></Route>
            <Route path="/account-admin/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/platform"><AdminRoutingRoutes /></Route>
            <Route path="/platform-maintenance"><AdminRoutingRoutes /></Route>
            <Route path="/platform-maintenance/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/users"><AdminRoutingRoutes /></Route>
            <Route path="/users/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/settings"><AdminRoutingRoutes /></Route>
            <Route path="/settings/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/profile"><AdminRoutingRoutes /></Route>
            <Route path="/profile/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/organizations"><AdminRoutingRoutes /></Route>
            <Route path="/organizations/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/admin"><AdminRoutingRoutes /></Route>
            <Route path="/admin/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/snapshots"><AdminRoutingRoutes /></Route>
            <Route path="/snapshots/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/billing"><AdminRoutingRoutes /></Route>
            <Route path="/billing/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/saas"><AdminRoutingRoutes /></Route>
            <Route path="/saas/:rest*"><AdminRoutingRoutes /></Route>
            <Route path="/tactics"><Reload /></Route>
            <Route path="/tactics/:rest*"><Reload /></Route>

            {/* Launchpad route */}
            <Route path="/launchpad" component={CommandLaunchpadPage} />
            <Route path="/launch" component={CommandLaunchpadPage} />

            {/* Workspace mode routes (Hat Menu) */}
            <Route path="/workspace/chat/:roomKey">
              {(params) => <AgentChatPage key={params.roomKey} roomKey={params.roomKey} />}
            </Route>
            <Route path="/workspace/chat">{() => <AgentChatPage key="default-chat" />}</Route>
            <Route path="/workspace/signals">{() => <SignalStudioPage />}</Route>
            <Route path="/workspace/signal">{() => <SignalStudioPage />}</Route>
            <Route path="/workspace/spatial">{() => <SignalStudioPage initialView="spatial" />}</Route>
            {/* Every mode in MODE_ROUTES needs a route HERE — this is the SPA
                that owns /workspace* (see isOperationsRoute in server/vite.ts).
                feeds-cycles had no route at all: its card pointed at
                /dashboard, so picking it left the workspace entirely and
                rendered the generic Dashboard instead of this panel. */}
            <Route path="/workspace/feeds">{() => <FeedsCyclesPage />}</Route>
            {/* Computer Use Studio as a page: push notifications for a paused task link here. */}
            <Route path="/workspace/computer-use">{() => <ComputerUsePage />}</Route>
            {/* The wizard and the dashboard take their own props, so they are
                rendered as children rather than passed to `component` — wouter
                would otherwise hand them RouteComponentProps. Both already fall
                back to navigation when no callbacks are supplied. */}
            <Route path="/signal-intelligence/wizard">{() => <SignalIntelligenceWizardPage />}</Route>
            <Route path="/signal-intelligence/workflows/:id/edit" component={WorkflowEditPage} />
            <Route path="/signal-intelligence/workflows/:id">{() => <WorkflowDetailPage />}</Route>
            <Route path="/signal-intelligence/workflows" component={WorkflowHistoryPage} />
            <Route path="/signal-intelligence">{() => <SignalStudioPage />}</Route>
            <Route path="/signals">{() => <SignalStudioPage />}</Route>
            <Route path="/signal">{() => <SignalStudioPage />}</Route>
            <Route path="/spatial">{() => <SignalStudioPage initialView="spatial" />}</Route>
            <Route path="/workspace">{() => <WorkspacePage />}</Route>
            <Route path="/workspace/:rest*">{() => <WorkspacePage />}</Route>

            {/* Calculations redirect */}
            <Route path="/calculations"><Redirect to="/knowledge/calculations" /></Route>
            <Route path="/calculations/:rest*"><Redirect to="/knowledge/calculations" /></Route>

            {/* Dashboard routes */}
            <Route path="/dashboard/costs"><Redirect to="/insights/costs" /></Route>
            <Route path="/dashboard/forms/builder/:id?">{(params) => <Redirect to={params.id ? `/armory/forms/builder/${params.id}` : "/armory/forms/builder"} />}</Route>
            <Route path="/dashboard/forms"><Redirect to="/armory/forms" /></Route>
            <Route path="/dashboard/:rest*" component={DashboardPage} />
            <Route path="/dashboard" component={DashboardPage} />

            {/* Workstreams routes */}
            <Route path="/workstreams/:rest*" component={WorkstreamFeedPage} />
            <Route path="/workstreams" component={WorkstreamFeedPage} />

            {/* Operations & Legacy Missions URLs */}
            <Route path="/missions/activity"><Redirect to="/operations/runs" /></Route>
            <Route path="/missions/new" component={CreateMissionPage} />
            <Route path="/missions/:missionId/runs/:runId/plan" component={MissionPlanEditorPage} />
            <Route path="/missions/:missionId/runs/:runId" component={MissionRunPage} />
            <Route path="/missions/:id" component={MissionDetailPage} />
            <Route path="/missions" component={MissionsPage} />

            <Route path="/agents/new"><Redirect to="/operations/agents/new" /></Route>
            <Route path="/agents/hr"><Redirect to="/operations/agents/hr" /></Route>
            <Route path="/agents/:id">{(params) => <Redirect to={`/operations/agents/${params.id}`} />}</Route>
            <Route path="/agents"><Redirect to="/operations/agents" /></Route>
            <Route path="/jobs/new"><Redirect to="/operations/agents/new" /></Route>
            <Route path="/jobs/:id">{(params) => <Redirect to={`/operations/agents/${params.id}`} />}</Route>
            <Route path="/jobs"><Redirect to="/operations/agents" /></Route>

            <Route path="/scheduled-jobs/:id">{(params) => <Redirect to={`/operations/schedules/automations/${params.id}`} />}</Route>
            <Route path="/scheduled-jobs"><Redirect to="/operations/schedules/automations" /></Route>
            <Route path="/scheduled-agents/:id">{(params) => <Redirect to={`/operations/schedules/automations/${params.id}`} />}</Route>
            <Route path="/scheduled-agents"><Redirect to="/operations/schedules/automations" /></Route>
            <Route path="/schedules/:id">{(params) => <Redirect to={`/operations/schedules/rules/${params.id}`} />}</Route>
            <Route path="/schedules"><Redirect to="/operations/schedules" /></Route>

            <Route path="/pipelines/:id/executions/:executionId">
              {(params) => <Redirect to={`/operations/workstream-executions/${params.executionId}`} />}
            </Route>
            <Route path="/pipelines/:id/executions">
              {(params) => <Redirect to={`/operations/workstreams/${params.id}/executions`} />}
            </Route>
            <Route path="/pipelines/new"><Redirect to="/operations/workstreams/new" /></Route>
            <Route path="/pipelines/:id">{(params) => <Redirect to={`/operations/workstreams/${params.id}`} />}</Route>
            <Route path="/pipelines"><Redirect to="/operations/workstreams" /></Route>
            <Route path="/pipeline-executions/:id">{(params) => <Redirect to={`/operations/workstream-executions/${params.id}`} />}</Route>
            <Route path="/pipeline-executions"><Redirect to="/operations/runs" /></Route>
            <Route path="/templates/:id/wizard">{(params) => <Redirect to={`/operations/templates/${params.id}/wizard`} />}</Route>
            <Route path="/templates"><Redirect to="/operations/templates" /></Route>

            <Route path="/approvals/:rest*"><ExternalRedirect to="/assistant/workbench" /></Route>
            <Route path="/approvals"><ExternalRedirect to="/assistant/workbench" /></Route>

            {/* Canonical Operations URLs */}
            <Route path="/operations/missions/new" component={CreateMissionPage} />
            <Route path="/operations/missions/:missionId/runs/:runId/plan" component={MissionPlanEditorPage} />
            <Route path="/operations/missions/:missionId/runs/:runId" component={MissionRunPage} />
            <Route path="/operations/missions/:id" component={MissionDetailPage} />
            <Route path="/operations/missions" component={MissionsPage} />
            <Route path="/operations/runs" component={ActivityCenterPage} />

            {/* Bot Builder (simplified one-field creation) and the Bot Exchange */}
            <Route path="/operations/bots/new" component={BotBuilderPage} />
            <Route path="/operations/bots" component={BotExchangePage} />

            {/* Studio Marketplace — enable/disable CREW studio add-ons */}
            <Route path="/operations/studio-marketplace" component={StudioMarketplacePage} />

            {/* Operations Agents */}
            <Route path="/operations/agents/new" component={CreateAgentPage} />
            <Route path="/operations/agents/hr" component={AgenticHRPage} />
            <Route path="/operations/agents/dashboard"><Redirect to="/operations/agents" /></Route>
            <Route path="/operations/agents/analytics"><Redirect to="/insights/agents" /></Route>
            <Route path="/operations/agents/:id" component={AgentDetailPage} />
            <Route path="/operations/agents" component={AgentLibraryPage} />

            <Route path="/operations/workstreams/:id/executions" component={PipelineExecutionsPage} />
            <Route path="/operations/workstream-executions/:id" component={PipelineExecutionDetailPage} />
            <Route path="/operations/workstreams/new" component={PipelinesPage} />
            <Route path="/operations/workstreams/:id" component={PipelinesPage} />
            <Route path="/operations/workstreams" component={PipelinesPage} />
            <Route path="/operations/templates/:id/wizard" component={TemplateWizard} />
            <Route path="/operations/templates" component={TemplateGallery} />

            <Route path="/operations/schedules/rules/:id" component={SchedulesPage} />
            <Route path="/operations/schedules/rules" component={SchedulesPage} />
            <Route path="/operations/schedules/automations/:id" component={ScheduledJobsPage} />
            <Route path="/operations/schedules/automations" component={ScheduledJobsPage} />
            <Route path="/operations/schedules" component={OperationsSchedulesPage} />

            <Route path="/operations/cycles/new/legacy" component={StageCycle} />
            <Route path="/operations/cycles/new" component={CycleBlueprintBuilder} />
            <Route path="/operations/cycles/:id/edit" component={CycleBlueprintBuilder} />
            <Route path="/operations/cycles/:id" component={CycleDetailPage} />
            <Route path="/operations/workbenches/universal-studio/:cycleId" component={UniversalStudio} />
            <Route path="/operations/workbenches/decision-control/:cycleId" component={DecisionControlPanel} />
            <Route path="/operations/spatial" component={SpatialAnalyticsPage} />
            <Route path="/operations/cycles" component={CyclesDashboard} />
            <Route path="/operations" component={OperationsOverview} />

            {/* Project Spaces */}
            <Route path="/projects/:key/cycles/:id" component={CycleDetailPage} />
            <Route path="/projects/:key/missions/:missionId/runs/:runId" component={MissionRunPage} />
            <Route path="/projects/:key/missions/:id" component={MissionDetailPage} />
            <Route path="/projects/:key/:tab" component={ProjectSpacePage} />
            <Route path="/projects/:key" component={ProjectSpacePage} />
            <Route path="/projects" component={ProjectsDashboard} />

            {/* Codegen Pipeline Workbench */}
            <Route path="/pipeline/sessions/:id" component={SessionDetailPage} />
            <Route path="/pipeline/sessions" component={SessionDashboardPage} />
            <Route path="/pipeline/metrics" component={QualityMetricsPage} />

            {/* Builder Pods Harness */}
            <Route path="/dev/builder-pods" component={BuilderPodsShowcasePage} />
            <Route path="/external/builder-pods" component={BuilderPodsShowcasePage} />

            {/* 6. CATCH-ALL 404 for this bundle */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </OrgProvider>
  );
}
