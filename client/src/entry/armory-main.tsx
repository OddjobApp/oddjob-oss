import React from "react";
import { createRoot } from "react-dom/client";
import { ArmoryRouting } from "@domain-ui/core/ui/components/routing/ArmoryRouting";
import { CoreProviders } from "@domain-ui/core/ui/components/providers/CoreProviders";
import "@/index.css";

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  console.log("[Armory-Init] Bootstrapping developer domain...");

  createRoot(rootElement).render(
    <React.StrictMode>
      <CoreProviders>
        <ArmoryRouting />
      </CoreProviders>
    </React.StrictMode>
  );

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if ((window as any).clearBootstrapTimer) (window as any).clearBootstrapTimer();
    console.log("[Armory-Init] Bootstrap complete.");
  }));
} catch (err: any) {
  console.error("[FATAL] Armory render failed:", err);
  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML = `<div style="padding: 24px; color: #ef4444;"><h1>Armory Error</h1><pre>${err.message}</pre></div>`;
  }
}
