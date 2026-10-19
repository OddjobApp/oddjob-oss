import { expect, it } from 'vitest';
import { isBoundSurfaceApproval } from './crew-surface-approval';
it('rejects approvals from another app, room or action kind', () => {
  const args = { kind: 'app_record_action', app: { id: 888 }, sessionKey: 'room' };
  expect(isBoundSurfaceApproval(args, 888, 'room')).toBe(true);
  expect(isBoundSurfaceApproval(args, 889, 'room')).toBe(false);
  expect(isBoundSurfaceApproval(args, 888, 'other')).toBe(false);
  expect(isBoundSurfaceApproval({ ...args, kind: 'calendar_action' }, 888, 'room')).toBe(false);
  expect(isBoundSurfaceApproval(null, 888, 'room')).toBe(false);
});
