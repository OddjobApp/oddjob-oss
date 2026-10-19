import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { OrgProvider } from "@domain-ui/core/ui/hooks/use-org-context";
import { SuperAdminRoute } from "@/lib/SuperAdminRoute";
import { Loader2 } from "lucide-react";
import Layout from "@domain-ui/core/ui/components/layout/Layout";
import DependencyTracker from "@domain-ui/admin/ui/modules/admin/pages/DependencyTracker";
import { lazyWithRetry } from "@/lib/lazy-retry";

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

const CredentialNew = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/CredentialNew"));
const ConnectionsOverview = lazyWithRetry(() => import("@/modules/connections/pages/ConnectionsOverview"));
const OutcomeOnboarding = lazyWithRetry(() => import("@/modules/connections/pages/OutcomeOnboarding"));
const OrganizationsPage = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/Organizations"));
const OrganizationDetailPage = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/OrganizationDetail"));
const AccountAdminOverview = lazyWithRetry(() => import("@/modules/account-admin/pages/AccountAdminOverview"));
const PlatformMaintenanceOverview = lazyWithRetry(() => import("@/modules/platform-maintenance/pages/PlatformMaintenanceOverview"));
const ComponentStyleGallery = lazyWithRetry(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/ComponentStyleGallery"));
const PlatformOverview = lazyWithRetry(() => import("@/modules/platform/pages/PlatformOverview"));
const SnapshotManager = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/SnapshotManager"));
const McpTokens = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/McpTokens"));
const Credentials = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/Credentials"));
const CredentialDetail = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/CredentialDetail"));
const Settings = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/Settings"));
const Users = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/Users"));
const UserDetail = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/UserDetail"));
const Profile = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/components/Profile"));
const ErrorClusters = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/ErrorClusters"));
const ErrorPatterns = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/ErrorPatterns"));
const IntegrationsAdmin = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/IntegrationsAdmin"));
const AuditLogPage = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/AuditLog"));
const SkillRegistry = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/SkillRegistry"));
const UCIHub = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/UCIHub"));
const ScoringStudio = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/ScoringStudio"));
const DocumentationManager = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/DocumentationManager"));
const KnowledgePacksPage = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/KnowledgePacks"));
const SystemKnowledgeGraph = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/SystemKnowledgeGraph"));
const LicensingPage = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/Licensing"));
const OrganizationBilling = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/billing/pages/OrganizationBilling"));
const EvaluationStudio = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/EvaluationStudio"));
const AutoresearchDashboard = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/AutoresearchDashboard"));
const EvolutionFlightDeck = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/EvolutionFlightDeck"));
const AgentIdentityControl = lazyWithRetry(() => import("@domain-ui/admin/ui/modules/admin/pages/AgentIdentityControl"));
const SaaSConnectorsPage = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/ConnectorsDashboard"));
const SaaSEventWorkflowsPage = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/EventWorkflows"));
const SaaSSyncConfigPage = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/SyncConfiguration"));
const SaaSAnalyticsPage = lazyWithRetry(() => import("@domain-ui/ecommerce/ui/modules/saas/pages/IntegrationAnalytics"));

// Other shared
const NotFound = lazyWithRetry(() => import("@domain-ui/core/ui/pages/NotFound"));

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
        <Route path="/launchpad"><Reload /></Route>
        <Route path="/launch"><Reload /></Route>
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

        {/* Connections & SaaS Sync */}
        <Route path="/connections/saas/connectors" component={SaaSConnectorsPage} />
        <Route path="/connections/saas/workflows" component={SaaSEventWorkflowsPage} />
        <Route path="/connections/saas/sync-config" component={SaaSSyncConfigPage} />
        <Route path="/connections/saas/analytics" component={SaaSAnalyticsPage} />
        <Route path="/connections/saas" component={SaaSConnectorsPage} />
        <Route path="/connections/outcome-onboarding" component={OutcomeOnboarding} />

        {/*
          These three are what AppSidebar (Connections group) and the breadcrumb
          map have always pointed at, but they were only ever registered at their
          legacy top-level paths below — so every Connections nav item except
          "SaaS Connectors" led to NotFound. Registered here at the advertised
          paths; the legacy aliases stay for existing links and bookmarks.
          Ordered longest-first: wouter's Switch takes the first match, so
          /connections/credentials/new must precede /connections/credentials/:id.
        */}
        <Route path="/connections/credentials/new" component={CredentialNew} />
        <Route path="/connections/credentials/:id" component={CredentialDetail} />
        <Route path="/connections/credentials" component={Credentials} />
        <Route path="/connections/integrations" component={IntegrationsAdmin} />
        <Route path="/connections/mcp-tokens" component={McpTokens} />

        <Route path="/connections" component={ConnectionsOverview} />

        {/* Credentials — legacy top-level aliases */}
        <Route path="/credentials/new" component={CredentialNew} />
        <Route path="/credentials/:id" component={CredentialDetail} />
        <Route path="/credentials" component={Credentials} />

        {/* Account & Platform Maintenance */}
        {/*
          The Account & Admin pages are linked as /account-admin/* throughout the
          app — Organizations.tsx, Users.tsx and UserDetail.tsx all build hrefs
          that way, and UserDetail matches useRoute('/account-admin/users/:id').
          Only the bare /account-admin was registered here, so every one of those
          links landed on NotFound while the breadcrumb still resolved from the
          path and looked correct. CoreRouting also redirects /billing to
          /account-admin/billing, which had the same problem.

          Declared before the bare path so wouter matches the specific route
          first; the components are the same ones the legacy top-level aliases
          below serve.
        */}
        <Route path="/account-admin/organizations/:id" component={OrganizationDetailPage} />
        <Route path="/account-admin/organizations" component={OrganizationsPage} />
        <Route path="/account-admin/users/:id" component={UserDetail} />
        <Route path="/account-admin/users" component={Users} />
        <Route path="/account-admin/billing" component={OrganizationBilling} />
        <Route path="/account-admin/licensing" component={LicensingPage} />
        <Route path="/account-admin" component={AccountAdminOverview} />
        <Route path="/platform-maintenance/snapshots" component={SnapshotManager} />
        <Route path="/platform-maintenance/documentation" component={DocumentationManager} />
        <Route path="/platform-maintenance/knowledge-packs" component={KnowledgePacksPage} />
        {/*
          Software Audit is the dependency/package view — the Platform Maintenance
          card that links here promises "dependency health, security alerts, package
          drift, and remediation signals". It pointed at AuditLogPage, which is the
          generic activity log and is already served at /admin/audit below, so this
          route showed an (empty) audit trail and installed packages were nowhere in
          the Platform Maintenance section.
        */}
        <Route path="/platform-maintenance/software-audit" component={DependencyTracker} />
        <Route path="/platform-maintenance/evolution" component={EvolutionFlightDeck} />
        <Route path="/platform-maintenance/autoresearch" component={AutoresearchDashboard} />
        <Route path="/platform-maintenance/system-graph" component={SystemKnowledgeGraph} />
        <Route path="/platform-maintenance/components" component={ComponentStyleGallery} />
        <Route path="/platform-maintenance" component={PlatformMaintenanceOverview} />

        {/* Organizations & Users */}
        <Route path="/organizations/:id" component={OrganizationDetailPage} />
        <Route path="/organizations" component={OrganizationsPage} />
        <Route path="/users/:id" component={UserDetail} />
        <Route path="/users" component={Users} />

        {/* Billing */}
        <Route path="/billing" component={OrganizationBilling} />

        {/* Admin Tools & Legacy Aliases */}
        <Route path="/snapshots" component={SnapshotManager} />
        <Route path="/admin/documentation" component={DocumentationManager} />
        <Route path="/admin/system-graph" component={SystemKnowledgeGraph} />
        <Route path="/admin/mcp-tokens" component={McpTokens} />
        <Route path="/admin/style-gallery" component={ComponentStyleGallery} />
        <Route path="/admin/integrations" component={IntegrationsAdmin} />
        <Route path="/admin/licensing" component={LicensingPage} />
        <Route path="/admin/dependencies" component={DependencyTracker} />
        <Route path="/admin/autoresearch" component={AutoresearchDashboard} />
        <Route path="/admin/evolution" component={EvolutionFlightDeck} />

        {/* Platform overview */}
        <Route path="/platform" component={PlatformOverview} />

        {/* Profile */}
        <Route path="/settings" component={Settings} />
        <Route path="/profile" component={Profile} />

        {/* Organizations & Admin Tools */}
        <Route path="/admin/audit" component={AuditLogPage} />
        <Route path="/admin/skill-registry" component={SkillRegistry} />
        <Route path="/admin/uci-hub" component={UCIHub} />
        <Route path="/admin/clusters" component={ErrorClusters} />
        <Route path="/admin/patterns" component={ErrorPatterns} />
        <Route path="/admin/scoring" component={ScoringStudio} />
        <Route path="/admin/evaluation-studio" component={EvaluationStudio} />
        <Route path="/admin/agent-identities" component={AgentIdentityControl} />
        <Route path="/admin/intelligence-forge"><ExternalRedirect to="/armory/forge" /></Route>
        <Route path="/admin/decision-inbox"><ExternalRedirect to="/assistant/workbench" /></Route>
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
