import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { Loader2 } from "lucide-react";
import Layout from "@domain-ui/core/ui/components/layout/Layout";
import { lazyWithRetry } from "@/lib/lazy-retry";

// Fallback loading component
function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
    </div>
  );
}

function RedirectToCrewForge() {
  React.useEffect(() => {
    window.location.href = "/workspace/chat?studio=forge";
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground gap-2">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span>Launching App Forge Studio in CREW…</span>
    </div>
  );
}

// ============================================================================
// ARMORY DOMAIN PAGES
// ============================================================================

const AppMarketplace = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/AppMarketplace"));
const AppDetail = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/AppDetail"));
const ForgeHistory = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/ForgeHistory"));
const ForgeSettings = lazyWithRetry(() => import("@domain-ui/apps/ui/modules/apps/pages/ForgeSettings"));
const AppsForgeOverview = lazyWithRetry(() => import("@/modules/apps/pages/AppsForgeOverview"));
// The Form Builder retired into Form Studio; its address opens the Studio.
const FormsLibraryPage = lazyWithRetry(() => import("@/modules/forms/pages/FormsLibraryPage"));
const FormStudioPage = lazyWithRetry(() => import("@/modules/forms/pages/FormStudioPage"));

const SystemExplorerPage = lazyWithRetry(() => import("@domain-ui/mission/ui/modules/missions/pages/SystemExplorerPage"));
const XrayCompositionExplorer = lazyWithRetry(() => import("@domain-ui/xray/ui/XrayCompositionExplorer"));
const ProspectingDashboardPage = lazyWithRetry(() => import("@domain-ui/prospecting/ui/modules/prospecting/pages/ProspectingDashboard"));
const DeveloperEarnings = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/billing/pages/DeveloperEarnings"));
const OrgForge = lazyWithRetry(() => import("@domain-ui/org/ui/modules/org/pages/OrgForge"));
const NotFound = lazyWithRetry(() => import("@domain-ui/core/ui/pages/NotFound"));
const AgentMemoryView = lazyWithRetry(() => import("@domain-ui/ai/ui/modules/agent-ai/pages/AgentMemoryView"));
const ToolRegistry = lazyWithRetry(() => import("@domain-ui/tools/ui/modules/tools/pages/ToolRegistry"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

/**
 * ArmoryRouting handles the routes specifically for the Developer Armory SPA.
 * Handles /armory/*, /apps/*, and legacy /prospecting/* routes.
 */
export function ArmoryRouting() {
  return (
    <OrgProvider>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            {/* Mach 3 Multi-SPA Ejection Failsafes */}
            <Route path="/"><Reload /></Route>
            <Route path="/workspace"><Reload /></Route>
            <Route path="/workspace/:rest*"><Reload /></Route>
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
            <Route path="/fine-tuning"><Reload /></Route>
            <Route path="/fine-tuning/:rest*"><Reload /></Route>
            
            <Route path="/pipelines"><Reload /></Route>
            <Route path="/pipelines/:rest*"><Reload /></Route>
            <Route path="/operations"><Reload /></Route>
            <Route path="/operations/:rest*"><Reload /></Route>
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
            {/* Legacy tactics redirect – /tactics/tools → /armory/tools */}
            <Route path="/tactics/tools"><Redirect to="/armory/tools" /></Route>
            <Route path="/dashboard"><Reload /></Route>
            <Route path="/dashboard/:rest*"><Reload /></Route>
            <Route path="/billing"><Reload /></Route>
            <Route path="/saas"><Reload /></Route>

            {/* 1. LEGACY TOP-LEVEL ALIASES & CONVENIENCE REDIRECTS (Redirect to canonical /armory paths) */}
            <Route path="/armory/new"><Redirect to="/armory/forge" /></Route>
            <Route path="/armory/apps/new"><Redirect to="/armory/forge" /></Route>
            <Route path="/apps/new"><Redirect to="/armory/forge" /></Route>
            <Route path="/apps/forge/history"><Redirect to="/armory/forge/history" /></Route>
            <Route path="/apps/forge/settings"><Redirect to="/armory/forge/settings" /></Route>
            <Route path="/apps/forge"><Redirect to="/armory/forge" /></Route>
            <Route path="/apps/:id">{(params) => <Redirect to={`/armory/apps/${params.id}`} />}</Route>
            <Route path="/apps"><Redirect to="/armory/apps" /></Route>
            <Route path="/app-forge"><Redirect to="/armory/forge" /></Route>
            <Route path="/appforge"><Redirect to="/armory/forge" /></Route>
            <Route path="/forms/builder/:id?">{(params) => <Redirect to={params.id ? `/armory/forms/builder/${params.id}` : "/armory/forms/builder"} />}</Route>
            <Route path="/forms"><Redirect to="/armory/forms" /></Route>
            <Route path="/admin/intelligence-forge"><Redirect to="/armory/forge" /></Route>
            <Route path="/tactics/intelligence-forge"><Redirect to="/armory/forge" /></Route>
            <Route path="/prospecting"><Redirect to="/armory/identity-bridge" /></Route>
            {/* Component gallery moved to Platform Maintenance */}
            <Route path="/armory/components"><Redirect to="/platform-maintenance/components" /></Route>

            {/* 2. CANONICAL ARMORY DOMAIN (Absolute Matching) */}
            <Route path="/armory/run-memory" component={AgentMemoryView} />
            <Route path="/armory/tools" component={ToolRegistry} />
            <Route path="/armory/apps/:id" component={AppDetail} />
            <Route path="/armory/apps" component={AppMarketplace} />
            <Route path="/armory/forge/history" component={ForgeHistory} />
            <Route path="/armory/forge/settings" component={ForgeSettings} />
            <Route path="/armory/forge" component={RedirectToCrewForge} />
            <Route path="/armory/forms/builder/:id?" component={FormStudioPage} />
            <Route path="/armory/forms" component={FormsLibraryPage} />
            <Route path="/armory/org-forge" component={OrgForge} />
            <Route path="/armory/x-ray">{() => <XrayCompositionExplorer />}</Route>
            <Route path="/armory/x-ray-legacy" component={SystemExplorerPage} />
            <Route path="/armory/identity-bridge" component={ProspectingDashboardPage} />
            <Route path="/armory/earnings" component={DeveloperEarnings} />
            <Route path="/armory"><AppsForgeOverview /></Route>


            {/* 3. CATCH-ALL 404 for this bundle */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </OrgProvider>
  );
}

