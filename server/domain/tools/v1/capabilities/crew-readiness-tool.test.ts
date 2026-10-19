import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), readiness: vi.fn() }));
vi.mock('@domain/crew/core/crew-repository.js', () => ({ crewRepository: { findSession: mocks.find } }));
vi.mock('@domain/crew/core/crew-readiness.service.js', () => ({ getCrewReadiness: mocks.readiness }));
import { CAPABILITY_DISCOVERY_TOOLS } from './capability-discovery.js';
const tool = CAPABILITY_DISCOVERY_TOOLS.get_crew_readiness;
const context = { organizationId: 342, userId: 'u9', sessionKey: 'room', sessionId: 3, agentCardId: 1, projectId: 7, crewOfferedToolNames: ['gmail_get_message'] };
beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue({ id: 3, projectId: 7 }); mocks.readiness.mockResolvedValue({ checks: [] }); });
it('requires a real room execution context rather than caller-selected parameters', async () => {
  await expect(tool.execute({}, { organizationId: 342 })).rejects.toThrow('executing CREW');
  await expect(tool.execute({}, { ...context, organizationId: null })).rejects.toThrow('Organization context');
  expect(mocks.find).not.toHaveBeenCalled();
});
it('refuses mismatched room or project scope', async () => {
  await expect(tool.execute({}, { ...context, projectId: 8 })).rejects.toThrow('scope');
  await expect(tool.execute({}, { ...context, sessionId: 4 })).rejects.toThrow('scope');
  expect(mocks.readiness).not.toHaveBeenCalled();
});
it('passes the actual caller and exact offered tools to scoped readiness', async () => {
  await tool.execute({}, context);
  expect(mocks.find).toHaveBeenCalledWith(342, 'room');
  expect(mocks.readiness).toHaveBeenCalledWith({ id: 3, projectId: 7 }, undefined, 'u9', { id: 1, tools: ['gmail_get_message'] });
});
