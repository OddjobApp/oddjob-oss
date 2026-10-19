import React from "react";
import { createRoot } from "react-dom/client";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import { AdminRouting } from "@domain-ui/core/ui/components/routing/AdminRouting";
import "@/index.css";

/**
 * System Administration SPA Entry Point
 * 
 * This bundle is optimized for the Admin domain, isolating management forms 
 * and organizational settings from the core operational flow.
 */
function AdminApp() {
  return (
    <CoreProviders>
      <AdminRouting />
    </CoreProviders>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).clearBootstrapTimer?.();
}));
