import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listPipelines: vi.fn(),
}));

vi.mock('@domain/jobs/job.service.js', () => ({
  jobService: { list: h.listJobs },
}));

vi.mock('@domain/pipeline/core/pipeline.service.js', () => ({
  pipelineService: { list: h.listPipelines },
}));

import { FLOW_STUDIO_TOOLS } from '@server/domain/tools/v1/capabilities/flow-studio-tools.js';

describe('FLOW_STUDIO_TOOLS.propose_flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    userId: 'user_123',
    organizationId: 7,
    isAdmin: false,
    isOrgAdmin: false,
  } as any;

  it('generates enriched proposal with bounds, review perspectives, data edges, and readiness', async () => {
    h.listJobs.mockResolvedValue({
      items: [
        { id: 1, name: 'Extract Data', type: 'transformer' },
        { id: 2, name: 'AI Summarizer', type: 'ai_agent' },
        { id: 3, name: 'Notify Webhook', type: 'webhook' },
      ],
    });
    h.listPipelines.mockResolvedValue([]);

    const result = await FLOW_STUDIO_TOOLS.propose_flow.execute(
      {
        name: 'Automated Summarize and Notify',
        instruction: 'Extract data, summarize with AI, and webhook if summary exists',
        steps: [
          { job: 'Extract Data', outputName: 'extracted_text' },
          { job: 'AI Summarizer', outputName: 'summary_result', conditionExpression: 'extracted_text != null' },
          { job: 'Notify Webhook', conditionExpression: 'summary_result != null', onError: 'continue' },
        ],
      },
      mockContext
    );

    const proposal = JSON.parse(result as string);
    expect(proposal.name).toBe('Automated Summarize and Notify');
    expect(proposal.steps).toHaveLength(3);
    expect(proposal.readinessScore).toBeGreaterThanOrEqual(90);
    expect(proposal.proofStatus).toBe('VERIFIED');

    // Bounds
    expect(proposal.bounds).toBeDefined();
    expect(proposal.bounds.durationP50).toBeGreaterThan(0);
    expect(proposal.bounds.costP50).toBeGreaterThan(0);

    // Data Edges
    expect(proposal.dataEdges).toHaveLength(2);
    expect(proposal.dataEdges[0].portKey).toBe('extracted_text');
    expect(proposal.dataEdges[1].portKey).toBe('summary_result');

    // Review Perspectives
    expect(proposal.reviewPerspectives).toHaveLength(4);
    const lenses = proposal.reviewPerspectives.map((p: any) => p.lens);
    expect(lenses).toContain('security');
    expect(lenses).toContain('finops');
    expect(lenses).toContain('sre');
    expect(lenses).toContain('domain');
  });

  it('returns informative rejection message when requested job does not exist', async () => {
    h.listJobs.mockResolvedValue({
      items: [{ id: 1, name: 'Extract Data', type: 'transformer' }],
    });
    h.listPipelines.mockResolvedValue([]);

    const result = await FLOW_STUDIO_TOOLS.propose_flow.execute(
      {
        name: 'Broken Flow',
        instruction: 'Use nonexistent job',
        steps: [{ job: 'Nonexistent Job' }],
      },
      mockContext
    );

    expect(result).toContain('No job matches "Nonexistent Job"');
    expect(result).toContain('Extract Data (#1)');
  });

  it('rejects duplicate pipeline names', async () => {
    h.listJobs.mockResolvedValue({
      items: [{ id: 1, name: 'Extract Data', type: 'transformer' }],
    });
    h.listPipelines.mockResolvedValue([{ id: 99, name: 'Existing Pipeline' }]);

    const result = await FLOW_STUDIO_TOOLS.propose_flow.execute(
      {
        name: 'Existing Pipeline',
        instruction: 'Duplicate name',
        steps: [{ job: 'Extract Data' }],
      },
      mockContext
    );

    expect(result).toContain('This organization already has a flow called "Existing Pipeline"');
  });
});
