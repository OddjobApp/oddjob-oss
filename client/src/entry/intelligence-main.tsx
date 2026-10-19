import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { IntelligenceRouting } from "@domain-ui/core/ui/components/routing/IntelligenceRouting";
import "@/index.css";

/**
 * AI Intelligence & Analytics SPA Entry Point
 * 
 * This bundle is optimized for the Intelligence domain, isolating heavy charting
 * (Recharts) and predictive analytics logic from the main dashboard bundle.
 */
function IntelligenceApp() {
  return (
    <CoreProviders>
      <IntelligenceRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <IntelligenceApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
