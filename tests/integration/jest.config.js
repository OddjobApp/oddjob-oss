/**
 * Jest Configuration for Phase 4 Integration Tests
 *
 * Tests run against real database and Redis connections
 * Requires test database setup before running
 */

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@domain/(.*)$': '<rootDir>/server/domain/$1',
        '^@server/(.*)$': '<rootDir>/server/$1',
        '^@shared/(.*)$': '<rootDir>/shared/$1',
    },
    setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.ts'],
    globals: {
        'ts-jest': {
            tsconfig: {
                esm: true,
                module: 'esnext',
            },
        },
    },
    testTimeout: 30000, // Async jobs may take time
    collectCoverageFrom: [
        'server/domain/**/*.ts',
        '!server/domain/**/*.test.ts',
        '!server/domain/**/tests/**',
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70,
        },
    },
};
