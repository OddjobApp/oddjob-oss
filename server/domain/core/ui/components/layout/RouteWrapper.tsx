
import React, { Suspense } from "react";
import Layout from './Layout.js';
import { ProtectedRoute } from "@/lib/protected-route";
import { Loader2 } from "lucide-react";

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

interface RouteWrapperProps {
  component: React.ComponentType<any>;
  path: string;
  useLayout?: boolean;
}

/**
 * RouteWrapper consolidates the repetitive Layout > Suspense > ProtectedRoute pattern.
 */
export function RouteWrapper({ component: Component, path, useLayout = true }: RouteWrapperProps) {
  const content = (
    <Suspense fallback={<PageLoader />}>
      <ProtectedRoute path={path} component={Component} />
    </Suspense>
  );

  if (useLayout) {
    return <Layout>{content}</Layout>;
  }

  return content;
}
