import type { SessionStatus } from "../types/index.js";

/** Terminal session states — polling stops once a session reaches one of these. */
export const TERMINAL_STATUSES: readonly SessionStatus[] = [
  "completed",
  "failed",
  "timed_out",
  "cancelled",
];

export function isTerminalStatus(status?: SessionStatus | null): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}
