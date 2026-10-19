// Moving client/src/main.tsx to client/src/entry/main.tsx
// Updating relative imports (../App instead of ./App)
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import "../index.css";
import { initPrefetch } from "../lib/prefetch-loader";

// Global error handlers
let errorReportCount = 0;
const MAX_ERROR_REPORTS = 5;

window.addEventListener('error', (event: any) => {
  const errorMessage = event.message || '';
  const errorSource = event.filename || '';

  if (
    errorMessage.includes('Could not establish connection') ||
    errorMessage.includes('Receiving end does not exist') ||
    errorMessage.includes('Extension context invalidated') ||
    errorSource.includes('chrome-extension://') ||
    errorSource.includes('moz-extension://') ||
    errorSource.includes('safari-extension://')
  ) {
    return false;
  }

  if (errorReportCount >= MAX_ERROR_REPORTS) return;
  errorReportCount++;

  fetch('/api/debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      message: errorMessage || 'ObjectError',
      source: errorSource,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack
    })
  }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event: any) => {
  const reason = event.reason?.message || String(event.reason || '');

  if (
    reason.includes('Could not establish connection') ||
    reason.includes('Receiving end does not exist') ||
    reason.includes('Extension context invalidated') ||
    reason.includes('Receiving end')
  ) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  if (errorReportCount >= MAX_ERROR_REPORTS) return;
  errorReportCount++;

  fetch('/api/debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      message: 'Unhandled Rejection: ' + (reason || 'ObjectReason'),
      stack: event.reason?.stack
    })
  }).catch(() => {});
});

try {
  // Fire prefetch concurrently with component hydration — non-blocking, fire-and-forget.
  // initPrefetch is fully fault-tolerant and never throws.
  initPrefetch(window.location.pathname);

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // Clear the HTML overlay after React's first paint — two rAFs guarantee
  // the browser has composited at least one frame before we fade the overlay.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if ((window as any).clearBootstrapTimer) (window as any).clearBootstrapTimer();
  }));
} catch (err: any) {
  console.error("[FATAL] App render failed:", err);

  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 24px; background: #09090b; color: #fecaca; min-height: 100vh; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="max-width: 600px; width: 100%; background: #450a0a; border: 1px solid #ef4444; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <h1 style="margin-top: 0; font-size: 1.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; display: flex; align-items: center; gap: 12px;">
            <span style="background: #ef4444; color: white; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 14px;">!</span>
            Bootstrap Failure
          </h1>
          <p style="font-size: 0.9rem; margin: 16px 0; color: #fca5a5; line-height: 1.6;">
            The Command Interface encountered a fatal error during initialization. This is usually caused by a broken module import or a crash in a core provider.
          </p>
          <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 8px; overflow: auto; max-height: 300px; border: 1px solid rgba(255,255,255,0.1);">
            <pre style="margin: 0; font-family: monospace; font-size: 0.75rem; line-height: 1.4;">\${err.message}\\n\\n\${err.stack}</pre>
          </div>
          <div style="margin-top: 24px; display: flex; gap: 12px;">
            <button onclick="window.location.reload()" style="flex: 1; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem;">
              Retry Initialization
            </button>
            <button onclick="window.location.href='/auth/login'" style="flex: 1; background: #27272a; color: white; border: 1px solid #3f3f46; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem;">
              Back to Auth
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
