/**
 * FallbackManager — Backend Selection & Priority Chain
 *
 * Manages the selection and fallback ordering of reranking backends.
 * When a preferred backend is specified, it is used directly.
 * Otherwise, the system default (first in priority order) is selected.
 * On failure, nextBackend() walks the priority chain until exhausted.
 */

import type { RerankBackendType } from "./types.js";

export class FallbackManager {
  constructor(private priorityOrder: RerankBackendType[]) {}

  /**
   * Select the backend to use for a reranking request.
   * If a preferred backend is specified, returns it directly.
   * Otherwise returns the system default (first in priority order).
   */
  selectBackend(preferred?: RerankBackendType): RerankBackendType {
    if (preferred) {
      return preferred;
    }
    return this.priorityOrder[0];
  }

  /**
   * Get the next backend in the priority chain after the current one.
   * Returns null when the chain is exhausted (current is last or not found).
   */
  nextBackend(current: RerankBackendType): RerankBackendType | null {
    const index = this.priorityOrder.indexOf(current);
    if (index === -1 || index === this.priorityOrder.length - 1) {
      return null;
    }
    return this.priorityOrder[index + 1];
  }
}
