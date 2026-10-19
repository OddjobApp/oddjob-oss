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

// Other shared
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

/**
 * PipelinesRouting handles the routes specifically for the Workstreams SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 */
export function PipelinesRouting() {
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

            {/* Legacy Workstreams URLs now redirect into the consolidated Operations hub. */}
            <Route path="/pipelines/:id/executions/:executionId">
              {(params) => <Redirect to={`/operations/workstream-executions/${params.executionId}`} />}
            </Route>
            <Route path="/pipelines/:id/executions">
              {(params) => <Redirect to={`/operations/workstreams/${params.id}/executions`} />}
            </Route>
            <Route path="/pipeline-executions/:id">
              {(params) => <Redirect to={`/operations/workstream-executions/${params.id}`} />}
            </Route>
            <Route path="/pipelines/new"><Redirect to="/operations/workstreams/new" /></Route>
            <Route path="/pipelines/:id">{(params) => <Redirect to={`/operations/workstreams/${params.id}`} />}</Route>
            <Route path="/pipelines"><Redirect to="/operations/workstreams" /></Route>
            <Route path="/templates/:id/wizard">
              {(params) => <Redirect to={`/operations/templates/${params.id}/wizard`} />}
            </Route>
            <Route path="/templates"><Redirect to="/operations/templates" /></Route>

            {/* 404 handler for this entry point */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </OrgProvider>
  );
}

