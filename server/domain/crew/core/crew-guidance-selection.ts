import { createHash } from 'node:crypto';
import type { CrewGuidanceReceipt } from '@shared/crew-guidance-receipt.js';
import { CREW_FINANCIAL_GUIDANCE } from './crew-financial-guidance.js';
import { granolaGuidanceFor } from './crew-granola-guidance.js';

const READINESS_GUIDANCE = '\n### CAPABILITY READINESS\nYour offered tool declarations establish availability only. Before a cross-provider handoff, call get_crew_readiness, validate destination inputs and use the applicable connection or metadata preflight. Do not infer credentials, access scopes, selected skills or successful execution from catalog registration. Ask only for the missing input or access evidenced by the tool result. Preserve successful source reads when a destination is blocked; report the completed and blocked steps separately. Never claim a write succeeded without its successful tool result.';
const MONEY_GUIDANCE = '\n### MONETARY DISPLAY\nShow every monetary amount with its currency symbol and at least two decimal places, preserving currency precision. Unknown currency is unverified. Counts, IDs, ratios, percentages and days are not money. Use deterministic offered tools for financial arithmetic and preserve separate currencies.';

/** Select platform-owned guidance only. Imported skill code is never executed or trusted as instructions here. */
export function selectCrewGuidance(input: { message: string; activeTopic?: string | null; priorArtifacts?: Array<{ tool: string }> }) {
  const entries = [
    { id: 'workflow-readiness', label: 'Workflow readiness', version: 1, reason: 'Standing handoff and execution grounding rules', content: READINESS_GUIDANCE },
    { id: 'monetary-display', label: 'Monetary display and arithmetic', version: 1, reason: 'Standing monetary display rules', content: MONEY_GUIDANCE },
  ];
  const text = `${input.message} ${input.activeTopic ?? ''}`;
  const financialRequest = /\b(?:quickbooks|financial|finance|cash\s*flows?|forecasts?|forecasting|invoices?|bills?|expenses?|revenue|profits?|balances?|payroll|tax(?:es)?|budgets?|accounting|currenc(?:y|ies)|monetary|valuation|dividends?|amorti[sz]ation|depreciation|interest|loans?|mortgages?|income|payments?|refunds?|npv|irr|ebitda)\b|[$€£¥]/i.test(text);
  const financialContext = input.priorArtifacts?.some(artifact => /^(?:quickbooks_|calculate_financial_|propose_financial_snapshot|compare_financial_snapshots)/.test(artifact.tool));
  if (financialRequest || financialContext) entries.push({ id: 'financial-calculation', label: 'Financial calculation and forecasting', version: 1,
    reason: financialRequest ? 'Financial request or active topic' : 'Recent financial result context', content: CREW_FINANCIAL_GUIDANCE });
  entries.push(...granolaGuidanceFor(text).map(entry => ({ ...entry, version: 1 })));
  const receipt: CrewGuidanceReceipt = { type: 'crew_guidance_receipt', version: 1, status: 'loaded_into_prompt', entries: entries.map(({ content, ...entry }) => ({ ...entry, contentHash: createHash('sha256').update(content).digest('hex') })) };
  return { prompt: entries.map(entry => entry.content).join('\n'), receipt };
}
