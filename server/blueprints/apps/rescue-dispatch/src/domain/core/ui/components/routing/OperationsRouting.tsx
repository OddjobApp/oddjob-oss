import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { Loader2 } from "lucide-react";
import Layout from "@domain-ui/core/ui/components/layout/Layout";
import { AdminRoutingRoutes } from "./AdminRouting";

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
const OperationsSchedulesPage = lazy(() => import("@/modules/operations/pages/OperationsSchedules"));
const CyclesDashboard = lazy(() => import("@/modules/operations/pages/CyclesDashboard"));
const StageCycle = lazy(() => import("@/modules/operations/pages/StageCycle"));
const CycleDetailPage = lazy(() => import("@/modules/operations/pages/CycleDetailPage"));
const PipelinesPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/Pipelines"));
const PipelineExecutionsPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/PipelineExecutions"));
const PipelineExecutionDetailPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/PipelineExecutionDetail"));
const TemplateGallery = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/TemplateGallery"));
const TemplateWizard = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/TemplateWizard"));
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));
const AgenticHRPage = lazy(() => import("@/modules/agents/components/AgenticHR").then(m => ({ default: m.AgenticHR })));
const UniversalStudio = lazy(() => import("@/modules/workbenches/UniversalStudio"));
const DecisionControlPanel = lazy(() => import("@/modules/workbenches/DecisionControlPanel"));

// ============================================================================
// DASHBOARD & WORKSTREAMS PAGES (absorbed from Main SPA)
// ============================================================================

const DashboardPage = lazy(() => import("@domain-ui/core/ui/modules/pages/Dashboard"));
const WorkstreamFeedPage = lazy(() => import("@/modules/missions/pages/WorkstreamFeed"));

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
 * OperationsRouting handles the routes specifically for the Mission Operations SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 */
export function OperationsRouting() {
  return (
    <OrgProvider>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            {/* Mach 3 Multi-SPA Ejection Failsafes */}
            <Route path="/"><Reload /></Route>
            <Route path="/auth"><Reload /></Route>
            <Route path="/auth/:rest*"><Reload /></Route>
            <Route path="/armory"><Reload /></Route>
            <Route path="/armory/:rest*"><Reload /></Route>
            <Route path="/apps"><Reload /></Route>
            <Route path="/apps/:rest*"><Reload /></Route>
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
            <Route path="/connections/:rest*"><AdminRoutingRoutes /></Route>
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

            {/* Dashboard routes (absorbed from Main SPA) */}
            <Route path="/dashboard/costs"><Redirect to="/insights/costs" /></Route>
            <Route path="/dashboard/forms/builder/:id?">{(params) => <Redirect to={params.id ? `/armory/forms/builder/${params.id}` : "/armory/forms/builder"} />}</Route>
            <Route path="/dashboard/forms"><Redirect to="/armory/forms" /></Route>
            <Route path="/dashboard/:rest*" component={DashboardPage} />
            <Route path="/dashboard" component={DashboardPage} />

            {/* Workstreams routes (absorbed from Main SPA) */}
            <Route path="/workstreams/:rest*" component={WorkstreamFeedPage} />
            <Route path="/workstreams" component={WorkstreamFeedPage} />

            {/* Legacy Operations URLs */}
            <Route path="/missions/activity"><Redirect to="/operations/runs" /></Route>
            <Route path="/missions/new"><Redirect to="/operations/missions/new" /></Route>
            <Route path="/missions/:missionId/runs/:runId/plan">
              {(params) => <Redirect to={`/operations/missions/${params.missionId}/runs/${params.runId}/plan`} />}
            </Route>
            <Route path="/missions/:missionId/runs/:runId">
              {(params) => <Redirect to={`/operations/missions/${params.missionId}/runs/${params.runId}`} />}
            </Route>
            <Route path="/missions/:id">{(params) => <Redirect to={`/operations/missions/${params.id}`} />}</Route>
            <Route path="/missions"><Redirect to="/operations/missions" /></Route>

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
            <Route path="/templates/:id/wizard">{(params) => <Redirect to={`/operations/templates/${params.id}/wizard`} />}</Route>
            <Route path="/templates"><Redirect to="/operations/templates" /></Route>

            <Route path="/approvals/:rest*"><ExternalRedirect to="/control/decisions" /></Route>
            <Route path="/approvals"><ExternalRedirect to="/control/decisions" /></Route>

            {/* Canonical Operations URLs */}
            <Route path="/operations/missions/new" component={CreateMissionPage} />
            <Route path="/operations/missions/:missionId/runs/:runId/plan" component={MissionPlanEditorPage} />
            <Route path="/operations/missions/:missionId/runs/:runId" component={MissionRunPage} />
            <Route path="/operations/missions/:id" component={MissionDetailPage} />
            <Route path="/operations/missions" component={MissionsPage} />
            <Route path="/operations/runs" component={ActivityCenterPage} />

            <Route path="/operations/agents/new" component={CreateAgentPage} />
            <Route path="/operations/agents/hr" component={AgenticHRPage} />
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

            <Route path="/operations/cycles/new" component={StageCycle} />
            <Route path="/operations/cycles/:id" component={CycleDetailPage} />
            <Route path="/operations/workbenches/universal-studio/:cycleId" component={UniversalStudio} />
            <Route path="/operations/workbenches/decision-control/:cycleId" component={DecisionControlPanel} />
            <Route path="/operations/cycles" component={CyclesDashboard} />
            <Route path="/operations" component={OperationsOverview} />

            {/* 6. CATCH-ALL 404 for this bundle */}
            <Route component={NotFound} />
          </Switch>

        </Suspense>
      </Layout>
    </OrgProvider>
  );
}

