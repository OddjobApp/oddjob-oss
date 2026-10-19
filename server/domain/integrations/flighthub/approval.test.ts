import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), createTask: vi.fn() }));
vi.mock('@domain/integrations/trycua/trycua-service.js', () => ({ trycuaService: { getSession: mocks.getSession } }));
vi.mock('@domain/integrations/trycua/computer-use-task.service.js', () => ({ trycuaComputerUseTaskService: { createTask: mocks.createTask } }));
import { executeFlightHubBookingApproval } from '../../tools/v1/capabilities/flighthub.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: 'owner', status: 'active', expiresAt: new Date(Date.now() + 60_000), metadata: { flighthubSearch: {
    resultsUrl: 'https://www.flighthub.com/results', searchedAt: new Date().toISOString(),
    offers: [{ offerRef: '0:abc', offerIndex: 0, signature: 'abc', airlineName: 'Verified airline', priceAmount: 500, currency: 'CAD' }],
  } } });
});
describe('FlightHub approval execution', () => {
  const args = { sessionId: 'session', sessionOwnerUserId: 'owner', offerRef: '0:abc', max_total: 500, airline: 'Invented airline', resultsUrl: 'https://evil.test/' };
  it('uses saved evidence and returns only a human handoff', async () => {
    const result = await executeFlightHubBookingApproval('flighthub_booking', args, { organizationId: 342, userId: 'owner' });
    expect(result.checkoutUrl).toBe('https://www.flighthub.com/results');
    expect(result.itinerary).toContain('Verified airline');
    expect(result.status).toBe('ready_for_human');
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
  it('refuses a different user even when they know the session and offer', async () => {
    await expect(executeFlightHubBookingApproval('flighthub_booking', args, { organizationId: 342, userId: 'other' })).rejects.toThrow(/user/);
  });
  it('refuses an over-budget fare at execution time', async () => {
    await expect(executeFlightHubBookingApproval('flighthub_booking', { ...args, max_total: 400 }, { organizationId: 342, userId: 'owner' })).rejects.toThrow(/budget/);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
