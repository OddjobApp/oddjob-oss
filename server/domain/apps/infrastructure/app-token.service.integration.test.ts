import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@server/database_service.js';
import { apps, appDeployments, orgs } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';
import {
    generateToken,
    hashToken,
    encryptToken,
    decryptToken,
    mintDeploymentToken,
    getPlaintextToken,
    validateDeploymentToken,
    requireAppToken,
    ALL_CAPABILITIES,
    type AppTokenCapability,
} from './app-token.service.js';
import { appRegistryService } from '../app-registry.service.js';

// ── Pure unit tests (no DB) ───────────────────────────────────────────────────

describe('generateToken', () => {
    it('has the correct prefix', () => {
        const token = generateToken();
        expect(token.startsWith('oddjob_app_')).toBe(true);
    });

    it('produces unique tokens', () => {
        const tokens = new Set(Array.from({ length: 20 }, generateToken));
        expect(tokens.size).toBe(20);
    });

    it('has expected length (prefix + 64 hex chars)', () => {
        const token = generateToken();
        expect(token).toHaveLength('oddjob_app_'.length + 64);
    });
});

describe('hashToken', () => {
    it('is deterministic', () => {
        const token = 'oddjob_app_abc123';
        expect(hashToken(token)).toBe(hashToken(token));
    });

    it('produces a 64-char hex string (SHA-256)', () => {
        const hash = hashToken('oddjob_app_test');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different inputs produce different hashes', () => {
        expect(hashToken('a')).not.toBe(hashToken('b'));
    });
});

describe('encryptToken / decryptToken', () => {
    const TEST_KEY = '0'.repeat(64); // 32 bytes as hex

    beforeAll(() => {
        process.env.APP_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    });

    afterAll(() => {
        delete process.env.APP_TOKEN_ENCRYPTION_KEY;
    });

    it('round-trips correctly', () => {
        const plaintext = generateToken();
        const stored = encryptToken(plaintext);
        expect(decryptToken(stored)).toBe(plaintext);
    });

    it('produces iv.tag.ciphertext format', () => {
        const stored = encryptToken('test');
        const parts = stored.split('.');
        expect(parts).toHaveLength(3);
        parts.forEach(p => expect(p).toMatch(/^[0-9a-f]+$/));
    });

    it('different encryptions of same plaintext produce different ciphertext (random IV)', () => {
        const p = 'oddjob_app_same';
        expect(encryptToken(p)).not.toBe(encryptToken(p));
    });

    it('throws on tampered ciphertext (auth tag mismatch)', () => {
        const stored = encryptToken('oddjob_app_tamper');
        const parts = stored.split('.');
        parts[2] = 'deadbeef' + parts[2].slice(8); // corrupt ciphertext
        expect(() => decryptToken(parts.join('.'))).toThrow();
    });

    it('throws on invalid format (not 3 parts)', () => {
        expect(() => decryptToken('only.two')).toThrow('Invalid encrypted token format');
    });

    it('throws when key env var is missing', () => {
        const saved = process.env.APP_TOKEN_ENCRYPTION_KEY;
        delete process.env.APP_TOKEN_ENCRYPTION_KEY;
        expect(() => encryptToken('x')).toThrow('APP_TOKEN_ENCRYPTION_KEY');
        process.env.APP_TOKEN_ENCRYPTION_KEY = saved;
    });
});

// ── Integration tests (real DB) ───────────────────────────────────────────────

describe('mintDeploymentToken / getPlaintextToken / validateDeploymentToken', () => {
    const TEST_KEY = 'a'.repeat(64);
    let orgId: number;
    let appId: number;
    let deploymentId: number;

    beforeAll(async () => {
        process.env.APP_TOKEN_ENCRYPTION_KEY = TEST_KEY;

        const [org] = await db.insert(orgs).values({ name: 'TokenTest Org' }).returning();
        orgId = org.id;

        const app = await appRegistryService.registerApp({
            name: 'Token Test App',
            slug: 'token-test-app-' + Date.now(),
            description: 'App for token tests',
            isPublic: false,
            isSystem: false,
            version: '1.0.0',
        });
        appId = app.id;

        const [dep] = await db.insert(appDeployments).values({
            appId,
            organizationId: orgId,
            status: 'installed',
            config: {},
        }).returning();
        deploymentId = dep.id;
    });

    afterAll(async () => {
        await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
        await db.delete(apps).where(eq(apps.id, appId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
        delete process.env.APP_TOKEN_ENCRYPTION_KEY;
    });

    it('mintDeploymentToken returns a valid prefixed token', async () => {
        const token = await mintDeploymentToken(deploymentId, ALL_CAPABILITIES);
        expect(token.startsWith('oddjob_app_')).toBe(true);
    });

    it('validateDeploymentToken resolves to correct context', async () => {
        const token = await mintDeploymentToken(deploymentId, ['datasets', 'missions']);
        const ctx = await validateDeploymentToken(token);

        expect(ctx).not.toBeNull();
        expect(ctx!.deploymentId).toBe(deploymentId);
        expect(ctx!.appId).toBe(appId);
        expect(ctx!.orgId).toBe(orgId);
        expect(ctx!.capabilities).toContain('datasets');
        expect(ctx!.capabilities).toContain('missions');
    });

    it('validateDeploymentToken returns null for an unknown token', async () => {
        const ctx = await validateDeploymentToken('oddjob_app_' + '0'.repeat(64));
        expect(ctx).toBeNull();
    });

    it('validateDeploymentToken returns null for a non-prefixed string', async () => {
        const ctx = await validateDeploymentToken('Bearer something');
        expect(ctx).toBeNull();
    });

    it('getPlaintextToken recovers the original token', async () => {
        const minted = await mintDeploymentToken(deploymentId, ALL_CAPABILITIES);
        const recovered = await getPlaintextToken(deploymentId);
        expect(recovered).toBe(minted);
    });

    it('getPlaintextToken returns null for a deployment with no token', async () => {
        const anotherApp = await appRegistryService.registerApp({
            name: 'Token Test App 2',
            slug: 'token-test-app-2-' + Date.now(),
            description: 'App for token tests',
            isPublic: false,
            isSystem: false,
            version: '1.0.0',
        });
        const [bare] = await db.insert(appDeployments).values({
            appId: anotherApp.id,
            organizationId: orgId,
            status: 'installed',
            config: {},
        }).returning();

        const result = await getPlaintextToken(bare.id);
        expect(result).toBeNull();

        await db.delete(appDeployments).where(eq(appDeployments.id, bare.id));
        await db.delete(apps).where(eq(apps.id, anotherApp.id));
    });
});

// ── requireAppToken middleware ────────────────────────────────────────────────

describe('requireAppToken middleware', () => {
    const TEST_KEY = 'b'.repeat(64);
    let orgId: number;
    let appId: number;
    let deploymentId: number;
    let validToken: string;

    beforeAll(async () => {
        process.env.APP_TOKEN_ENCRYPTION_KEY = TEST_KEY;

        const [org] = await db.insert(orgs).values({ name: 'Middleware Test Org' }).returning();
        orgId = org.id;

        const app = await appRegistryService.registerApp({
            name: 'Middleware Test App',
            slug: 'mw-test-app-' + Date.now(),
            description: 'App for middleware tests',
            isPublic: false,
            isSystem: false,
            version: '1.0.0',
        });
        appId = app.id;

        const [dep] = await db.insert(appDeployments).values({
            appId,
            organizationId: orgId,
            status: 'installed',
            config: {},
        }).returning();
        deploymentId = dep.id;

        validToken = await mintDeploymentToken(deploymentId, ['datasets', 'knowledge']);
    });

    afterAll(async () => {
        await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
        await db.delete(apps).where(eq(apps.id, appId));
        await db.delete(orgs).where(eq(orgs.id, orgId));
        delete process.env.APP_TOKEN_ENCRYPTION_KEY;
    });

    function mockRes() {
        const res: any = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    }

    it('accepts a valid token and attaches context', async () => {
        const req: any = { headers: { authorization: `Bearer ${validToken}` } };
        const res = mockRes();
        const next = vi.fn();

        await requireAppToken('datasets')(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.appTokenContext.deploymentId).toBe(deploymentId);
        expect(req.appTokenContext.orgId).toBe(orgId);
    });

    it('rejects missing Authorization header with 401', async () => {
        const req: any = { headers: {} };
        const res = mockRes();
        await requireAppToken()(req, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects non-Bearer auth with 401', async () => {
        const req: any = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
        const res = mockRes();
        await requireAppToken()(req, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects a made-up token with 401', async () => {
        const req: any = { headers: { authorization: 'Bearer oddjob_app_' + 'f'.repeat(64) } };
        const res = mockRes();
        await requireAppToken()(req, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects insufficient capability with 403', async () => {
        const req: any = { headers: { authorization: `Bearer ${validToken}` } };
        const res = mockRes();
        // token only has datasets + knowledge, not missions
        await requireAppToken('missions' as AppTokenCapability)(req, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('passes when no capability is specified (token-only auth)', async () => {
        const req: any = { headers: { authorization: `Bearer ${validToken}` } };
        const res = mockRes();
        const next = vi.fn();
        await requireAppToken()(req, res, next);
        expect(next).toHaveBeenCalledOnce();
    });
});
