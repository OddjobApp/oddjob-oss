import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "@domain-ui/core/ui/components/theme-provider";
import { AuthProvider } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { MaintenanceProvider } from "@/contexts/MaintenanceContext";
import { ErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { Toaster } from "@domain-ui/core/ui/components/ui/toaster";

interface CoreProvidersProps {
  children: React.ReactNode;
}

/**
 * CoreProviders wraps the application in the essential context providers
 * required for global state (Auth, Theme, Maintenance, QueryClient).
 * This component is shared across all SPA entry points (Main, Login, Knowledge, etc.).
 */
export function CoreProviders({ children }: CoreProvidersProps) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="oj-ui-theme">
          <AuthProvider>
            <MaintenanceProvider>
              {children}
              <Toaster />
            </MaintenanceProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
