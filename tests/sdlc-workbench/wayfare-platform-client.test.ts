import { afterEach, expect, it, vi } from 'vitest';
import { tripsRequest } from '../../server/blueprints/apps/wayfare/lib/platform-client';

afterEach(() => vi.unstubAllGlobals());
it('displays structured provider errors as actionable messages', async () => {
  vi.stubGlobal('location', { search: '?crewRoom=acceptance' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 400,
    json: async () => ({ error: { message: 'EV Charge Finder requires separate entitlement.' } }),
  }));
  await expect(tripsRequest({}, '/chargers')).rejects.toThrow('EV Charge Finder requires separate entitlement.');
});
