import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { SuperAdminRoute } from "@/lib/SuperAdminRoute";
import { Loader2 } from "lucide-react";
import { PrefetchRouteWatcher } from "@domain-ui/core/ui/components/PrefetchRouteWatcher";
import { lazyWithRetry } from "@/lib/lazy-retry";

// Auth Pages (eager)
import AuthPage from "@domain-ui/auth/ui/modules/auth/pages/AuthPage";
import ForgotPassword from "@domain-ui/auth/ui/modules/auth/pages/ForgotPassword";
import ResetPassword from "@domain-ui/auth/ui/modules/auth/pages/ResetPassword";

// Dashboard (eager)
import Dashboard from "@domain-ui/core/ui/modules/pages/Dashboard";

// Layout (eager)
import Layout from "@domain-ui/core/ui/components/layout/Layout";

// Fallback loading component
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

// ============================================================================
// LAZY LOADED PAGES
// ============================================================================
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));
const ExternalTaskPage = lazy(() => import("@domain-ui/core/ui/pages/ExternalTaskPage"));
const PublicFormPage = lazy(() => import("@/modules/forms/pages/PublicFormPage"));
const TrustPage = lazy(() => import("@domain-ui/core/ui/pages/TrustPage"));

const RescuePublicPage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/RescuePublicPage"));
const HelperAcceptancePage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/HelperAcceptancePage"));

// ============================================================================
// ROUTER COMPONENTS
// ============================================================================

const AgentDeploymentPage = lazy(() => import("@domain-ui/agents/ui/modules/agents/pages/AgentDeploymentPage"));
const PublicAppDeploymentPage = lazy(() => import("@domain-ui/apps/ui/modules/apps/pages/PublicAppDeploymentPage"));

// Mission routes
const MissionRunPage = lazy(() => import("@/modules/missions/pages/MissionRunPage"));
const WorkstreamFeed = lazy(() => import("@/modules/missions/pages/WorkstreamFeed"));
const CyclesDashboard = lazy(() => import("@/modules/operations/pages/CyclesDashboard"));
const StageCycle = lazy(() => import("@/modules/operations/pages/StageCycle"));
const CycleDetailPage = lazy(() => import("@/modules/operations/pages/CycleDetailPage"));
const MissionsDashboardPage = lazy(() => import("../../../../../../client/src/pages/MissionsDashboardPage"));
const AgentsDashboardPage = lazy(() => import("../../../../../../client/src/pages/AgentsDashboardPage"));
const WorkflowHistoryPage = lazy(() => import("../../../../../../client/src/components/signal-intelligence/spatial/WorkflowHistoryPage"));
const WorkflowDetailPage = lazy(() => import("../../../../../../client/src/components/signal-intelligence/spatial/WorkflowDetailView"));
const WorkflowEditPage = lazy(() => import("../../../../../../client/src/components/signal-intelligence/spatial/WorkflowEditPage"));
const SignalDashboardPage = lazyWithRetry(() => import("@/components/signal-intelligence/SignalDashboard"));
const SignalIntelligenceWizardPage = lazyWithRetry(() => import("../../../../../../client/src/components/signal-intelligence/spatial/SignalIntelligenceWizard"));

// Project Spaces — the durable scope that owns cycles, missions, apps and knowledge.
const ProjectsDashboard = lazyWithRetry(() => import("@/modules/projects/pages/ProjectsDashboard"));
const ProjectSpacePage = lazyWithRetry(() => import("@/modules/projects/pages/ProjectSpacePage"));

const CommandLaunchpadPage = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/CommandLaunchpadPage"));
const WorkspacePage = lazyWithRetry(() => import("@/components/hat-menu/ModeRouter"));
const AgentChatPage = lazyWithRetry(() => import("@/components/agent-chat/AgentChatPanel"));
const BuilderPodsShowcasePage = lazy(() => import("@/pages/dev/BuilderPodsShowcasePage"));
const OperationsRoutingRoutes = lazy(() => import("./OperationsRouting").then(m => ({ default: m.OperationsRouting })));

// Deferred non-critical components
const CopilotIntervention = lazy(() => import("@domain-ui/ai/ui/components/copilot/CopilotIntervention").then(m => ({ default: (m as any).CopilotIntervention })));
const PulseTracker = lazy(() => import("@domain-ui/core/ui/components/PulseTracker"));

// Helper component to wrap lazy routes
function LazyRoute({ component: Component, ...props }: { component: React.LazyExoticComponent<any>; [key: string]: any }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component {...props} />
    </Suspense>
  );
}

const RescuePublicRoute = () => <LazyRoute component={RescuePublicPage} />;
const HelperAcceptanceRoute = () => <LazyRoute component={HelperAcceptancePage} />;
const AgentDeploymentRoute = () => <LazyRoute component={AgentDeploymentPage} />;
const PublicAppDeploymentRoute = () => <LazyRoute component={PublicAppDeploymentPage} />;

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

function ExternalRedirect({ to }: { to: string }) {
  React.useEffect(() => { window.location.href = to; }, [to]);
  return null;
}

// Resolves a bare mission-run link (`/mission-runs/:runId`, e.g. the Autoresearch
// dashboard's "Inspect Run"/"Inspect Origin" buttons, which only carry the run id)
// to the canonical `/missions/:missionId/runs/:runId` route by looking up the run's
// parent mission. Without this those links 404, since the run detail page needs both ids.
function MissionRunRedirect({ runId }: { runId: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/mission-runs/${runId}`],
    enabled: !!runId,
    retry: false,
  });
  if (isLoading) return <PageLoader />;
  const missionId = data?.missionId;
  if (missionId && runId) return <Redirect to={`/missions/${missionId}/runs/${runId}`} />;
  // Run not found / not accessible — fall back to the operations dashboard rather than 404.
  return <Redirect to="/operations" />;
}

// All protected page routes — rendered inside a single persistent Layout instance.
function ProtectedRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Mach 3 Multi-SPA Ejection Failsafes: Force hard reload if leaked into Dashboard bundle */}
        <Route path="/armory"><Reload /></Route>
        <Route path="/armory/:rest*"><Reload /></Route>
        <Route path="/apps"><Reload /></Route>
        <Route path="/approvals"><Redirect to="/assistant/workbench" /></Route>
        <Route path="/approvals/:rest*"><Redirect to="/assistant/workbench" /></Route>

        <Route path="/knowledge-store"><Reload /></Route>
        <Route path="/knowledge-store/:rest*"><Reload /></Route>
        <Route path="/knowledge"><Reload /></Route>
        <Route path="/knowledge/:rest*"><Reload /></Route>
        <Route path="/datasets"><Reload /></Route>
        <Route path="/datasets/:rest*"><Reload /></Route>
        <Route path="/fine-tuning"><Reload /></Route>
        <Route path="/fine-tuning/:rest*"><Reload /></Route>
        
        <Route path="/pipelines/:id/executions/:executionId">{(params) => <ExternalRedirect to={`/operations/workstream-executions/${params.executionId}`} />}</Route>
        <Route path="/pipelines"><ExternalRedirect to="/operations/workstreams" /></Route>
        <Route path="/pipelines/:rest*"><ExternalRedirect to="/operations/workstreams" /></Route>
        <Route path="/pipeline-executions/:id">{(params) => <ExternalRedirect to={`/operations/workstream-executions/${params.id}`} />}</Route>
        <Route path="/pipeline-executions"><ExternalRedirect to="/operations/runs" /></Route>
        
        <Route path="/analytics"><Reload /></Route>
        <Route path="/analytics/:rest*"><Reload /></Route>
        <Route path="/insights"><Reload /></Route>
        <Route path="/insights/:rest*"><Reload /></Route>
        <Route path="/predictive"><Reload /></Route>
        <Route path="/predictive/:rest*"><Reload /></Route>
        <Route path="/agent"><Reload /></Route>
        <Route path="/agent/:rest*"><Reload /></Route>
        <Route path="/control"><Reload /></Route>
        <Route path="/control/:rest*"><Reload /></Route>
        <Route path="/governance"><Reload /></Route>
        <Route path="/governance/:rest*"><Reload /></Route>

        <Route path="/health"><Reload /></Route>
        <Route path="/health/:rest*"><Reload /></Route>
        <Route path="/monitoring"><Reload /></Route>
        <Route path="/monitoring/:rest*"><Reload /></Route>
        <Route path="/observability"><Reload /></Route>
        <Route path="/observability/:rest*"><Reload /></Route>
        <Route path="/pulse"><Reload /></Route>
        <Route path="/pulse/:rest*"><Reload /></Route>
        <Route path="/alerts"><Reload /></Route>
        <Route path="/alerts/:rest*"><Reload /></Route>
        <Route path="/events"><Reload /></Route>
        <Route path="/events/:rest*"><Reload /></Route>

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
        <Route path="/snapshots"><Reload /></Route>
        <Route path="/snapshots/:rest*"><Reload /></Route>
        <Route path="/organizations"><Reload /></Route>
        <Route path="/organizations/:rest*"><Reload /></Route>
        <Route path="/admin/intelligence-forge"><Redirect to="/armory/forge" /></Route>
        <Route path="/admin/:rest*"><Reload /></Route>
        <Route path="/tactics/intelligence-forge"><Redirect to="/armory/forge" /></Route>
        <Route path="/tactics"><Reload /></Route>
        <Route path="/tactics/:rest*"><Reload /></Route>

        {/* Dashboard & Launchpad */}
        <Route path="/launchpad" component={CommandLaunchpadPage} />
        <Route path="/launch" component={CommandLaunchpadPage} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/dashboard/costs"><Redirect to="/insights/costs" /></Route>
        <Route path="/dashboard/forms/builder/:id?">{(params) => <Redirect to={params.id ? `/armory/forms/builder/${params.id}` : "/armory/forms/builder"} />}</Route>
        <Route path="/dashboard/forms"><Redirect to="/armory/forms" /></Route>

        {/* Spatial Signal Intelligence */}
        <Route path="/spatial">{() => <LazyRoute component={SignalDashboardPage} />}</Route>
        <Route path="/signal-intelligence/wizard">{() => <LazyRoute component={SignalIntelligenceWizardPage} />}</Route>
        <Route path="/signal-intelligence/workflows/:id/edit">{() => <LazyRoute component={WorkflowEditPage} />}</Route>
        <Route path="/signal-intelligence/workflows/:id">{() => <LazyRoute component={WorkflowDetailPage} />}</Route>
        <Route path="/signal-intelligence/workflows">{() => <LazyRoute component={WorkflowHistoryPage} />}</Route>
        <Route path="/signal-intelligence">{() => <LazyRoute component={SignalDashboardPage} />}</Route>
        <Route path="/workspace/spatial">{() => <LazyRoute component={SignalDashboardPage} />}</Route>
        <Route path="/prediction-intelligence">{() => <LazyRoute component={SignalDashboardPage} />}</Route>

        {/* Project Spaces */}
        <Route path="/projects" component={ProjectsDashboard} />
        <Route path="/projects/:key" component={ProjectSpacePage} />

        {/* Workspace & Chat */}
        <Route path="/workspace/chat/:roomKey">
          {(params) => <LazyRoute component={AgentChatPage} key={params.roomKey} roomKey={params.roomKey} />}
        </Route>
        <Route path="/workspace/chat">{() => <LazyRoute component={AgentChatPage} key="default-chat" />}</Route>
        <Route path="/workspace">{() => <LazyRoute component={WorkspacePage} />}</Route>
        <Route path="/workspace/:rest*">{() => <LazyRoute component={WorkspacePage} />}</Route>

        {/* Operations */}
        <Route path="/operations/cycles/new" component={OperationsRoutingRoutes} />
        <Route path="/operations/cycles/:rest*" component={OperationsRoutingRoutes} />
        <Route path="/operations/cycles" component={OperationsRoutingRoutes} />
        <Route path="/operations/:rest*" component={OperationsRoutingRoutes} />
        <Route path="/operations" component={OperationsRoutingRoutes} />

        {/* Account & Admin */}
        <Route path="/billing"><Redirect to="/account-admin/billing" /></Route>

        {/* Connections */}
        <Route path="/saas/connectors"><Redirect to="/connections/saas" /></Route>
        <Route path="/saas/workflows"><Redirect to="/connections/saas/workflows" /></Route>
        <Route path="/saas/sync-config"><Redirect to="/connections/saas/sync-config" /></Route>
        <Route path="/saas/analytics"><Redirect to="/connections/saas/analytics" /></Route>
        <Route path="/saas"><Redirect to="/connections/saas" /></Route>

        {/* 404 */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export function CoreRouting() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          {/* Auth routes (no layout) */}
          <Route path="/auth/login" component={AuthPage} />
          <Route path="/auth/signup" component={AuthPage} />
          <Route path="/auth/forgot-password" component={ForgotPassword} />
          <Route path="/auth/reset-password" component={ResetPassword} />
          <Route path="/auth" component={AuthPage} />

          {/* Public routes (no layout) */}
          <Route path="/dev/builder-pods" component={BuilderPodsShowcasePage} />
          <Route path="/external/builder-pods" component={BuilderPodsShowcasePage} />
          <Route path="/external/task" component={ExternalTaskPage} />
          <Route path="/external/forms/:token" component={PublicFormPage as any} />
          <Route path="/hil-form/:id" component={ExternalTaskPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/r/:token" component={RescuePublicRoute} />
          <Route path="/h/:token" component={HelperAcceptanceRoute} />
          <Route path="/a/:slug" component={AgentDeploymentRoute} />
          <Route path="/app/:slug" component={PublicAppDeploymentRoute} />
          <Route path="/app">
            {() => {
              const [, setLocation] = useLocation();
              React.useEffect(() => { setLocation("/"); }, []);
              return null;
            }}
          </Route>

          <Route path="/" component={AuthPage} />
          <Route>
            <PrefetchRouteWatcher />
            <ProtectedRoutes />
            <Suspense fallback={null}><PulseTracker /></Suspense>
          </Route>
        </Switch>
      </Suspense>
      <Suspense fallback={null}><CopilotIntervention /></Suspense>
    </>
  );
}
