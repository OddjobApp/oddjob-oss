import { expect, it } from 'vitest';
import { surfaceRequestSchema, validateSurfaceAnswers } from './crew-surface-request';
const base = { source: 'crew-surface-request', version: 1, roomKey: 'room', requestId: 'r', title: 'Input', kind: 'form' };
it('validates choices, required values and numeric values while dropping unknown fields', () => {
  const r = surfaceRequestSchema.parse({ ...base, fields: [{ key: 'priority', label: 'Priority', type: 'select', required: true, options: ['High'] }] });
  expect(() => validateSurfaceAnswers(r, {})).toThrow('required');
  expect(() => validateSurfaceAnswers(r, { priority: 'Injected' })).toThrow('invalid');
  expect(validateSurfaceAnswers(r, { priority: 'High', unauthorized: 'approve' })).toEqual({ priority: 'High' });
});
it('does not treat arbitrary input as approval and rejects duplicate fields', () => {
  expect(surfaceRequestSchema.safeParse({ ...base, kind: 'approval', fields: [{ key: 'ok', label: 'Approve?' }] }).success).toBe(false);
  expect(surfaceRequestSchema.safeParse({ ...base, fields: [{ key: 'x', label: 'X' }, { key: 'x', label: 'Other' }] }).success).toBe(false);
  expect(surfaceRequestSchema.safeParse({ ...base, kind: 'approval', approvalId: 42 }).success).toBe(true);
});
