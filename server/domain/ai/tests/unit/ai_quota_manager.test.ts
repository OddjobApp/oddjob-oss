import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiQuotaManager } from '../../core/ai-client.service.js';
import { nodeRedisClient as redis } from '../../../../domain/core/infrastructure/redis/redis-client.js';

vi.mock('../../../../domain/core/infrastructure/redis/redis-client.js', () => ({
    nodeRedisClient: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        eval: vi.fn(),
    },
}));

describe('AiQuotaManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('should set global block on reportFailure', async () => {
        vi.mocked(redis.get).mockResolvedValue('10000');
        
        await AiQuotaManager.reportFailure();
        
        // Verify gap increased
        expect(redis.set).toHaveBeenCalledWith("global:ai:current_gap_ms", "20000");
        
        // Verify block set
        expect(redis.set).toHaveBeenCalledWith(
            "global:ai:block_until",
            expect.any(String),
            'EX',
            300
        );
    });

    it('should allow priority task to bypass block check', async () => {
        // Mock eval success for slot reservation
        vi.mocked(redis.eval).mockResolvedValue('0');
        vi.mocked(redis.get).mockResolvedValue('60000');

        await AiQuotaManager.throttle(true); // isPriority = true
        
        // Priority tasks skip the block check in throttle()
        // They only check the gap and the slot
        const getCalls = vi.mocked(redis.get).mock.calls.map(c => c[0]);
        expect(getCalls).not.toContain("global:ai:block_until");
    });

    it('should make background task wait for global block', async () => {
        const blockUntil = Date.now() + 2000;
        
        vi.mocked(redis.get).mockImplementation(async (key) => {
            if (key === "global:ai:block_until") return blockUntil.toString();
            if (key === "global:ai:current_gap_ms") return '60000';
            return null;
        });
        
        vi.mocked(redis.eval).mockResolvedValue('0');

        const throttlePromise = AiQuotaManager.throttle(false); // isPriority = false
        
        // Advance time and resolve
        await vi.advanceTimersByTimeAsync(2000);
        await throttlePromise;
        
        expect(redis.get).toHaveBeenCalledWith("global:ai:block_until");
    });

    it('should double the gap on failure up to max', async () => {
        vi.mocked(redis.get).mockResolvedValue('50000');
        
        await AiQuotaManager.reportFailure();
        
        expect(redis.set).toHaveBeenCalledWith("global:ai:current_gap_ms", "60000"); // 60s (MAX_GAP_MS)
    });
});
