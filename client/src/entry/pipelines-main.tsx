import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { PipelinesRouting } from "@domain-ui/core/ui/components/routing/PipelinesRouting";
import "@/index.css";

/**
 * Pipelines & Workstreams SPA Entry Point
 * 
 * This bundle is optimized for the Workstreams domain, isolating the heavy 
 * diagramming and execution analysis logic from the main dashboard bundle.
 */
function PipelinesApp() {
  return (
    <CoreProviders>
      <PipelinesRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <PipelinesApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
