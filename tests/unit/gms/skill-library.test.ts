/**
 * SkillLibrary tests
 *
 * Coverage for the GMS skill registry — registration, health/degradation
 * detection, evolution-candidate selection, lineage, search, and persistence.
 * Includes regressions for three bugs: avgCost divide-by-empty-runs,
 * getEvolutionCandidates NaN sort, and checkSkillHealth flagging 0-run skills.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { SkillLibrary } from '@server/core/gms/skills/skill-library.js';
import type { BlueprintCandidate, MissionBlueprint, ShadowResult, Skill } from '@server/core/gms/common/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeBlueprint(overrides: Partial<MissionBlueprint> = {}): MissionBlueprint {
    return {
        name: 'Data Fetch Skill',
        description: 'fetches and summarizes data',
        version: '1.0',
        steps: [{ id: 's1', type: 'agent', name: 'plan', description: '', config: {} }],
        agents: [{ id: 'a1', name: 'a', model: 'gemini-1.5-flash', temperature: 0.7, maxTokens: 100, allowedTools: ['t1'], reasoningProtocol: 'hermes_xml', deliberationDepth: 2 }],
        tools: [{ name: 't1', version: '1.0', required: true, timeout: 5000, retryCount: 2 }],
        inputSchema: {},
        outputSchema: {},
        maxDuration: 60,
        retryPolicy: { maxAttempts: 3, backoffStrategy: 'exponential', backoffMs: 1000 },
        reasoningConfig: { protocol: 'hermes_xml', depth: 2, selfReflect: true, verifyActions: true },
        ...overrides,
    };
}

function makeShadow(overrides: Partial<ShadowResult> = {}): ShadowResult {
    return {
        candidateId: 'c1',
        completedAt: new Date(),
        successRate: 0.9,
        avgLatency: 100,
        minLatency: 50,
        maxLatency: 150,
        totalCost: 0.1,
        runs: [{}, {}] as any,
        hermesTraces: [],
        failureModes: [],
        predictionDelta: 0,
        ...overrides,
    };
}

function makeCandidate(overrides: Partial<BlueprintCandidate> = {}): BlueprintCandidate {
    return {
        id: 'c1',
        request: 'do x',
        blueprint: makeBlueprint(),
        generation: {
            timestamp: new Date(), model: 'm', temperature: 0.5, promptTokens: 0, completionTokens: 0,
            generationMethod: 'llm_proposal', generation: 1, parentIds: [], mutations: [],
        },
        verifierScore: { successProbability: 0.9, confidence: 0.8, latencyEstimate: 100, costEstimate: 0.01, riskFactors: [] },
        status: 'validated',
        createdAt: new Date(),
        ...overrides,
    };
}

/** Force a skill's internal production stats/usage for deterministic sort/health tests. */
function setStats(lib: SkillLibrary, id: string, stats: Partial<Skill['productionStats']>, usageCount?: number): void {
    const skill = (lib as any).skills.get(id) as Skill;
    Object.assign(skill.productionStats, stats);
    if (usageCount !== undefined) skill.usageCount = usageCount;
}

describe('SkillLibrary', () => {
    describe('registerSkill', () => {
        it('registers a skill with seeded stats, embedding, and auto tags', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow(), { autoTag: true });

            expect(skill.id).toMatch(/^skill_/);
            expect(skill.productionStats.totalRuns).toBe(0);
            expect(skill.productionStats.avgLatency).toBe(100);
            expect(skill.productionStats.avgCost).toBeCloseTo(0.05, 6); // 0.10 / 2 runs
            expect(skill.tags).toContain('tool:t1');
            expect(lib.getStats().totalSkills).toBe(1);
        });

        it('regression: seeds avgCost=0 when the shadow result has no runs (no divide-by-zero)', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow({ runs: [] as any, totalCost: 0.5 }));
            expect(skill.productionStats.avgCost).toBe(0);
            expect(Number.isFinite(skill.productionStats.avgCost)).toBe(true);
        });

        it('links a child to its parent skill', () => {
            const lib = new SkillLibrary();
            const parent = lib.registerSkill(makeCandidate(), makeShadow());
            const child = lib.registerSkill(
                makeCandidate({ generation: { ...makeCandidate().generation, parentIds: [parent.id] } }),
                makeShadow(),
            );
            expect(parent.childrenIds).toContain(child.id);
        });
    });

    describe('recordProductionRun', () => {
        it('updates counts and moving averages', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow());

            lib.recordProductionRun(skill.id, { success: true, latency: 200, cost: 0.02 });
            lib.recordProductionRun(skill.id, { success: false, latency: 400, cost: 0.04 });

            expect(skill.productionStats.totalRuns).toBe(2);
            expect(skill.productionStats.successfulRuns).toBe(1);
            expect(skill.productionStats.failedRuns).toBe(1);
            expect(skill.usageCount).toBe(2);
        });

        it('is a no-op for an unknown skill id', () => {
            const lib = new SkillLibrary();
            expect(() => lib.recordProductionRun('nope', { success: true, latency: 1, cost: 1 })).not.toThrow();
        });
    });

    describe('checkSkillHealth', () => {
        it('regression: a freshly registered skill (0 runs) is healthy, not needs_evolution', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));
            expect(lib.checkSkillHealth(skill.id).status).toBe('healthy');
        });

        it('flags needs_evolution on a large success-rate drop', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));
            setStats(lib, skill.id, { totalRuns: 10, successfulRuns: 0, failedRuns: 10 }); // actual 0% vs 90%
            expect(lib.checkSkillHealth(skill.id).status).toBe('needs_evolution');
        });

        it('flags degraded on a moderate drop', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));
            setStats(lib, skill.id, { totalRuns: 10, successfulRuns: 8, failedRuns: 2 }); // 0.9 - 0.8 = 0.10 drop
            expect(lib.checkSkillHealth(skill.id).status).toBe('degraded');
        });

        it('deprecates a stale, unused skill', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow());
            (lib as any).skills.get(skill.id).lastUsedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
            expect(lib.checkSkillHealth(skill.id).status).toBe('deprecate');
        });

        it('returns deprecate for an unknown skill', () => {
            const lib = new SkillLibrary();
            expect(lib.checkSkillHealth('nope').status).toBe('deprecate');
        });
    });

    describe('getEvolutionCandidates', () => {
        it('regression: ranks degraded skills without NaN and excludes fresh 0-run skills', () => {
            const lib = new SkillLibrary();
            const a = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));
            const b = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));
            const fresh = lib.registerSkill(makeCandidate(), makeShadow({ successRate: 0.9 }));

            // Both degraded; b has a higher usage*successRate score than a.
            setStats(lib, a.id, { totalRuns: 10, successfulRuns: 0, failedRuns: 10 }, 5); // score 5*0 = 0
            setStats(lib, b.id, { totalRuns: 10, successfulRuns: 2, failedRuns: 8 }, 3); // score 3*0.2 = 0.6
            // `fresh` keeps totalRuns 0 -> not a candidate after the health fix.

            const candidates = lib.getEvolutionCandidates();

            expect(candidates.map(s => s.id).sort()).toEqual([a.id, b.id].sort());
            expect(candidates.map(s => s.id)).not.toContain(fresh.id);
            expect(candidates[0].id).toBe(b.id); // higher score first, deterministic (no NaN)
        });
    });

    describe('getLineage', () => {
        it('resolves ancestors and descendants', () => {
            const lib = new SkillLibrary();
            const parent = lib.registerSkill(makeCandidate(), makeShadow());
            const child = lib.registerSkill(
                makeCandidate({ generation: { ...makeCandidate().generation, parentIds: [parent.id] } }),
                makeShadow(),
            );

            const lineage = lib.getLineage(child.id);
            expect(lineage?.ancestors.map(s => s.id)).toEqual([parent.id]);
            expect(lib.getLineage(parent.id)?.descendants.map(s => s.id)).toContain(child.id);
        });

        it('returns null for an unknown skill', () => {
            expect(new SkillLibrary().getLineage('nope')).toBeNull();
        });
    });

    describe('getStats', () => {
        it('aggregates counts, generations, and top skills by usage', () => {
            const lib = new SkillLibrary();
            const s1 = lib.registerSkill(makeCandidate(), makeShadow());
            const s2 = lib.registerSkill(makeCandidate({ generation: { ...makeCandidate().generation, generation: 2 } }), makeShadow());
            setStats(lib, s1.id, { totalRuns: 4, successfulRuns: 4 }, 10);
            setStats(lib, s2.id, { totalRuns: 4, successfulRuns: 2 }, 1);

            const stats = lib.getStats();
            expect(stats.totalSkills).toBe(2);
            expect(stats.byGeneration[1]).toBe(1);
            expect(stats.byGeneration[2]).toBe(1);
            expect(stats.avgSuccessRate).toBeCloseTo((1 + 0.5) / 2, 6);
            expect(stats.topSkills[0].id).toBe(s1.id);
        });
    });

    describe('findSkills', () => {
        it('filters by requiredTags', async () => {
            const lib = new SkillLibrary({ similarityThreshold: 0 }); // return everything above 0 similarity
            lib.registerSkill(makeCandidate(), makeShadow(), { autoTag: true }); // tool:t1
            const other = lib.registerSkill(
                makeCandidate({ blueprint: makeBlueprint({ tools: [{ name: 't2', version: '1.0', required: true, timeout: 1, retryCount: 0 }] }) }),
                makeShadow(),
                { autoTag: true },
            );

            const results = await lib.findSkills('data', { requiredTags: ['tool:t2'] });
            expect(results).toHaveLength(1);
            expect(results[0].skill.id).toBe(other.id);
        });

        it('filters by minSuccessRate and respects the limit', async () => {
            const lib = new SkillLibrary({ similarityThreshold: 0 });
            const good = lib.registerSkill(makeCandidate(), makeShadow());
            const bad = lib.registerSkill(makeCandidate(), makeShadow());
            setStats(lib, good.id, { totalRuns: 10, successfulRuns: 9 });
            setStats(lib, bad.id, { totalRuns: 10, successfulRuns: 1 });

            const results = await lib.findSkills('data', { minSuccessRate: 0.5 });
            expect(results.map(r => r.skill.id)).toEqual([good.id]);

            lib.registerSkill(makeCandidate(), makeShadow());
            const limited = await lib.findSkills('data', { limit: 2 });
            expect(limited.length).toBeLessThanOrEqual(2);
        });
    });

    describe('export / import', () => {
        it('round-trips skills into a fresh library', () => {
            const lib = new SkillLibrary();
            const skill = lib.registerSkill(makeCandidate(), makeShadow());

            const dump = lib.export();
            expect(dump.skills).toHaveLength(1);

            const lib2 = new SkillLibrary();
            lib2.import(dump);
            expect(lib2.getStats().totalSkills).toBe(1);
            expect(lib2.getSkill(skill.id)?.id).toBe(skill.id);
        });
    });

    describe('LRU eviction', () => {
        it('evicts the least-recently-used skill when at capacity', () => {
            const lib = new SkillLibrary({ maxSkills: 2 });
            const s1 = lib.registerSkill(makeCandidate(), makeShadow());
            const s2 = lib.registerSkill(makeCandidate(), makeShadow());
            // Make s1 the least recently used.
            (lib as any).skills.get(s1.id).lastUsedAt = new Date(Date.now() - 1_000_000);

            const s3 = lib.registerSkill(makeCandidate(), makeShadow());

            const ids = lib.export().skills.map(s => s.id);
            expect(ids).toHaveLength(2);
            expect(ids).not.toContain(s1.id);
            expect(ids).toEqual(expect.arrayContaining([s2.id, s3.id]));
        });
    });

    describe('pure helpers', () => {
        const lib = new SkillLibrary({ embeddingDimensions: 16 });

        it('autoTagSkill tags tools, models, step types, and complexity', () => {
            const tags = (lib as any).autoTagSkill(makeBlueprint());
            expect(tags).toContain('tool:t1');
            expect(tags).toContain('model:gemini-1.5-flash');
            expect(tags).toContain('type:agent');
            expect(tags).toContain('complexity:simple');
        });

        it('embedText returns a normalized vector of the configured dimension', () => {
            const emb = (lib as any).embedText('hello world');
            expect(emb).toHaveLength(16);
            const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0));
            expect(norm).toBeCloseTo(1, 6);
        });

        it('cosineSimilarity: 1 for identical, 0 for orthogonal, 0 for zero-vectors', () => {
            const cos = (a: number[], b: number[]) => (lib as any).cosineSimilarity(a, b);
            expect(cos([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
            expect(cos([1, 0], [0, 1])).toBe(0);
            expect(cos([0, 0], [0, 0])).toBe(0);
        });

        it('extractKeywords drops stop words and short tokens, caps at 5', () => {
            const kw = (lib as any).extractKeywords('The quick brown fox jumps over the lazy dog again now');
            expect(kw).not.toContain('the');
            expect(kw).not.toContain('fox'); // length 3, not > 3
            expect(kw.length).toBeLessThanOrEqual(5);
        });
    });
});
