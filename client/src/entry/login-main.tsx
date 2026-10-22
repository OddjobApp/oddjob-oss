import React, { Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import "../index.css";

declare global {
  interface Window {
    clearLoginLoading?: () => void;
  }
}

// Auth Components (Eager for speed)
import AuthPage from "@domain-ui/auth/ui/modules/auth/pages/AuthPage";
const ForgotPassword = lazy(() => import("@domain-ui/auth/ui/modules/auth/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@domain-ui/auth/ui/modules/auth/pages/ResetPassword"));
const AcceptInvite = lazy(() => import("@domain-ui/auth/ui/modules/auth/pages/AcceptInvite"));

// Public/External Pages (Lazy)
const Overview = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.Overview })));
const MarketingPage = lazy(() => import('../pages/marketing/MarketingPage'));
const PublicFormPage = lazy(() => import('../modules/forms/pages/PublicFormPage'));
const PublicDocumentation = lazy(() => import("../pages/public/PublicDocumentation"));
const UseCases = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.UseCases })));
const GettingStarted = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.GettingStarted })));
const Support = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.Support })));
const LegalPage = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.LegalPage })));
const PublicNotFound = lazy(() => import('../pages/public/PublicPages').then(m => ({ default: m.PublicNotFound })));
const ExternalTaskPage = lazy(() => import("@domain-ui/core/ui/pages/ExternalTaskPage"));
const TrustPage = lazy(() => import("@domain-ui/core/ui/pages/TrustPage"));
const RescuePublicPage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/RescuePublicPage"));
const HelperAcceptancePage = lazy(() => import("@domain-ui/rescue/ui/modules/rescue/pages/HelperAcceptancePage"));
import AgentDeploymentPage from "@domain-ui/agents/ui/modules/agents/pages/AgentDeploymentPage";
const PublicAppDeploymentPage = lazy(() => import("@domain-ui/apps/ui/modules/apps/pages/PublicAppDeploymentPage"));
const BuilderPodsShowcasePage = lazy(() => import("../pages/dev/BuilderPodsShowcasePage"));

/**
 * Standalone Login SPA.
 * Uses CoreProviders for shared theme/auth state, but implements its own
 * lightweight routing to avoid the weight of the main dashboard SPA.
 */
function LoginApp() {
  const [location] = useLocation();

  useEffect(() => {
    // AuthPage clears the boot overlay itself, only after session verification, to
    // avoid the login form blinking. Public routes in this entry (trust, external
    // tasks, rescue links, public app/agent pages) render their own component and
    // nothing else dismisses the overlay — so it would sit on top forever (black
    // page + spinner). Clear it here for any non-auth route.
    const isAuthRoute = location.startsWith("/auth") || location === "/login" || location === "/signup";
    if (!isAuthRoute) {
      window.clearLoginLoading?.();
    }
  }, [location]);

  return (
    <CoreProviders publicEntry>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Switch>
          <Route path="/auth/forgot-password" component={ForgotPassword} />
          <Route path="/auth/reset-password" component={ResetPassword} />
          <Route path="/auth/invite" component={AcceptInvite} />
          <Route path="/auth/signup" component={AuthPage} />
          <Route path="/auth/login" component={AuthPage} />
          <Route path="/auth" component={AuthPage} />
          <Route path="/login" component={AuthPage} />
          <Route path="/signup">{() => <Redirect to="/auth/signup" />}</Route>
          
          {/* Public routes (no layout) */}
          <Route path="/overview" component={Overview} />
          <Route path="/use-cases" component={UseCases} />
          <Route path="/docs/:slug">{params => <PublicDocumentation slug={params.slug} />}</Route>
          <Route path="/docs"><PublicDocumentation /></Route>
          <Route path="/getting-started" component={GettingStarted} />
          <Route path="/contact" component={Support} />
          <Route path="/privacy">{() => <LegalPage kind="privacy" />}</Route>
          <Route path="/terms">{() => <LegalPage kind="terms" />}</Route>
          <Route path="/404" component={PublicNotFound} />
          <Route path="/dev/builder-pods" component={BuilderPodsShowcasePage} />
          <Route path="/external/builder-pods" component={BuilderPodsShowcasePage} />
          <Route path="/external/task" component={ExternalTaskPage} />
          <Route path="/external/forms/:token" component={PublicFormPage} />
          <Route path="/hil-form/:id" component={ExternalTaskPage} />
          <Route path="/trust" component={TrustPage} />
          <Route path="/r/:token" component={RescuePublicPage} />
          <Route path="/h/:token" component={HelperAcceptancePage} />
          <Route path="/a/:slug" component={AgentDeploymentPage} />
          {/* Org-scoped form. An app can be deployed once per organization — app 824
              has one deployment in org 473 and another in 291 — so /app/:slug alone
              cannot say which one is meant and fell back to session state. Naming the
              org in the path makes the link mean exactly one thing wherever it is
              opened. The bare /app/:slug below still resolves, for links already in
              circulation. */}
          <Route path="/o/:orgId/app/:slug" component={PublicAppDeploymentPage} />
          <Route path="/app/:slug" component={PublicAppDeploymentPage} />

          <Route path="/" component={MarketingPage} />
          <Route>
            {() => {
              // Unknown public links have a recovery page even for signed-in users.
              return <PublicNotFound />;
            }}
          </Route>
        </Switch>
      </Suspense>
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <LoginApp />
  </React.StrictMode>
);

// Loading state cleanup is now handled by AuthPage to prevent blinking during session verification.
