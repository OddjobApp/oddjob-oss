import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { Loader2 } from "lucide-react";
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
// OBSERVABILITY DOMAIN PAGES
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

// Other shared
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

/**
 * ObservabilityRouting handles the routes specifically for the Monitoring SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 */
export function ObservabilityRouting() {
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
            <Route path="/missions"><Reload /></Route>
            <Route path="/missions/:rest*"><Reload /></Route>
            <Route path="/agents"><Reload /></Route>
            <Route path="/agents/:rest*"><Reload /></Route>
            <Route path="/scheduled-agents"><Reload /></Route>
            <Route path="/scheduled-agents/:rest*"><Reload /></Route>
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
            <Route path="/launchpad"><Reload /></Route>
            <Route path="/launch"><Reload /></Route>
            <Route path="/billing"><Reload /></Route>
            <Route path="/saas"><Reload /></Route>

            {/* Health / Observability canonical routes */}
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
            <Route path="/health" component={HealthOverview} />

            {/* Health legacy redirects */}
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

