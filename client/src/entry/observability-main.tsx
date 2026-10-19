import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { ObservabilityRouting } from "@domain-ui/core/ui/components/routing/ObservabilityRouting";
import "@/index.css";

/**
 * Observability & Monitoring SPA Entry Point
 * 
 * This bundle is optimized for the Observability domain, isolating the heavy 
 * metrics and chart libraries (Recharts) from the main dashboard bundle.
 */
function ObservabilityApp() {
  return (
    <CoreProviders>
      <ObservabilityRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <ObservabilityApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
