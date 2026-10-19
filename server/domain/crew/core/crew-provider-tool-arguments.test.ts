import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrewGenerationService } from './crew-generation.service.js';
import { llmRouterService } from '@domain/ai/core/llm-router.service.js';
import { GOOGLE_CALENDAR_TOOLS } from '@domain/tools/v1/capabilities/google-calendar.js';

afterEach(() => vi.restoreAllMocks());

describe('provider tool arguments reaching CREW', () => {
  const args = { calendar_id: 'primary', event: { summary: 'Hackathon', start: { dateTime: '2026-10-10T12:00:00-04:00' }, end: { dateTime: '2026-10-10T16:00:00-04:00' }, location: 'Zoom' }, send_updates: 'none', add_meet: false };
  it.each([
    { name: 'gcal_create_event', args },
    { name: 'gcal_create_event', arguments: args },
    { name: 'gcal_create_event', arguments: JSON.stringify(args) },
  ])('preserves the complete calendar payload from $name', async call => {
    const service = new CrewGenerationService();
    vi.spyOn(service as any, 'resolveModel').mockResolvedValue({ providerTechnicalName: 'ollama', modelIdentifier: 'test', isFallback: false });
    vi.spyOn(llmRouterService, 'complete').mockResolvedValue({ content: '', metadata: { toolCalls: [call] } } as any);
    const result = await service.generate({ id: 1, name: 'Copilot' } as any, 342, [], { tools: [{ name: 'gcal_create_event' }] });
    expect(result.toolCalls).toEqual([{ name: 'gcal_create_event', args }]);
    expect(GOOGLE_CALENDAR_TOOLS.gcal_create_event.parameters.safeParse(result.toolCalls[0].args).success).toBe(true);
  });
  it('leaves malformed JSON arguments to fail validation rather than inventing event details', async () => {
    const service = new CrewGenerationService();
    vi.spyOn(service as any, 'resolveModel').mockResolvedValue({ providerTechnicalName: 'ollama', modelIdentifier: 'test', isFallback: false });
    vi.spyOn(llmRouterService, 'complete').mockResolvedValue({ content: '', metadata: { toolCalls: [{ name: 'gcal_create_event', arguments: '{broken' }] } } as any);
    const result = await service.generate({ id: 1, name: 'Copilot' } as any, 342, [], { tools: [{ name: 'gcal_create_event' }] });
    expect(result.toolCalls[0].args).toEqual({});
    expect(GOOGLE_CALENDAR_TOOLS.gcal_create_event.parameters.safeParse(result.toolCalls[0].args).success).toBe(false);
  });
});
