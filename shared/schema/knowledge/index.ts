/**
 * Knowledge Schema - Directory Index
 * 
 * Re-exports all knowledge-related schema definitions from modular specialized sub-schemas.
 */

// Legacy/Base re-exports (relative to this index)
export * from '../knowledge-base.js';
export * from '../knowledge-config.js';
export * from '../knowledge-extraction.js';

// Domain Modules
export * from './graph.js';
export * from './assets.js';
export * from './events.js';
export * from './sessions.js';
export * from './common.js';
export * from './query-builder.js';
export * from './temporal.js';
export * from './predictions.js';
