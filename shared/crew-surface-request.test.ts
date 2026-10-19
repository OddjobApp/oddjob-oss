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
it('accepts location fields and returns verified picker objects or plain text', () => {
  const r = surfaceRequestSchema.parse({ ...base, fields: [{ key: 'origin', label: 'Origin', type: 'location', required: true }] });
  expect(r.fields![0].type).toBe('location');
  expect(() => validateSurfaceAnswers(r, {})).toThrow('required');
  expect(() => validateSurfaceAnswers(r, { origin: { address: '', lat: 34, lng: -118 } })).toThrow('invalid');
  expect(() => validateSurfaceAnswers(r, { origin: { address: 'LA', lat: 999, lng: 0 } })).toThrow('invalid');
  expect(validateSurfaceAnswers(r, { origin: { address: 'Denver, CO', lat: 39.7, lng: -105, resolvedAddress: 'Denver, Colorado, United States', extra: 'dropped' } }))
    .toEqual({ origin: { address: 'Denver, CO', lat: 39.7, lng: -105, resolvedAddress: 'Denver, Colorado, United States' } });
  expect(validateSurfaceAnswers(r, { origin: 'Denver, CO' })).toEqual({ origin: 'Denver, CO' });
});
