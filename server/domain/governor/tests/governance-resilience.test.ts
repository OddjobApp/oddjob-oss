import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SynthesisNode } from '../core/synthesizer.js';
import { GovernancePolicyService } from '../core/governance-policy.service.js';
import Redis from 'ioredis';

// --- ROBUST MOCKS ---

vi.mock('ioredis', () => {
    class MockRedis {
        set = vi.fn().mockResolvedValue('OK');
        get = vi.fn();
        hset = vi.fn().mockResolvedValue(1);
        xread = vi.fn();
        keys = vi.fn().mockResolvedValue([]);
        on = vi.fn((event, cb) => {});
        quit = vi.fn().mockResolvedValue('OK');
    }
    return {
        default: MockRedis,
        Redis: MockRedis,
    };
});

vi.mock('../core/molt-producer.js', () => ({
    MoltProducer: vi.fn().mockImplementation(() => ({
        verify: vi.fn().mockReturnValue(true),
        publish: vi.fn().mockResolvedValue('msg-123')
    }))
}));

describe('Governance Pod Resilience Eval', () => {
    let node: SynthesisNode;
    let mockRedis: any;
    let mockProducer: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockProducer = { 
            verify: vi.fn().mockReturnValue(true),
            publish: vi.fn().mockResolvedValue('msg-123')
        };
        node = new SynthesisNode('test-session', mockProducer as any);
        mockRedis = (node as any).redis;
    });

    describe('Synthesis Strategy & Consensus', () => {
        it('should reach consensus on high-confidence votes in standard tier', async () => {
            const proposal = {
                proposalId: 'p1',
                command: 'test',
                startTime: Date.now(),
                votes: {
                    'W-1': { agent: 'W-1', confidence: 0.9, reasoning: 'ok' },
                    'W-2': { agent: 'W-2', confidence: 0.9, reasoning: 'ok' },
                    'W-3': { agent: 'W-3', confidence: 0.9, reasoning: 'ok' },
                    'W-4': { agent: 'W-4', confidence: 0.9, reasoning: 'ok' }
                },
                status: 'PENDING'
            };

            await (node as any).evaluateConsensus(proposal as any);

            expect(proposal.status).toBe('APPROVED');
            expect(mockProducer.publish).toHaveBeenCalledWith('DECISION', expect.objectContaining({
                approved: true
            }), undefined);
        });

        it('should trigger immediate VETO if W-2 (Critic) confidence is low', async () => {
             const proposal = {
                proposalId: 'p2',
                command: 'unsafe command',
                startTime: Date.now(),
                votes: {
                    'W-2': { agent: 'W-2', confidence: 0.05, reasoning: 'VETO: Unsafe' }
                },
                status: 'PENDING'
            };

            await (node as any).evaluateConsensus(proposal as any);

            expect(proposal.status).toBe('REJECTED');
            expect(mockProducer.publish).toHaveBeenCalledWith('DECISION', expect.objectContaining({
                approved: false,
                reason: expect.stringContaining('Vetoed by Critic')
            }), undefined);
        });

        it('should fail consensus if weighted score is below threshold', async () => {
            // Standard Threshold: 0.75
            // W-1 (0.3)*0.5 + W-2 (0.4)*0.6 + W-3 (0.1)*1.0 + W-4 (0.2)*0.8 = 0.15 + 0.24 + 0.1 + 0.16 = 0.65
            const proposal = {
                proposalId: 'p3',
                command: 'marginal',
                startTime: Date.now(),
                votes: {
                    'W-1': { agent: 'W-1', confidence: 0.5 },
                    'W-2': { agent: 'W-2', confidence: 0.6 },
                    'W-3': { agent: 'W-3', confidence: 1.0 },
                    'W-4': { agent: 'W-4', confidence: 0.8 }
                },
                status: 'PENDING'
            };

            await (node as any).evaluateConsensus(proposal as any);

            expect(proposal.status).toBe('REJECTED');
            expect(mockProducer.publish).toHaveBeenCalledWith('DECISION', expect.objectContaining({
                approved: false,
                reason: expect.stringContaining('Consensus Failed')
            }), undefined);
        });
    });

    describe('Policy Resolver', () => {
        it('should return strict policy with higher targets', () => {
            const policy = GovernancePolicyService.getPolicy('strict');
            expect(policy.consensusThreshold).toBe(0.9);
            expect(policy.vetoThreshold).toBe(0.3);
        });

        it('should return standard policy by default', () => {
            const policy = GovernancePolicyService.getPolicy();
            expect(policy.tier).toBe('standard');
            expect(policy.consensusThreshold).toBe(0.75);
        });
    });

    describe('Durable State Persistence', () => {
        it('should save proposal state to Redis', async () => {
            const proposal = { proposalId: 'p-save', command: 'test', votes: {}, status: 'PENDING' };
            await (node as any).saveProposal(proposal);
            expect(mockRedis.set).toHaveBeenCalledWith(
                expect.stringContaining('p-save'),
                expect.any(String),
                'EX',
                expect.any(Number)
            );
        });
    });
});
