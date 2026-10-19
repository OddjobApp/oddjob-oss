/**
 * Shared Database Package
 * 
 * Provides centralized database connectivity and schema definitions
 * for all microservices in the Oddjob ecosystem.
 * 
 * Usage:
 *   import { db, schema } from '@oddjob/shared-db';
 *   import { users, jobs, pipelines } from '@oddjob/shared-db/schema';
 */

export * from './client.js';
export * as schema from './schema.js';

