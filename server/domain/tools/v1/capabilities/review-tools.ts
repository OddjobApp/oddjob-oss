import { crewReviewSchema, CREW_REVIEW_TEMPLATES, validateCrewReviewTemplate } from '../../../../../shared/crew-review.js';
import type { ToolDefinition } from './types.js';

export const REVIEW_TOOLS: Record<string, ToolDefinition> = Object.fromEntries(
  (['performance_scorecard', 'gate_review'] as const).map(type => {
    const name = type === 'gate_review' ? 'render_gate_review' : 'render_performance_scorecard';
    return [name, {
      name,
      label: type === 'gate_review' ? 'Render Gate Review' : 'Render Performance Scorecard',
      group: 'Rich UI',
      idempotency: 'read-safe',
      riskLevel: 'low',
      description: 'Present an evidence-backed professional review. Scores use 0–100; use null for missing data. Gate status is pass, fail, or unknown. This renders a recommendation only and never approves, deploys, pays, or changes records. ' +
        'Pilot templates: ' + JSON.stringify(CREW_REVIEW_TEMPLATES) + '. Vendor weights describe the critical-vendor pilot; identify any different weighting in methodologyVersion. Provide sourced criteria and gate evidence; do not invent measurements.',
      parameters: crewReviewSchema.omit({ type: true }),
      execute: async (args: unknown) => JSON.stringify(validateCrewReviewTemplate(crewReviewSchema.parse({ ...(args as object), type }))),
    } satisfies ToolDefinition];
  }),
);
