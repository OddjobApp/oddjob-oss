
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fingerprintManagerService } from '../../../core/infrastructure/fingerprint-manager.service.js';
import { proxyPoolService } from '../../../core/infrastructure/proxy-pool.service.js';
import { adversarialAIService } from '@domain/core/infrastructure/adversarial-ai.service.js';
import { agentSessionService } from '../../core/agent-session.service.js';

const mockDb = vi.hoisted(() => ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1, sessionId: 'test-session' }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 1, progress: [] }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
}));

vi.mock('@server/database_service.js', () => ({ db: mockDb }));

describe("Adversarial Services - Unit Tests", () => {

    describe("FingerprintManagerService", () => {
        it("should generate a valid browser fingerprint", () => {
            const fingerprint = fingerprintManagerService.generateFingerprint();

            expect(fingerprint).toBeDefined();
            expect(fingerprint.userAgent).toBeTypeOf('string');
            expect(fingerprint.viewport.width).toBeTypeOf('number');
            expect(fingerprint.gpuVendor).toBeTypeOf('string');
        });
    });

    describe("ProxyPoolService", () => {
        beforeEach(() => {
            // Reset pools before each test
            proxyPoolService.addProxyPool('test-pool', ['http://proxy1', 'http://proxy2']);
        });

        it("should add and retrieve proxies from a pool", () => {
            const identity1 = proxyPoolService.getProxyIdentity('test-pool');
            const identity2 = proxyPoolService.getProxyIdentity('test-pool');
            const identity3 = proxyPoolService.getProxyIdentity('test-pool');

            expect(identity1?.connectionString).toBe('http://proxy1');
            expect(identity2?.connectionString).toBe('http://proxy2');
            expect(identity3?.connectionString).toBe('http://proxy1'); // Should cycle back
        });

        it("should generate a fingerprint if one is not provided", () => {
            const identity = proxyPoolService.getProxyIdentity('test-pool');
            expect(identity).toBeDefined();
            expect(identity?.fingerprint).toBeDefined();
            expect(identity?.fingerprint?.userAgent).toBeTypeOf('string');
        });
    });

    describe("AdversarialAIService", () => {
        it("should return an attack prompt wrapping the original prompt", () => {
            const originalPrompt = "What is the weather?";
            const attackPrompt = adversarialAIService.getAttackPrompt(originalPrompt);

            expect(attackPrompt).not.toBe(originalPrompt);
            expect(attackPrompt).toContain(originalPrompt);
        });
    });

    describe("AgentSessionService", () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it("should create a new session", async () => {
            const session = await agentSessionService.createSession("Test goal");
            expect(mockDb.insert).toHaveBeenCalledOnce();
            expect(session.sessionId).toBe('test-session');
        });

        it("should update the progress of a session", async () => {
            await agentSessionService.updateProgress('test-session', [{ action: 'test' }]);
            expect(mockDb.update).toHaveBeenCalledOnce();
            expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ progress: [{ action: 'test' }] }));
        });
    });
});
