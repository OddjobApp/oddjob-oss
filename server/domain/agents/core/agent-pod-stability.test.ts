import { describe, it, expect, vi, beforeEach } from 'vitest';
import { swarmCommunicationService } from './swarm-communication.service.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { redisService } from '@domain/core/infrastructure/redis/redis-client.js';

// --- ROBUST MOCKS ---

vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => {
    const mockClient = {
        on: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        publish: vi.fn().mockResolvedValue(1),
        set: vi.fn().mockResolvedValue("OK"),
        hset: vi.fn().mockResolvedValue(1),
        hget: vi.fn().mockResolvedValue(null),
        hdel: vi.fn().mockResolvedValue(1)
    };
    return {
        redis: mockClient,
        nodeRedisClient: mockClient,
        subscriber: mockClient,
        publisher: mockClient,
        redisService: {
            subscriber: mockClient,
            publisher: mockClient,
            client: mockClient
        },
        getRedisOptions: vi.fn(() => ({})),
        getRedisClient: vi.fn(() => mockClient)
    };
});

vi.mock('@domain/core/infrastructure/queue/queue-service.js', () => ({
    queueService: {
        systemQueue: 'mock-system-queue',
        addJobWithTrace: vi.fn()
    }
}));

vi.mock('@domain/mission/core/sentinel-service.js', () => ({
    SentinelService: {
        getSkillHealth: vi.fn().mockResolvedValue({ totalRuns: 10, reliabilityIndex: 95, avgLatencyMs: 100 }),
        logInsight: vi.fn().mockResolvedValue({}),
        logSuccess: vi.fn().mockResolvedValue({}),
        logFailure: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('@domain/mission/core/memory.service.js', () => ({
    memoryService: {
        getFormattedMemories: vi.fn().mockResolvedValue("mocked memory"),
        saveMemory: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('@domain/knowledge/core/rag/rag-service.js', () => ({
    ragService: {
        fetchRelevantExamples: vi.fn().mockResolvedValue({ context: 'past plan', retrospectives: [] })
    }
}));

vi.mock('./critic-service.js', () => ({
    criticService: {
        getRelevantCritiques: vi.fn().mockResolvedValue([]),
        assessInteraction: vi.fn().mockResolvedValue({ score: 10, issues: [], criticism: "Perfect" })
    }
}));

// Mock AI Client
const mockClient = {
    execute: vi.fn()
};

describe('Agents Pod Stability Eval', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton private state safely for tests
        (swarmCommunicationService as any).isListenerInitialized = false;
        (swarmCommunicationService as any).handlers = new Map();
    });

    describe('SwarmCommunicationService', () => {
        it('should initialize the global listener only once', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            await swarmCommunicationService.subscribe('swarm-a', handler1);
            await swarmCommunicationService.subscribe('swarm-b', handler2);

            expect(redisService.subscriber.on).toHaveBeenCalledTimes(1);
            expect(redisService.subscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should dispatch messages to multiple handlers in the same swarm', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const swarmId = 'test-swarm';

            await swarmCommunicationService.subscribe(swarmId, handler1);
            await swarmCommunicationService.subscribe(swarmId, handler2);

            const redisMsg = JSON.stringify({
                id: '1',
                senderId: 'agent-1',
                targetSwarmId: swarmId,
                type: 'broadcast',
                payload: { text: 'hello' }
            });

            const listener = (redisService.subscriber.on as any).mock.calls[0][1];
            listener(`swarm:${swarmId}:broadcast`, redisMsg);

            expect(handler1).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'agent-1' }));
            expect(handler2).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'agent-1' }));
        });

        it('should handle unsubscription and cleanup', async () => {
            const handler = vi.fn();
            const swarmId = 'test-swarm';

            await swarmCommunicationService.subscribe(swarmId, handler);
            await swarmCommunicationService.unsubscribe(swarmId, handler);

            const redisMsg = JSON.stringify({ id: '2', senderId: 'agent-1', targetSwarmId: swarmId });
            const listener = (redisService.subscriber.on as any).mock.calls[0][1];
            listener(`swarm:${swarmId}:broadcast`, redisMsg);

            expect(handler).not.toHaveBeenCalled();
            expect(redisService.subscriber.unsubscribe).toHaveBeenCalledWith(`swarm:${swarmId}:broadcast`);
        });
    });

    describe('AgentOrchestrator Modularization', () => {
        it('should execute the run loop correctly with all phases mocked', async () => {
            const orchestrator = new AgentOrchestrator(mockClient as any, 'api-key', {
                organizationId: 1,
                userId: 'user-1',
                sessionId: 'test-session'
            });

            // Mock responses: 1. Lifecycle Plan, 2. First Cognition, 3. Final Answer
            mockClient.execute
                .mockResolvedValueOnce({
                    success: true,
                    output: JSON.stringify({ 
                        strategy: "test strategy", 
                        steps: [{ id: "s1", tool: "web_search", risk: "low" }],
                        createdAt: new Date().toISOString()
                    }),
                    metadata: { tokensUsed: 0 }
                })
                .mockResolvedValueOnce({
                    success: true,
                    output: JSON.stringify({ tool: 'web_search', params: { query: 'test' } }),
                    metadata: { tokensUsed: 100 }
                })
                .mockResolvedValueOnce({
                    success: true,
                    output: JSON.stringify({ final_answer: 'Done' }),
                    metadata: { tokensUsed: 50 }
                });

            const result = await orchestrator.run('test goal', { model: 'mock' } as any, [], 5);
            
            expect(result.output).toBe('Done');
            expect(mockClient.execute).toHaveBeenCalledTimes(3);
        });
    });
});
