import { z } from 'zod';

const criterion = z.object({
  label: z.string().min(1),
  score: z.number().finite().min(0).max(100).nullable(),
  weight: z.number().finite().positive(),
  evidence: z.string().min(1),
});

export const crewReviewSchema = z.object({
  type: z.enum(['performance_scorecard', 'gate_review']),
  template: z.enum(['vendor_performance', 'project_phase_gate', 'custom']),
  title: z.string().min(1),
  summary: z.string().min(1),
  period: z.string().min(1),
  methodologyVersion: z.string().min(1),
  criteria: z.array(criterion).min(1),
  gates: z.array(z.object({
    label: z.string().min(1),
    status: z.enum(['pass', 'fail', 'unknown']),
    evidence: z.string().min(1),
  })).default([]),
  actions: z.array(z.object({
    description: z.string().min(1),
    owner: z.string().min(1).optional(),
    due: z.string().min(1).optional(),
  })).default([]),
});

export type CrewReview = z.infer<typeof crewReviewSchema>;

// Missing evidence is never treated as a passing gate or a zero score.
export function summarizeCrewReview(review: CrewReview) {
  const complete = review.criteria.every(item => item.score !== null);
  const weight = review.criteria.reduce((sum, item) => sum + item.weight, 0);
  const score = complete
    ? review.criteria.reduce((sum, item) => sum + item.score! * item.weight, 0) / weight
    : null;
  const status = review.gates.some(gate => gate.status === 'fail') ? 'Blocked'
    : !complete || review.gates.some(gate => gate.status === 'unknown') ? 'Needs evidence'
    : 'Ready for review';
  return { score, status, assessed: review.criteria.filter(item => item.score !== null).length };
}

export const CREW_REVIEW_TEMPLATES = {
  vendor_performance: {
    title: 'Vendor performance review',
    criteria: [
      { label: 'SLA and reliability', weight: 30 },
      { label: 'Deliverable quality', weight: 25 },
      { label: 'Commercial performance', weight: 20 },
      { label: 'Relationship and service', weight: 25 },
    ],
    gates: ['Current certifications', 'No unresolved security incidents', 'Privacy compliance'],
  },
  project_phase_gate: {
    title: 'Project phase-gate review',
    criteria: [
      { label: 'Deliverable completeness', weight: 35 },
      { label: 'Technical verification', weight: 30 },
      { label: 'Operational readiness', weight: 20 },
      { label: 'Business case', weight: 15 },
    ],
    gates: ['No unresolved critical security findings', 'Architecture approval recorded', 'At least 90% of mandatory deliverables complete'],
  },
} as const;

export function validateCrewReviewTemplate(review: CrewReview): CrewReview {
  if (review.template === 'custom') return review;
  const expectedType = review.template === 'vendor_performance' ? 'performance_scorecard' : 'gate_review';
  if (review.type !== expectedType) throw new Error('Review type does not match the selected pilot template');
  const template = CREW_REVIEW_TEMPLATES[review.template];
  if (review.criteria.length !== template.criteria.length || template.criteria.some(expected =>
    review.criteria.filter(actual => actual.label === expected.label && actual.weight === expected.weight).length !== 1)) {
    throw new Error('Pilot criteria and weights must match the template; use custom for another methodology');
  }
  if (template.gates.some(label => !review.gates.some(gate => gate.label === label))) {
    throw new Error('Every pilot mandatory criterion must be supplied, using unknown when evidence is missing');
  }
  return review;
}
