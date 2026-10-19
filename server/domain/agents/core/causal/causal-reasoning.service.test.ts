// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { CausalReasoningService } from './causal-reasoning.service.js';
import type { CausalGraph, CausalEdge } from './types.js';
function graph(adjust = false): CausalGraph {
  const edge = (source: string, target: string): CausalEdge => ({ source, target, strength: 1, confidence: 1, type: 'direct', bidirectional: false, discoveryMethod: 'expert' });
  return { id: 'g', name: 'g', variables: (adjust ? ['x','y','z'] : ['x','y']).map(id => ({ id, name: id, description: '', type: 'binary', observable: true, intervenable: true })),
    edges: adjust ? [edge('z','x'), edge('z','y'), edge('x','y')] : [edge('x','y')], confounders: [], backdoorPaths: [], frontdoorPaths: [], source: 'expert', createdAt: new Date(), updatedAt: new Date() };
}
function service(g = graph(), confidenceLevel = .95) { const s = new CausalReasoningService({ publish: vi.fn() }, { confidenceLevel }); s.loadGraph(g); return s; }
const data = { x: [0,0,1,1], y: [1,3,5,7] };
describe('Causal estimate integrity', () => {
  it('accepts an empty valid adjustment set', async () => {
    const result = await service().estimateATE('g','x','y',data);
    expect(result.value).toBe(4); expect(result.adjustmentSet).toEqual([]);
    expect(result.standardError).toBeCloseTo(Math.sqrt(2));
  });
  it('actually adjusts confounding instead of returning the crude difference', async () => {
    const confounded = { x: [0,0,0,0,1,1,0,0,1,1,1,1], z: [0,0,0,0,0,0,1,1,1,1,1,1], y: [0,0,0,0,2,2,10,10,12,12,12,12] };
    const result = await service(graph(true)).estimateATE('g','x','y',confounded);
    expect(result.value).toBe(2); expect(result.adjustmentSet).toEqual(['z']);
  });
  it('retains controls for ATT estimation', async () => {
    const result = await service().estimateATT('g','x','y',data,[2,3]);
    expect(result.value).toBe(4); expect(result.type).toBe('att'); expect(Number.isFinite(result.pValue)).toBe(true);
  });
  it('uses treated target proportions for ATT', async () => {
    const d = { x: [0,0,0,0,1,1,0,0,1,1,1,1], z: [0,0,0,0,0,0,1,1,1,1,1,1], y: [0,0,0,0,2,2,10,10,14,14,14,14] };
    const s = service(graph(true));
    expect((await s.estimateATE('g','x','y',d)).value).toBe(3);
    expect((await s.estimateATT('g','x','y',d,[4,5,8,9,10,11])).value).toBeCloseTo(10/3);
  });
  it('does not manufacture frontdoor results for latent confounding', async () => {
    const g = graph(true); g.confounders = [{ var1: 'x', var2: 'y', strength: 1 }];
    await expect(service(g).estimateATE('g','x','y',data)).rejects.toMatchObject({ type: 'unobserved_confounder' });
  });
  it.each([{ x:[1,1], y:[2,3] }, { x:[0,1,1,0], y:[1,2] }, { ...data, y:[1,2,NaN,4] }, { ...data, x:[0,0,2,2] }])('rejects invalid data or insufficient overlap', async invalid => {
    await expect(service().estimateATE('g','x','y',invalid)).rejects.toMatchObject({ type: 'insufficient_data' });
  });
  it('honors the requested confidence level', async () => {
    const narrow = await service(graph(),.9).estimateATE('g','x','y',data);
    const wide = await service(graph(),.99).estimateATE('g','x','y',data);
    expect(wide.confidenceInterval.upper).toBeGreaterThan(narrow.confidenceInterval.upper);
  });
  it('rejects unsupported continuous adjustment and invalid ATT indices', async () => {
    const g = graph(true); g.variables[2].type = 'continuous';
    await expect(service(g).estimateATE('g','x','y',data)).rejects.toMatchObject({ type: 'adjustment_set_invalid' });
    await expect(service().estimateATT('g','x','y',data,[0])).rejects.toMatchObject({ type: 'insufficient_data' });
  });
  it('rejects placeholder mediation rather than reporting correlations as causal effects', async () => {
    await expect(service().analyzeMediation('g','x','y',[],data)).rejects.toMatchObject({ type: 'identification_failed' });
  });
});
