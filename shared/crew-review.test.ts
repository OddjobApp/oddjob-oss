import { describe, expect, it } from 'vitest';
import { crewReviewSchema, summarizeCrewReview, CREW_REVIEW_TEMPLATES, validateCrewReviewTemplate } from './crew-review';

const review = crewReviewSchema.parse({
  type: 'gate_review', template: 'project_phase_gate', title: 'Validation gate',
  summary: 'Review required', period: 'October 2026', methodologyVersion: 'pilot-v1',
  criteria: [{ label: 'Delivery', score: 100, weight: 3, evidence: 'Artifact inventory' },
    { label: 'Testing', score: 60, weight: 1, evidence: 'Test report' }],
});

describe('CREW review evidence and readiness', () => {
  it('calculates a weighted score without issuing approval', () => {
    expect(summarizeCrewReview(review)).toEqual({ score: 90, status: 'Ready for review', assessed: 2 });
  });
  it('keeps a failed mandatory criterion visible despite a high score', () => {
    expect(summarizeCrewReview({ ...review, gates: [{ label: 'Security', status: 'fail', evidence: 'Open P0' }] }).status).toBe('Blocked');
  });
  it('withholds the composite for missing data and distinguishes unknown gates', () => {
    expect(summarizeCrewReview({ ...review, criteria: [{ ...review.criteria[0], score: null }] }).score).toBeNull();
    expect(summarizeCrewReview({ ...review, gates: [{ label: 'Approval', status: 'unknown', evidence: 'No recorded sign-off' }] }).status).toBe('Needs evidence');
  });
  it('rejects invalid score ranges and nonpositive weights', () => {
    for (const invalid of [{ score: 101 }, { score: -1 }, { weight: 0 }]) {
      expect(crewReviewSchema.safeParse({ ...review, criteria: [{ ...review.criteria[0], ...invalid }] }).success).toBe(false);
    }
  });
  it.each(['vendor_performance', 'project_phase_gate'] as const)('requires every %s pilot criterion and gate', template => {
    const config = CREW_REVIEW_TEMPLATES[template];
    const pilot = crewReviewSchema.parse({ ...review,
      type: template === 'vendor_performance' ? 'performance_scorecard' : 'gate_review', template,
      criteria: config.criteria.map(item => ({ ...item, score: null, evidence: 'Awaiting report' })),
      gates: config.gates.map(label => ({ label, status: 'unknown', evidence: 'Awaiting verification' })),
    });
    expect(validateCrewReviewTemplate(pilot)).toEqual(pilot);
    expect(() => validateCrewReviewTemplate({ ...pilot, gates: [] })).toThrow('mandatory criterion');
    expect(() => validateCrewReviewTemplate({ ...pilot, criteria: pilot.criteria.slice(1) })).toThrow('criteria and weights');
  });
});
