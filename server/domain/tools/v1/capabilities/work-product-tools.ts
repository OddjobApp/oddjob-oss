import { crewWorkProductSchema } from '@shared/crew-work-product.js';
import type { ToolDefinition } from './types.js';

export const WORK_PRODUCT_TOOLS: Record<string, ToolDefinition> = {
  publish_work_product: {
    name: 'publish_work_product', label: 'Publish Room Work Product', group: 'Rich UI',
    idempotency: 'read-safe', riskLevel: 'low',
    description: 'Create or revise a room work product: a brief, plan, specification, research report, or summary. Reuse the same documentKey for revisions of the same deliverable. Include the complete current Markdown content and a short change summary. Cite evidence in the content, distinguish proposals from executed results, and identify unmet success criteria. This returns a versioned room artifact; it does not publish externally or approve or execute anything.',
    parameters: crewWorkProductSchema.omit({ type: true }),
    execute: async args => JSON.stringify(crewWorkProductSchema.parse({ ...args, type: 'crew_work_product' })),
  },
};
