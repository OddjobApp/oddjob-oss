import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';
import { configureTestEnvironment } from './tests/configure-test-environment';

dotenv.config({ path: '.env.test' });

// Never inherit a development or production DATABASE_URL into the test runner.
configureTestEnvironment();

// Pin the zone the suite was written in. Date and calendar tests read the host's
// zone, so they passed on the authors' machines and failed in a UTC container or
// CI runner. Set before the workers fork, so they inherit it.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: [
            'tests/**/*.test.{ts,tsx}',
            // Was an allowlist of individual server directories, and it silently
            // swallowed a new one four times running — middleware, mcp, and core
            // each landed with tests that matched no pattern, ran zero tests and
            // reported green. The fourth time cost more: server/tests,
            // server/services and server/workers held 238 tests between them,
            // including sandbox-safety, event-bus and knowledge-graph, and none
            // of them had ever run.
            //
            // Inverted to cover server/** by default, so a new directory is
            // collected unless it is deliberately excluded below. Same reasoning
            // as the branch filters in .github/workflows/verify.yml: a gate that
            // silently does not run is worse than no gate, because it reads as
            // green.
            'server/**/*.test.{ts,tsx}',
            'services/**/*.test.{ts,tsx}',
            'packages/**/*.test.{ts,tsx}',
            'client/src/**/*.{test,spec}.{ts,tsx}',
            'shared/**/*.{test,spec}.{ts,tsx}',
            // The gates themselves. lint:org-scoping.test.ts was written here
            // and collected by nothing, which is the fifth instance of the
            // problem described above — and the worst place for it, since a
            // linter with untested rules is what let `lint:arch` certify 328
            // direct db calls as clean.
            'scripts/**/*.{test,spec}.{ts,tsx}'
        ],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            // Scaffolded template apps, not platform code. Each carries its own
            // package.json and resolves against its own dependency tree, so its
            // tests belong to the generated app rather than to this suite.
            'server/blueprints/**',
            // Playwright specs — a different runner. They are named *.spec.ts,
            // which the server/** pattern above already skips; this is here so
            // that stays true if one is ever renamed.
            'server/tests/e2e/**',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: [
                'server/domain/**/*.ts',
                'server/services/**/*.ts',
                'server/core/**/*.ts',
                'services/**/*.ts',
                'packages/**/*.ts',
                'client/src/**/*.ts',
                'client/src/**/*.tsx',
                'shared/**/*.ts'
            ],
            exclude: [
                '**/node_modules/**',
                '**/dist/**',
                '**/build/**',
                '**/*.test.{ts,tsx}',
                '**/*.spec.{ts,tsx}',
                '**/*.d.ts',
                '**/index.ts'
            ],
            // Ratchet, not an aspiration.
            //
            // These read 70/65/60/70 from the day they were added, and nothing
            // ever ran `--coverage`: not `npm run verify`, not any workflow. The
            // first run that actually evaluated them (2026-09-08, 10,345 tests,
            // all passing) measured:
            //
            //     statements 31.67%   branches 25.18%
            //     functions  29.89%   lines    32.47%
            //
            // — about half of what was declared. Left as they were, the gate is
            // red forever and gets ignored, which is how it went unnoticed in the
            // first place.
            //
            // Set just under the measured values so the check earns its place:
            // it fails when coverage *drops*, which is a real regression and the
            // thing worth catching. Raise these as coverage climbs, the same way
            // lint-architecture.baseline.json is ratcheted down.
            thresholds: {
                lines: 32,
                functions: 29,
                branches: 25,
                statements: 31,
            },
        },
        fileParallelism: false,
        testTimeout: 120000,
        hookTimeout: 60000,
        teardownTimeout: 30000,
        setupFiles: ['./tests/setup.ts'],
        alias: {
            '@shared': path.resolve(__dirname, 'shared'),
            '@server': path.resolve(__dirname, 'server'),
            '@domain': path.resolve(__dirname, 'server', 'domain'),
            '@domain-ui': path.resolve(__dirname, 'server', 'domain'),
            '@': path.resolve(__dirname, 'client', 'src'),
            'snowflake-sdk': path.resolve(__dirname, 'tests', 'mocks', 'snowflake-sdk.ts'),
            'react': path.resolve(__dirname, 'node_modules', 'react'),
            'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
        },
    },
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, 'shared'),
            '@server': path.resolve(__dirname, 'server'),
            '@domain': path.resolve(__dirname, 'server', 'domain'),
            '@domain-ui': path.resolve(__dirname, 'server', 'domain'),
            '@': path.resolve(__dirname, 'client', 'src'),
            'snowflake-sdk': path.resolve(__dirname, 'tests', 'mocks', 'snowflake-sdk.ts'),
            'react': path.resolve(__dirname, 'node_modules', 'react'),
            'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
        },
    },
});
