import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { KnowledgeRouting } from "@domain-ui/core/ui/components/routing/KnowledgeRouting";
import "@/index.css";

/**
 * Knowledge Intelligence SPA Entry Point
 * 
 * This bundle is optimized for the Knowledge domain, isolating the heavy 
 * visualization requirements (Vis.js, Recharts) from the main dashboard bundle.
 */
function KnowledgeApp() {
  return (
    <CoreProviders>
      <KnowledgeRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <KnowledgeApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
