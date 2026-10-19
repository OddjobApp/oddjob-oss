import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { SuperAdminRoute } from "@/lib/SuperAdminRoute";
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
// ADMIN DOMAIN PAGES
// ============================================================================

const CredentialNew = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/CredentialNew"));
const ConnectionsOverview = lazy(() => import("@/modules/connections/pages/ConnectionsOverview"));
const OrganizationsPage = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/Organizations"));
const OrganizationDetailPage = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/OrganizationDetail"));
const AccountAdminOverview = lazy(() => import("@/modules/account-admin/pages/AccountAdminOverview"));
const PlatformMaintenanceOverview = lazy(() => import("@/modules/platform-maintenance/pages/PlatformMaintenanceOverview"));
const PlatformOverview = lazy(() => import("@/modules/platform/pages/PlatformOverview"));
const SnapshotManager = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/SnapshotManager"));
const ToolRegistry = lazy(() => import("@domain-ui/tools/ui/modules/tools/pages/ToolRegistry"));
const McpTokens = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/McpTokens"));
const Credentials = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/Credentials"));
const CredentialDetail = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/CredentialDetail"));
const Settings = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/Settings"));
const Users = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/Users"));
const UserDetail = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/UserDetail"));
const Profile = lazy(() => import("@domain-ui/admin/ui/modules/admin/components/Profile"));
const ErrorClusters = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/ErrorClusters"));
const ErrorPatterns = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/ErrorPatterns"));
const IntegrationsAdmin = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/IntegrationsAdmin"));
const AuditLogPage = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/AuditLog"));
const SkillRegistry = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/SkillRegistry"));
const UCIHub = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/UCIHub"));
const ScoringStudio = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/ScoringStudio"));
const DocumentationManager = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/DocumentationManager"));
const SystemKnowledgeGraph = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/SystemKnowledgeGraph"));
const LicensingPage = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/Licensing"));
const OrganizationBilling = lazy(() => import("@domain-ui/ecommerce/ui/modules/billing/pages/OrganizationBilling"));
const DependencyTracker = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/DependencyTracker"));
const EvaluationStudio = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/EvaluationStudio"));
const AutoresearchDashboard = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/AutoresearchDashboard"));
const EvolutionFlightDeck = lazy(() => import("@domain-ui/admin/ui/modules/admin/pages/EvolutionFlightDeck"));
const SaaSConnectorsPage = lazy(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/ConnectorsDashboard"));
const SaaSEventWorkflowsPage = lazy(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/EventWorkflows"));
const SaaSSyncConfigPage = lazy(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/SyncConfiguration"));
const SaaSAnalyticsPage = lazy(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/IntegrationAnalytics"));

// Other shared
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));

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
 * AdminRoutingRoutes provides the admin route definitions as a composable sub-router
 * without its own Layout or OrgProvider wrapper. This allows it to be embedded
 * within OperationsRouting (which already provides those wrappers).
 */
export function AdminRoutingRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Mach 3 Multi-SPA Ejection Failsafes — routes owned by other SPAs */}
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

        <Route path="/dashboard"><Reload /></Route>
        <Route path="/dashboard/:rest*"><Reload /></Route>

        {/* Connections canonical routes */}
        <Route path="/connections/credentials/new" component={CredentialNew} />
        <Route path="/connections/credentials/:id" component={CredentialDetail} />
        <Route path="/connections/credentials" component={Credentials} />
        <Route path="/connections/integrations" component={IntegrationsAdmin} />
        <Route path="/connections/mcp-tokens" component={McpTokens} />
        <Route path="/connections/saas/workflows" component={SaaSEventWorkflowsPage} />
        <Route path="/connections/saas/sync-config" component={SaaSSyncConfigPage} />
        <Route path="/connections/saas/analytics" component={SaaSAnalyticsPage} />
        <Route path="/connections/saas" component={SaaSConnectorsPage} />
        <Route path="/connections" component={ConnectionsOverview} />

        {/* Connections legacy redirects */}
        <Route path="/credentials/new"><Redirect to="/connections/credentials/new" /></Route>
        <Route path="/credentials/:id">{(params) => <Redirect to={`/connections/credentials/${params.id}`} />}</Route>
        <Route path="/credentials"><Redirect to="/connections/credentials" /></Route>
        <Route path="/admin/integrations"><Redirect to="/connections/integrations" /></Route>
        <Route path="/admin/mcp-tokens"><Redirect to="/connections/mcp-tokens" /></Route>
        <Route path="/saas/workflows"><Redirect to="/connections/saas/workflows" /></Route>
        <Route path="/saas/sync-config"><Redirect to="/connections/saas/sync-config" /></Route>
        <Route path="/saas/analytics"><Redirect to="/connections/saas/analytics" /></Route>
        <Route path="/saas/connectors"><Redirect to="/connections/saas" /></Route>
        <Route path="/saas"><Redirect to="/connections/saas" /></Route>

        {/* Account & Admin canonical routes */}
        <Route path="/account-admin/organizations/:id" component={OrganizationDetailPage} />
        <Route path="/account-admin/organizations" component={OrganizationsPage} />
        <Route path="/account-admin/users/:id" component={UserDetail} />
        <Route path="/account-admin/users" component={Users} />
        <Route path="/account-admin/billing" component={OrganizationBilling} />
        <Route path="/account-admin/licensing" component={LicensingPage} />
        <Route path="/account-admin" component={AccountAdminOverview} />

        {/* Account & Admin legacy redirects */}
        <Route path="/organizations/:id">{(params) => <Redirect to={`/account-admin/organizations/${params.id}`} />}</Route>
        <Route path="/organizations"><Redirect to="/account-admin/organizations" /></Route>
        <Route path="/users/:id">{(params) => <Redirect to={`/account-admin/users/${params.id}`} />}</Route>
        <Route path="/users"><Redirect to="/account-admin/users" /></Route>
        <Route path="/billing"><Redirect to="/account-admin/billing" /></Route>
        <Route path="/admin/licensing"><Redirect to="/account-admin/licensing" /></Route>

        {/* Platform Maintenance canonical routes */}
        <Route path="/platform-maintenance/snapshots" component={SnapshotManager} />
        <Route path="/platform-maintenance/documentation" component={DocumentationManager} />
        <Route path="/platform-maintenance/software-audit" component={DependencyTracker} />
        <Route path="/platform-maintenance/evolution" component={EvolutionFlightDeck} />
        <Route path="/platform-maintenance/autoresearch" component={AutoresearchDashboard} />
        <Route path="/platform-maintenance/system-graph">
          <SuperAdminRoute path="/platform-maintenance/system-graph" component={SystemKnowledgeGraph} />
        </Route>
        <Route path="/platform-maintenance" component={PlatformMaintenanceOverview} />

        {/* Platform Maintenance legacy redirects */}
        <Route path="/snapshots"><Redirect to="/platform-maintenance/snapshots" /></Route>
        <Route path="/admin/documentation"><Redirect to="/platform-maintenance/documentation" /></Route>
        <Route path="/admin/dependencies"><Redirect to="/platform-maintenance/software-audit" /></Route>
        <Route path="/admin/evolution"><Redirect to="/platform-maintenance/evolution" /></Route>
        <Route path="/admin/autoresearch"><Redirect to="/platform-maintenance/autoresearch" /></Route>
        <Route path="/admin/system-graph"><Redirect to="/platform-maintenance/system-graph" /></Route>

        {/* Health / Observability legacy redirects */}
        <Route path="/admin/events"><Redirect to="/health/events" /></Route>
        <Route path="/admin/alerts"><Redirect to="/health/alerts" /></Route>
        <Route path="/admin/diagnoses"><Redirect to="/health/incidents" /></Route>
        <Route path="/admin/infra-health"><Redirect to="/health/infra-health" /></Route>

        {/* Platform overview */}
        <Route path="/platform" component={PlatformOverview} />

        {/* Profile */}
        <Route path="/settings" component={Settings} />
        <Route path="/profile" component={Profile} />

        {/* Organizations & Admin Tools */}
        <Route path="/admin/audit" component={AuditLogPage} />
        <Route path="/tactics/tools" component={ToolRegistry} />
        <Route path="/admin/skill-registry" component={SkillRegistry} />
        <Route path="/admin/uci-hub" component={UCIHub} />
        <Route path="/admin/clusters" component={ErrorClusters} />
        <Route path="/admin/patterns" component={ErrorPatterns} />
        <Route path="/admin/scoring" component={ScoringStudio} />
        <Route path="/admin/evaluation-studio" component={EvaluationStudio} />
        <Route path="/admin/intelligence-forge"><ExternalRedirect to="/armory/forge" /></Route>
        <Route path="/admin/decision-inbox"><ExternalRedirect to="/control/decisions" /></Route>
        <Route path="/tactics/intelligence-forge"><ExternalRedirect to="/armory/forge" /></Route>

        {/* 404 handler for this entry point */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

/**
 * AdminRouting handles the routes specifically for the Administrative SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 *
 * @deprecated Use AdminRoutingRoutes composed within OperationsRouting instead.
 * This standalone entry point is retained for backward compatibility during migration.
 */
export function AdminRouting() {
  return (
    <OrgProvider>
      <Layout>
        <AdminRoutingRoutes />
      </Layout>
    </OrgProvider>
  );
}
