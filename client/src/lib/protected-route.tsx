import { useLocation } from "wouter";
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { useEffect } from "react";

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType<any>;
}

export function ProtectedRoute({ path, component: Component }: ProtectedRouteProps) {
  const [, setLocation] = useLocation();
  const { user, isLoading } = useAuth();

  // Auth check is now handled by the top-level Layout and CoreRouting components 
  // to ensure unified grace-period handling across the entire SPA.
  useEffect(() => {
    // Left empty — Redirection is managed by Layout.tsx/AuthPage.tsx logic
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  return <Component />;
}

