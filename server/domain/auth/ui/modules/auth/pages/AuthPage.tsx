import { useEffect, useState } from "react";
import { useAuth } from '../hooks/use-auth.js';
import Login from '../components/Login.js';
import Register from '../components/Register.js';

export default function AuthPage() {
  const { user, isVerified, isLoading } = useAuth();
  const [view, setView] = useState<'login' | 'register'>(() =>
    window.location.pathname === '/auth/signup' ? 'register' : 'login'
  );
  const [verificationTimedOut, setVerificationTimedOut] = useState(false);

  useEffect(() => {
    if (isVerified && !isLoading) return;

    // A failed or intercepted identity request must not leave the standalone
    // login entry behind its boot overlay forever. The login mutation can still
    // establish a fresh session, so reveal the form after a bounded wait.
    const timeout = window.setTimeout(() => {
      setVerificationTimedOut(true);
      window.clearLoginLoading?.();
    }, 5_000);

    return () => window.clearTimeout(timeout);
  }, [isVerified, isLoading]);

  useEffect(() => {
    // Only redirect if we have a user AND we've actually verified with the server.
    if (user && isVerified) {
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") || "";
      // Validate: only allow same-origin relative paths (no open-redirect), avoid auth/root loop
      // Default landing is the Launchpad, not the dashboard. `returnTo` still
      // wins when present, so deep links a user was sent to before authenticating
      // continue to resolve to that page rather than the default.
      const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/auth") && returnTo !== "/"
        ? returnTo
        : "/launchpad";
      const sep = safeReturn.includes("?") ? "&" : "?";
      // Full-document navigation: the login SPA and the dashboard SPA are
      // separate entry bundles, so we must hard-navigate to load the dashboard.
      // (A client-side router hook here also crashes the wouter-based login SPA,
      // which has no react-router <Router> in context.)
      window.location.href = `${safeReturn}${sep}login=1`;
      return;
    }

    if (isVerified && !user && !isLoading) {
      if ((window as any).clearLoginLoading) {
        (window as any).clearLoginLoading();
      }
    }
  }, [user, isVerified, isLoading]);

  // Stay in a blank/loading state while verifying to prevent UI flicker
  if ((!isVerified || isLoading) && !verificationTimedOut) {
    return null;
  }

  if (view === 'register') {
    return <Register onBackToLogin={() => setView('login')} />;
  }

  return <Login onRegisterClick={() => setView('register')} />;
}
