import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { OperationsRouting } from "@domain-ui/core/ui/components/routing/OperationsRouting";
import "@/index.css";

/**
 * Mission Operations SPA Entry Point
 * 
 * This bundle is optimized for the Operations domain, isolating the high-frequency
 * mission logs and real-time execution state from the main dashboard bundle.
 */
function OperationsApp() {
  return (
    <CoreProviders>
      <OperationsRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <OperationsApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
