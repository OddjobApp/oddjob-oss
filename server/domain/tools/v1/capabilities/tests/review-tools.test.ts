import { describe, expect, it } from 'vitest';
import { RENDER_TOOLS } from '../render-tools';
import { crewReviewSchema } from '../../../../../../shared/crew-review';
import { detectArtifact, UNIVERSAL_PRESENTATION_TOOLS } from '../../../../crew/core/crew-tools.service';

describe('professional review render tools', () => {
  it.each(['render_performance_scorecard', 'render_gate_review'])('registers and returns a validated artifact from %s', async name => {
    const tool = RENDER_TOOLS[name];
    const args = { template: 'custom', title: 'Review', summary: 'Evidence review', period: 'October 2026', methodologyVersion: 'v1', criteria: [{ label: 'Quality', score: 80, weight: 1, evidence: 'QA report' }] };
    const observation = await tool.execute(args, {} as any);
    const artifact = crewReviewSchema.parse(JSON.parse(observation as string));
    expect(artifact.type).toBe(name === 'render_gate_review' ? 'gate_review' : 'performance_scorecard');
    expect(tool.idempotency).toBe('read-safe');
    expect(artifact.criteria[0].evidence).toBe('QA report');
    expect(UNIVERSAL_PRESENTATION_TOOLS).toContain(name);
    expect(detectArtifact(name, observation as string)?.payload).toEqual(artifact);
  });
});
