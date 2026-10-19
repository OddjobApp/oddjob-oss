import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { SuperAdminRoute } from "@/lib/SuperAdminRoute";
import { Loader2 } from "lucide-react";
import { PrefetchRouteWatcher } from "@domain-ui/core/ui/components/PrefetchRouteWatcher";

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
const TrustPage = lazy(() => import("@domain-ui/core/ui/pages/TrustPage"));

const RescuePublicPage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/RescuePublicPage"));
const HelperAcceptancePage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/HelperAcceptancePage"));

// ============================================================================
// ROUTER COMPONENTS
// ============================================================================

// Module-level lazy imports for public routes (previously inline, caused remounting)
const AgentDeploymentPage = lazy(() => import("@domain-ui/agents/ui/modules/agents").then(m => ({ default: (m as any).AgentDeploymentPage })));
const PublicAppDeploymentPage = lazy(() => import("@domain-ui/apps/ui/modules/apps/pages/PublicAppDeploymentPage"));

// Mission routes
const MissionRunPage = lazy(() => import("@/modules/missions/pages/MissionRunPage"));
const WorkstreamFeed = lazy(() => import("@/modules/missions/pages/WorkstreamFeed"));
const CyclesDashboard = lazy(() => import("@/modules/operations/pages/CyclesDashboard"));
const StageCycle = lazy(() => import("@/modules/operations/pages/StageCycle"));
const CycleDetailPage = lazy(() => import("@/modules/operations/pages/CycleDetailPage"));

// Deferred non-critical components
const CopilotIntervention = lazy(() => import("@domain-ui/ai/ui/components/copilot/CopilotIntervention").then(m => ({ default: (m as any).CopilotIntervention })));
const PulseTracker = lazy(() => import("@domain-ui/core/ui/components/PulseTracker"));

// Helper component to wrap lazy routes
function LazyRoute({ component: Component }: { component: React.LazyExoticComponent<any> }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
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
        <Route path="/apps/:rest*"><Reload /></Route>
        <Route path="/prospecting"><Reload /></Route>
        <Route path="/prospecting/:rest*"><Reload /></Route>
        <Route path="/swarm"><Reload /></Route>
        <Route path="/swarm/:rest*"><Reload /></Route>
        
        <Route path="/missions/:missionId/runs/:runId" component={MissionRunPage} />
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
        <Route path="/approvals"><Reload /></Route>
        <Route path="/approvals/:rest*"><Reload /></Route>

        <Route path="/knowledge-store"><Reload /></Route>
        <Route path="/knowledge-store/:rest*"><Reload /></Route>
        <Route path="/knowledge"><Reload /></Route>
        <Route path="/knowledge/:rest*"><Reload /></Route>
        <Route path="/datasets"><Reload /></Route>
        <Route path="/datasets/:rest*"><Reload /></Route>
        <Route path="/fine-tuning"><Reload /></Route>
        <Route path="/fine-tuning/:rest*"><Reload /></Route>
        
        <Route path="/pipelines"><Reload /></Route>
        <Route path="/pipelines/:rest*"><Reload /></Route>
        
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

        {/* Dashboard */}
        <Route path="/dashboard/costs"><Redirect to="/insights/costs" /></Route>
        <Route path="/dashboard/forms/builder/:id?">{(params) => <Redirect to={params.id ? `/armory/forms/builder/${params.id}` : "/armory/forms/builder"} />}</Route>
        <Route path="/dashboard/forms"><Redirect to="/armory/forms" /></Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/workstreams" component={WorkstreamFeed} />
        <Route path="/prediction-intelligence"><Redirect to="/insights/prediction" /></Route>
        <Route path="/operations"><Reload /></Route>
        <Route path="/operations/:rest*"><Reload /></Route>

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
          <Route path="/" component={AuthPage} />

          {/* Public routes (no layout) */}
          <Route path="/external/task" component={ExternalTaskPage} />
          <Route path="/hil-form/:id" component={ExternalTaskPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/r/:token">
            <LazyRoute component={RescuePublicPage} />
          </Route>
          <Route path="/h/:token">
            <LazyRoute component={HelperAcceptancePage} />
          </Route>
          <Route path="/a/:slug">
            <LazyRoute component={AgentDeploymentPage} />
          </Route>
          <Route path="/app/:slug">
            <LazyRoute component={PublicAppDeploymentPage} />
          </Route>
          <Route path="/app">
            {() => {
              const [, setLocation] = useLocation();
              React.useEffect(() => { setLocation("/"); }, []);
              return null;
            }}
          </Route>
          {/* All protected routes — Layout is a single persistent instance here */}
          <Route>
            <OrgProvider>
              <Layout>
                <PrefetchRouteWatcher />
                <ProtectedRoutes />
                <Suspense fallback={null}><PulseTracker /></Suspense>
              </Layout>
            </OrgProvider>
          </Route>
        </Switch>
      </Suspense>
      <Suspense fallback={null}><CopilotIntervention /></Suspense>
    </>
  );
}

