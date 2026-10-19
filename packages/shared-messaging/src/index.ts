/**
 * Shared Messaging Package
 * 
 * Provides messaging infrastructure for microservices:
 * - RabbitMQ client for job queues
 * - Event publishing utilities
 * - Message type definitions
 */

export * from './rabbitmq.js';
export * from './events.js';
export * from './types.js';

