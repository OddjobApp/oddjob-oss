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
// KNOWLEDGE DOMAIN PAGES
// ============================================================================

const KnowledgeGraph = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/KnowledgeGraph"));
const QueryBuilder = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/QueryBuilder"));
const KnowledgeGarden = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/KnowledgeGarden"));
const KnowledgeDashboard = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/KnowledgeDashboard"));
const AgencyMaturityDashboard = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/AgencyMaturityDashboard"));
const KnowledgeStorePage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/KnowledgeStore"));
const KnowledgeDatasetsPage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/FineTuningDatasets"));
const KnowledgeSearchPage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/KnowledgeSearch"));
const KnowledgeDatasetDetailPage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/DatasetDetail"));
const DocumentTemplatesPage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/DocumentTemplates"));
const SchemaManager = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/SchemaManager"));
const OntologyExplorer = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/OntologyExplorer"));
const DatasetsPage = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/DatasetManager"));
const DatasetDetail = lazy(() => import("@domain-ui/knowledge/ui/modules/knowledge/pages/DatasetManagerDetail"));
const ForensicAnalysisPage = lazy(() => import("@domain-ui/pipeline/ui/modules/pipelines/pages/ForensicAnalysis"));
const KnowledgeOverview = lazy(() => import("@/modules/knowledge/pages/KnowledgeOverview"));
const CalculationsPage = lazy(() => import("@/modules/knowledge/pages/CalculationsPage"));
const FineTuningDashboard = lazy(() => import("@domain-ui/ai/ui/modules/ai/pages/FineTuningDashboard"));

// Other shared
const NotFound = lazy(() => import("@domain-ui/core/ui/pages/NotFound"));

// Mach 3 Ejection Helper
function Reload() {
  React.useEffect(() => { window.location.reload(); }, []);
  return null;
}

/**
 * KnowledgeRouting handles the routes specifically for the Knowledge SPA.
 * Renders inside the standard Layout to maintain sidebar and header consistency.
 */
export function KnowledgeRouting() {
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
            <Route path="/pipelines"><Reload /></Route>
            <Route path="/pipelines/:rest*"><Reload /></Route>
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
            <Route path="/billing"><Reload /></Route>
            <Route path="/saas"><Reload /></Route>

            {/* Legacy Knowledge redirects */}
            <Route path="/knowledge-store"><Redirect to="/knowledge/store" /></Route>
            <Route path="/datasets/:id">{(params) => <Redirect to={`/knowledge/datasets/${params.id}`} />}</Route>
            <Route path="/datasets"><Redirect to="/knowledge/datasets" /></Route>
            <Route path="/knowledge/data-repository/:id">{(params) => <Redirect to={`/knowledge/datasets/${params.id}`} />}</Route>
            <Route path="/knowledge/data-repository"><Redirect to="/knowledge/datasets" /></Route>

            {/* Knowledge Domain Routes */}
            <Route path="/knowledge/store" component={KnowledgeStorePage} />
            <Route path="/knowledge/fine-tuning/datasets/:id" component={KnowledgeDatasetDetailPage} />
            <Route path="/knowledge/fine-tuning/datasets" component={KnowledgeDatasetsPage} />
            <Route path="/knowledge/fine-tuning" component={FineTuningDashboard} />

            <Route path="/knowledge/datasets/:id" component={DatasetDetail} />
            <Route path="/knowledge/datasets" component={DatasetsPage} />
            <Route path="/knowledge/search" component={KnowledgeSearchPage} />
            <Route path="/knowledge/schemas" component={SchemaManager} />
            <Route path="/knowledge/query-builder" component={QueryBuilder} />
            <Route path="/knowledge/graph">
              {(params) => <KnowledgeGraph />}
            </Route>
            <Route path="/knowledge/compare-runs" component={ForensicAnalysisPage} />
            <Route path="/knowledge/garden" component={KnowledgeGarden} />
            <Route path="/knowledge/maturity" component={AgencyMaturityDashboard} />
            {/* Component gallery moved to Platform Maintenance */}
            <Route path="/knowledge/components"><Redirect to="/platform-maintenance/components" /></Route>
            <Route path="/armory/components"><Redirect to="/platform-maintenance/components" /></Route>
            <Route path="/knowledge/document-templates" component={DocumentTemplatesPage} />
            <Route path="/knowledge/status" component={KnowledgeDashboard} />
            <Route path="/knowledge/calculations" component={CalculationsPage} />
            <Route path="/knowledge/ontology" component={OntologyExplorer} />
            <Route path="/knowledge" component={KnowledgeOverview} />

            {/* 404 handler for this entry point */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
    </OrgProvider>
  );
}

