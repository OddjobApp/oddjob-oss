import { expect, it } from 'vitest';
import { selectCrewGuidance } from './crew-guidance-selection.js';
it('selects financial procedures for financial requests and keeps the receipt distinct from execution', () => {
  const { prompt, receipt } = selectCrewGuidance({ message: 'Forecast our QuickBooks cashflow and save a snapshot' });
  expect(prompt).toContain('quickbooks_forecast_cashflow');
  expect(receipt.status).toBe('loaded_into_prompt');
  expect(receipt.entries.map(entry => entry.id)).toContain('financial-calculation');
  expect(receipt.entries.every(entry => /^[a-f0-9]{64}$/.test(entry.contentHash))).toBe(true);
  expect(JSON.stringify(receipt)).not.toContain('CORE CAPABILITY');
});
it('avoids selecting detailed financial reference guidance for unrelated work while keeping universal money rules', () => {
  const { prompt, receipt } = selectCrewGuidance({ message: 'Write a screenplay about a lighthouse' });
  expect(receipt.entries.map(entry => entry.id)).toEqual(['workflow-readiness', 'monetary-display']);
  expect(prompt).toContain('at least two decimal places');
  expect(prompt).not.toContain('quickbooks_forecast_cashflow');
});
it('retains financial guidance for contextual follow-ups and produces stable source hashes', () => {
  const input = { message: 'Add the total', priorArtifacts: [{ tool: 'quickbooks_forecast_cashflow' }] };
  const first = selectCrewGuidance(input);
  expect(first.receipt.entries.at(-1)?.reason).toBe('Recent financial result context');
  expect(selectCrewGuidance(input).receipt).toEqual(first.receipt);
});
it.each(['Show recent invoices', 'Compare our payments and refunds', 'Explain these currencies', 'Calculate taxes'])('selects financial procedures for %s', message => {
  expect(selectCrewGuidance({ message }).receipt.entries.map(entry => entry.id)).toContain('financial-calculation');
});
