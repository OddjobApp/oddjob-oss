/**
 * Phase 4 Integration Test Setup
 *
 * Initializes test database, Redis, and logging
 * Runs before all tests
 */

import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('TestSetup');

// Increase test timeout for database operations
jest.setTimeout(30000);

/**
 * Setup: Initialize test environment
 */
beforeAll(async () => {
    logger.info('Setting up test environment for Phase 4 integration tests');

    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
    process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    // Verify database connection
    try {
        const { db } = await import('@server/database_service.js');
        const result = await db.execute(`SELECT 1 as status`);
        if (result) {
            logger.info('✅ Database connection successful');
        }
    } catch (error: any) {
        logger.error('❌ Database connection failed:', error.message);
        throw new Error(`Test database unavailable: ${error.message}`);
    }

    // Verify Redis connection
    try {
        const { redis } = await import('@domain/core/infrastructure/redis/redis-client.js');
        const pong = await redis.ping();
        if (pong === 'PONG') {
            logger.info('✅ Redis connection successful');
        }
    } catch (error: any) {
        logger.error('❌ Redis connection failed:', error.message);
        throw new Error(`Test Redis unavailable: ${error.message}`);
    }

    logger.info('Test environment setup complete');
});

/**
 * Teardown: Clean up after tests
 */
afterAll(async () => {
    logger.info('Cleaning up test environment');

    try {
        // Close database connections
        const { db } = await import('@server/database_service.js');
        // Database connections typically close automatically or via process termination
        logger.info('Database connections closed');
    } catch (error: any) {
        logger.warn('Error closing database:', error.message);
    }

    try {
        // Close Redis connections
        const { redis } = await import('@domain/core/infrastructure/redis/redis-client.js');
        await redis.disconnect();
        logger.info('Redis connections closed');
    } catch (error: any) {
        logger.warn('Error closing Redis:', error.message);
    }

    logger.info('Test cleanup complete');
});

/**
 * Global error handler for unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

/**
 * Global error handler for uncaught exceptions
 */
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

export {};
