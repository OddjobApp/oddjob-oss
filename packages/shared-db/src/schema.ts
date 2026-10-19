/**
 * Schema Re-exports
 * 
 * Re-exports all schema definitions from the shared schema package.
 * This allows services to import schema from @oddjob/shared-db/schema
 * while keeping the actual definitions in a central location.
 */

// Re-export everything from the shared schema
export * from "../../../shared/schema/index.js";

