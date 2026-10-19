/**
 * EvolutionEngine tests
 *
 * First test coverage for the GMS self-improvement core (server/core/gms was
 * previously 0% tested). Focuses on the pure genetic-algorithm operators and the
 * public evolution API, plus a regression for the genomeSimilarity 0/0=NaN bug.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import { EvolutionEngine } from '@server/core/gms/skills/evolution-engine.js';
import type { Skill, MissionBlueprint } from '@server/core/gms/common/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeBlueprint(overrides: Partial<MissionBlueprint> = {}): MissionBlueprint {
    return {
        name: 'bp',
        description: 'test blueprint',
        version: '1.0',
        steps: [
            { id: 's1', type: 'agent', name: 'step1', description: '', config: {} },
            { id: 's2', type: 'tool', name: 'step2', description: '', config: {}, dependsOn: ['s1'] },
        ],
        agents: [
            { id: 'a1', name: 'agent1', model: 'gemini-1.5-flash', temperature: 0.7, maxTokens: 1000, allowedTools: ['t1'], reasoningProtocol: 'hermes_xml', deliberationDepth: 2 },
        ],
        tools: [
            { name: 't1', version: '1.0', required: true, timeout: 5000, retryCount: 2 },
        ],
        inputSchema: {},
        outputSchema: {},
        maxDuration: 60,
        retryPolicy: { maxAttempts: 3, backoffStrategy: 'exponential', backoffMs: 1000 },
        reasoningConfig: { protocol: 'hermes_xml', depth: 2, selfReflect: true, verifyActions: true },
        ...overrides,
    };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        id: 'skill-1',
        name: 'test skill',
        description: 'a test skill',
        blueprint: makeBlueprint(),
        verifierScore: { successProbability: 0.9, confidence: 0.8, latencyEstimate: 100, costEstimate: 0.01, riskFactors: [] },
        shadowResult: {
            candidateId: 'skill-1', completedAt: new Date(), successRate: 0.9, avgLatency: 100,
            minLatency: 50, maxLatency: 150, totalCost: 0.1, runs: [], hermesTraces: [], failureModes: [], predictionDelta: 0,
        },
        productionStats: {
            totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgLatency: 0, avgCost: 0, successRateTrend: 'stable',
        },
        generation: 0,
        parentIds: [],
        childrenIds: [],
        mutations: [],
        evolutionLineage: [],
        tags: [],
        createdAt: new Date(),
        lastUsedAt: new Date(),
        usageCount: 0,
        ...overrides,
    };
}

/** ShadowOrchestrator stub — only quickValidate is exercised by EvolutionEngine. */
function makeOrchestrator(recommendation: 'proceed' | 'reject' = 'proceed', shadowSuccessRate = 0.95) {
    return {
        quickValidate: vi.fn(async () => ({
            recommendation,
            shadowResult: { successRate: shadowSuccessRate },
        })),
    } as any;
}

describe('EvolutionEngine', () => {
    describe('public API', () => {
        it('getEvolutionStatus returns null for an unknown evolution id', () => {
            const engine = new EvolutionEngine(makeOrchestrator());
            expect(engine.getEvolutionStatus('nope')).toBeNull();
        });

        it('abortEvolution returns false for an unknown evolution id', () => {
            const engine = new EvolutionEngine(makeOrchestrator());
            expect(engine.abortEvolution('nope')).toBe(false);
        });

        it('evolveSkill promotes a validated variant when shadow validation proceeds', async () => {
            // convergenceThreshold < 0 guarantees a "best" variant is recorded each gen.
            const engine = new EvolutionEngine(makeOrchestrator('proceed', 0.98), {
                populationSize: 6,
                maxGenerations: 1,
                convergenceThreshold: -1,
            });

            const result = await engine.evolveSkill(makeSkill());

            expect(result.success).toBe(true);
            expect(result.bestVariant).not.toBeNull();
            expect(result.bestVariant?.generation.generationMethod).toBe('evolution');
            // shadow (0.98) minus parent shadow (0.90)
            expect(result.improvement).toBeCloseTo(0.08, 5);
        });

        it('evolveSkill reports failure when shadow validation rejects', async () => {
            const engine = new EvolutionEngine(makeOrchestrator('reject'), {
                populationSize: 6,
                maxGenerations: 1,
                convergenceThreshold: -1,
            });

            const result = await engine.evolveSkill(makeSkill());

            expect(result.success).toBe(false);
            expect(result.bestVariant).toBeNull();
            expect(result.improvement).toBe(0);
        });

        it('evolveSkill cleans up its active-evolution state (no leak after completion)', async () => {
            const engine = new EvolutionEngine(makeOrchestrator(), { maxGenerations: 1, convergenceThreshold: -1 });
            await engine.evolveSkill(makeSkill());
            // No id is exposed post-run, but the internal map must be empty.
            expect((engine as any).activeEvolutions.size).toBe(0);
        });

        it('evolveBatch returns one result per skill and swallows per-skill errors', async () => {
            // Orchestrator whose quickValidate throws -> evolveSkill throws -> batch catches.
            const throwing = { quickValidate: vi.fn(async () => { throw new Error('boom'); }) } as any;
            const engine = new EvolutionEngine(throwing, { maxGenerations: 1, convergenceThreshold: -1 });

            const results = await engine.evolveBatch([makeSkill({ id: 'a' }), makeSkill({ id: 'b' })]);

            expect(results.map(r => r.skillId)).toEqual(['a', 'b']);
            expect(results.every(r => r.result.success === false)).toBe(true);
        });
    });

    describe('genetic operators', () => {
        const engine = new EvolutionEngine(makeOrchestrator());

        it('extractGenome maps blueprint fields into genes', () => {
            const genome = (engine as any).extractGenome(makeSkill());
            expect(genome.stepTopology).toEqual(['s1', 's2']);
            expect(genome.stepTypes).toEqual(['agent', 'tool']);
            expect(genome.agentModels).toEqual(['gemini-1.5-flash']);
            expect(genome.agentTemperatures).toEqual([0.7]);
            expect(genome.reasoningDepths).toEqual([2]);
            expect(genome.toolInventory).toEqual(['t1']);
            expect(genome.toolTimeouts).toEqual([5000]);
            expect(genome.retryPolicy).toEqual({ maxAttempts: 3, backoff: 'exponential' });
        });

        it('extractGenome tolerates a blueprint with no steps/agents/tools', () => {
            const empty = makeSkill({ blueprint: makeBlueprint({ steps: [], agents: [], tools: [] }) });
            const genome = (engine as any).extractGenome(empty);
            expect(genome.stepTopology).toEqual([]);
            expect(genome.agentModels).toEqual([]);
            expect(genome.toolInventory).toEqual([]);
        });

        it('mutateGenome (rate=1) keeps temperatures within [0,1] and depths >= 1', () => {
            const genome = (engine as any).extractGenome(
                makeSkill({ blueprint: makeBlueprint({
                    agents: [
                        { id: 'a', name: 'a', model: 'm', temperature: 0.95, maxTokens: 1, allowedTools: [], reasoningProtocol: 'hermes_xml', deliberationDepth: 1 },
                        { id: 'b', name: 'b', model: 'm', temperature: 0.02, maxTokens: 1, allowedTools: [], reasoningProtocol: 'hermes_xml', deliberationDepth: 1 },
                    ],
                }) })
            );

            // Run many times: mutation is stochastic; invariants must always hold.
            for (let i = 0; i < 50; i++) {
                const { genome: mutated, mutations } = (engine as any).mutateGenome(genome, 1);
                for (const t of mutated.agentTemperatures) {
                    expect(t).toBeGreaterThanOrEqual(0);
                    expect(t).toBeLessThanOrEqual(1);
                }
                for (const d of mutated.reasoningDepths) {
                    expect(d).toBeGreaterThanOrEqual(1);
                }
                expect(Array.isArray(mutations)).toBe(true);
            }
        });

        it('crossover unions the tool inventories of both parents', () => {
            const g1 = (engine as any).extractGenome(makeSkill());
            const g2 = {
                ...g1,
                toolInventory: ['t2', 't3'],
            };
            const p1 = { id: 'p1', genome: g1 };
            const p2 = { id: 'p2', genome: g2 };

            const { genome, mutations } = (engine as any).crossover(p1, p2);
            expect(new Set(genome.toolInventory)).toEqual(new Set(['t1', 't2', 't3']));
            expect(mutations[0].type).toBe('structure');
        });

        it('averageArrays averages element-wise and pads the shorter array with 0', () => {
            expect((engine as any).averageArrays([1, 3], [3, 5])).toEqual([2, 4]);
            expect((engine as any).averageArrays([1], [3, 5])).toEqual([2, 2.5]);
            expect((engine as any).averageArrays([], [])).toEqual([]);
        });

        it('genomeSimilarity returns 1 for identical genomes and 0 for disjoint ones', () => {
            const g = (engine as any).extractGenome(makeSkill());
            expect((engine as any).genomeSimilarity(g, g)).toBe(1);

            const disjoint = { ...g, stepTopology: ['x'], agentModels: ['y'], toolInventory: ['z'] };
            expect((engine as any).genomeSimilarity(g, disjoint)).toBe(0);
        });

        it('regression: genomeSimilarity of two empty genomes is 1, not NaN', () => {
            const emptyGenome = {
                stepTopology: [], stepTypes: [], agentModels: [], agentTemperatures: [],
                reasoningDepths: [], toolInventory: [], toolTimeouts: [],
                systemPromptHash: '0', retryPolicy: { maxAttempts: 3, backoff: 'exponential' },
            };
            const sim = (engine as any).genomeSimilarity(emptyGenome, emptyGenome);
            expect(Number.isNaN(sim)).toBe(false);
            expect(sim).toBe(1);
        });

        it('regression: predictFitness stays finite for empty-genome parent + candidate', () => {
            const emptyParent = makeSkill({ blueprint: makeBlueprint({ steps: [], agents: [], tools: [] }) });
            const emptyCandidate = { genome: (engine as any).extractGenome(emptyParent), mutations: [] };
            const fitness = (engine as any).predictFitness(emptyCandidate, emptyParent);
            expect(Number.isFinite(fitness)).toBe(true);
        });

        it('calculateFitness uses the production success ratio when runs exist', () => {
            // successRate = 9/10 = 0.9; efficiency = 1/(1+0+0) = 1
            // weights: 0.5*0.9 + 0.3*1 = 0.75
            const fitness = (engine as any).calculateFitness(makeSkill());
            expect(fitness).toBeCloseTo(0.75, 5);
        });

        it('calculateFitness falls back to shadow success rate when there are no production runs', () => {
            const skill = makeSkill({
                productionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0, avgLatency: 0, avgCost: 0, successRateTrend: 'stable' },
            });
            // successRate falls back to shadowResult.successRate (0.9); efficiency = 1
            const fitness = (engine as any).calculateFitness(skill);
            expect(fitness).toBeCloseTo(0.75, 5);
        });

        it('genomeToBlueprint reconstructs agents/tools from genome genes', () => {
            const template = makeBlueprint();
            const genome = {
                ...(engine as any).extractGenome(makeSkill()),
                agentModels: ['m1', 'm2'],
                agentTemperatures: [0.1, 0.9],
                reasoningDepths: [1, 4],
                toolInventory: ['tA', 'tB', 'tC'],
                toolTimeouts: [1000, 2000, 3000],
            };
            const bp = (engine as any).genomeToBlueprint(genome, template);
            expect(bp.agents).toHaveLength(2);
            expect(bp.agents[1].model).toBe('m2');
            expect(bp.agents[1].temperature).toBe(0.9);
            expect(bp.tools).toHaveLength(3);
            expect(bp.tools.map((t: any) => t.name)).toEqual(['tA', 'tB', 'tC']);
        });

        it('hashString is deterministic and order-sensitive', () => {
            const h = (engine as any).hashString.bind(engine);
            expect(h('hello')).toBe(h('hello'));
            expect(h('ab')).not.toBe(h('ba'));
        });

        it('sample returns at most n elements drawn from the array', () => {
            const arr = [1, 2, 3, 4, 5];
            const picked = (engine as any).sample(arr, 3);
            expect(picked).toHaveLength(3);
            for (const p of picked) expect(arr).toContain(p);
        });
    });
});
