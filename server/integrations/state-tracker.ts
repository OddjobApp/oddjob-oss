/**
 * State Tracker Interface
 * 
 * Defines the interface for tracking pipeline execution state,
 * including visit counts and payload hashes for Loopbane Protocols.
 */

export interface StateTracker {
  /**
   * Increment visit count for a step in an execution
   * @returns The new visit count after incrementing
   */
  incrementVisit(executionId: number, stepId: number): Promise<number>;

  /**
   * Get current visit count for a step in an execution
   */
  getVisitCount(executionId: number, stepId: number): Promise<number>;

  /**
   * Store payload hash for a step in an execution
   */
  setPayloadHash(executionId: number, stepId: number, hash: string): Promise<void>;

  /**
   * Get stored payload hash for a step in an execution
   * @returns The hash string or null if not found
   */
  getPayloadHash(executionId: number, stepId: number): Promise<string | null>;

  /**
   * Clear all state for an execution (cleanup)
   */
  clearExecutionState(executionId: number): Promise<void>;
}


