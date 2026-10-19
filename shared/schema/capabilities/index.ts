/**
 * Capability domain schema barrel.
 *
 * `manifest.ts` — the pure zod source-of-truth contract (client-safe).
 * `sync.ts`     — drizzle tables for the reconciler's durable state.
 */

export * from "./manifest.js";
export * from "./sync.js";
export * from "./proposals.js";
export * from "./gap-events.js";
