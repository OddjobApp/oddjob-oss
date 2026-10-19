import React, { lazy, ComponentType } from "react";

/**
 * Resilient lazy loader for Vite dynamic chunk imports.
 * Automatically retries failed dynamic imports caused by OneDrive file locking,
 * Vite hot-module reload churn, or stale chunk hashes.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  retriesLeft = 2,
  interval = 500
): React.LazyExoticComponent<T> {
  return lazy(() =>
    new Promise<{ default: T }>((resolve, reject) => {
      const attemptImport = (retries: number) => {
        componentImport()
          .then((module) => {
            sessionStorage.removeItem("oddjob_chunk_reload");
            resolve(module);
          })
          .catch((error) => {
            if (retries <= 0) {
              console.warn("[Vite Chunk Loader] Dynamic import failed after retries, checking reload fallback...", error);
              const hasReloaded = sessionStorage.getItem("oddjob_chunk_reload");
              if (!hasReloaded) {
                sessionStorage.setItem("oddjob_chunk_reload", "true");
                window.location.reload();
                return;
              }
              sessionStorage.removeItem("oddjob_chunk_reload");
              reject(error);
              return;
            }
            setTimeout(() => {
              attemptImport(retries - 1);
            }, interval);
          });
      };

      attemptImport(retriesLeft);
    })
  );
}
