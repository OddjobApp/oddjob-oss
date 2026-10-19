import { describe, it, expect, vi, beforeEach } from 'vitest';
import { podRegistry } from '../../server/domain/core/infrastructure/pod-registry.service.js';

// Mock Redis
vi.mock('../../server/domain/core/infrastructure/redis/redis-client.js', () => ({
  redis: {
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn(),
  },
}));

// Mock Fetch for Remote Pod Proxy
global.fetch = vi.fn();

describe('Distributed Pod Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore - access private for testing
    podRegistry.localPods.clear();
  });

  it('should register a pod locally', async () => {
    const mockFacade = { test: () => 'local' };
    await podRegistry.register('test-pod', mockFacade);

    expect(podRegistry.hasPod('test-pod')).toBe(true);
    const pod = await podRegistry.getPod('test-pod');
    expect(pod).toBe(mockFacade);
  });

  it('should create a remote proxy if pod is not local but exists in Redis', async () => {
    const { redis } = await import('../../server/domain/core/infrastructure/redis/redis-client.js');
    
    // Setup Redis mock to return a remote server info
    (redis.hget as any).mockResolvedValue(JSON.stringify({
      serverId: 'other-server',
      url: 'http://remote-server:5000',
      lastSeen: Date.now()
    }));

    const pod = await podRegistry.getPod('remote-pod');
    
    // It should return a Proxy object
    expect(pod).toBeDefined();
    expect(typeof pod).toBe('object');
    
    // Test proxy execution
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: 'remote-success' })
    });

    // @ts-ignore
    const result = await pod.someRemoteMethod('arg1');
    expect(result).toBe('remote-success');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://remote-server:5000/api/internal/rpc',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('someRemoteMethod')
      })
    );
  });

  it('should throw error if pod is missing locally and globally', async () => {
    const { redis } = await import('../../server/domain/core/infrastructure/redis/redis-client.js');
    (redis.hget as any).mockResolvedValue(null);

    await expect(podRegistry.getPod('missing-pod')).rejects.toThrow('PodRegistry: Pod [missing-pod] not found locally or globally.');
  });
});
