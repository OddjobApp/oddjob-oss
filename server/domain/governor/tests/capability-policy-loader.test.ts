import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityPolicyLoader } from '../core/capability-policy-loader.service.js';
import { ForbiddenError } from '@server/utils/errors.js';

// ---------------------------------------------------------------------------
// Sample YAML policies
// ---------------------------------------------------------------------------

const STRICT_POLICY_YAML = `
organization: testorg
enforcement: strict
roles:
  analyst:
    tools: [web_search, data_analysis]
    filePaths: ['/data/public/**', '/reports/**']
    networkDestinations: ['api.public.com', '*.analytics.internal']
    modelCap: sonnet
    maxDailyRequests: 200
  admin:
    tools: '*'
    filePaths: ['/**']
    networkDestinations: '*'
    modelCap: opus
`;

const WARN_POLICY_YAML = `
organization: warnorg
enforcement: warn
roles:
  analyst:
    tools: [read_file]
    filePaths: ['/safe/**']
    networkDestinations: ['safe.example.com']
    modelCap: haiku
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapabilityPolicyLoader', () => {
    let loader: CapabilityPolicyLoader;

    beforeEach(() => {
        // Use a fresh instance per test
        loader = new (CapabilityPolicyLoader as any)();
    });

    describe('loadFromYaml', () => {
        it('loads a valid YAML policy', () => {
            loader.loadFromYaml(1, STRICT_POLICY_YAML);
            expect(loader.has(1)).toBe(true);
        });

        it('throws on invalid YAML (no roles)', () => {
            expect(() => loader.loadFromYaml(1, 'organization: bad')).toThrow('missing "roles"');
        });
    });

    describe('get', () => {
        it('returns null when no policy is loaded', () => {
            expect(loader.get(999)).toBeNull();
        });

        it('returns the parsed policy', () => {
            loader.loadFromYaml(1, STRICT_POLICY_YAML);
            const policy = loader.get(1);
            expect(policy?.organization).toBe('testorg');
            expect(policy?.enforcement).toBe('strict');
            expect(Object.keys(policy?.roles ?? {})).toContain('analyst');
        });
    });

    describe('check — tool', () => {
        beforeEach(() => loader.loadFromYaml(1, STRICT_POLICY_YAML));

        it('allows a permitted tool', () => {
            const result = loader.check(1, 'analyst', { type: 'tool', value: 'web_search' });
            expect(result.allowed).toBe(true);
        });

        it('throws ForbiddenError for a denied tool in strict mode', () => {
            expect(() =>
                loader.check(1, 'analyst', { type: 'tool', value: 'code_execution' })
            ).toThrow(ForbiddenError);
        });

        it('allows all tools for admin', () => {
            const result = loader.check(1, 'admin', { type: 'tool', value: 'any_tool' });
            expect(result.allowed).toBe(true);
        });
    });

    describe('check — filePath', () => {
        beforeEach(() => loader.loadFromYaml(1, STRICT_POLICY_YAML));

        it('allows a matching path (** glob)', () => {
            const result = loader.check(1, 'analyst', { type: 'filePath', value: '/data/public/dataset.csv' });
            expect(result.allowed).toBe(true);
        });

        it('throws ForbiddenError for a path outside allowed patterns', () => {
            expect(() =>
                loader.check(1, 'analyst', { type: 'filePath', value: '/etc/secrets/key.pem' })
            ).toThrow(ForbiddenError);
        });

        it('allows /** for admin', () => {
            const result = loader.check(1, 'admin', { type: 'filePath', value: '/etc/secrets/key.pem' });
            expect(result.allowed).toBe(true);
        });
    });

    describe('check — network', () => {
        beforeEach(() => loader.loadFromYaml(1, STRICT_POLICY_YAML));

        it('allows a whitelisted destination', () => {
            const result = loader.check(1, 'analyst', { type: 'network', value: 'api.public.com' });
            expect(result.allowed).toBe(true);
        });

        it('allows a wildcard-matched subdomain', () => {
            const result = loader.check(1, 'analyst', { type: 'network', value: 'team.analytics.internal' });
            expect(result.allowed).toBe(true);
        });

        it('throws ForbiddenError for a blocked destination', () => {
            expect(() =>
                loader.check(1, 'analyst', { type: 'network', value: 'evil.external.io' })
            ).toThrow(ForbiddenError);
        });

        it('allows * for admin', () => {
            const result = loader.check(1, 'admin', { type: 'network', value: 'any.destination.net' });
            expect(result.allowed).toBe(true);
        });
    });

    describe('check — model', () => {
        beforeEach(() => loader.loadFromYaml(1, STRICT_POLICY_YAML));

        it('allows a model within the cap', () => {
            // analyst cap = sonnet (tier 2), claude haiku = tier 1
            const result = loader.check(1, 'analyst', { type: 'model', value: 'claude-3-haiku' });
            expect(result.allowed).toBe(true);
        });

        it('allows a model at the exact cap', () => {
            const result = loader.check(1, 'analyst', { type: 'model', value: 'claude-3-5-sonnet' });
            expect(result.allowed).toBe(true);
        });

        it('throws ForbiddenError for model above the cap', () => {
            // analyst cap = sonnet, opus = tier 3
            expect(() =>
                loader.check(1, 'analyst', { type: 'model', value: 'claude-opus-4' })
            ).toThrow(ForbiddenError);
        });

        it('allows opus for admin', () => {
            const result = loader.check(1, 'admin', { type: 'model', value: 'claude-opus-4' });
            expect(result.allowed).toBe(true);
        });
    });

    describe('warn enforcement mode', () => {
        beforeEach(() => loader.loadFromYaml(2, WARN_POLICY_YAML));

        it('returns allowed=false (not throws) for denied tool', () => {
            const result = loader.check(2, 'analyst', { type: 'tool', value: 'code_execution' });
            expect(result.allowed).toBe(false);
        });

        it('does not throw for denied filePath', () => {
            expect(() =>
                loader.check(2, 'analyst', { type: 'filePath', value: '/etc/passwd' })
            ).not.toThrow();
        });
    });

    describe('open-by-default when no policy loaded', () => {
        it('allows anything when no policy exists for org', () => {
            const result = loader.check(9999, 'any_role', { type: 'tool', value: 'any_tool' });
            expect(result.allowed).toBe(true);
        });
    });
});
