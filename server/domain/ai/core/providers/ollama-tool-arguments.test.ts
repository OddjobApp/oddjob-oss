import { afterEach, expect, it, vi } from 'vitest';
import { OllamaClient } from './ollama-client.js';
vi.mock('../local-speculative.service.js', () => ({ LocalSpeculativeService: { applySpeculation: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

it.each([{ event: { summary: 'Review', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } } }, '{"calendar_id":"primary"}'])('normalizes native Ollama arguments for all tool consumers', async raw => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { tool_calls: [{ function: { name: 'gcal_create_event', arguments: raw } }] } }), { status: 200 })));
  const response = await new OllamaClient({ baseUrl: 'http://localhost:11434' }).execute({ model: 'test', userPrompt: 'Schedule', tools: [{ name: 'gcal_create_event', parameters: { type: 'object' } }] } as any, undefined, '');
  const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
  expect(response.success).toBe(true);
  expect(response.metadata?.toolCalls).toEqual([{ name: 'gcal_create_event', args, arguments: args }]);
});

it('retains malformed calls for schema repair without converting the entire response into a provider failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { tool_calls: [{ function: { name: 'gcal_create_event', arguments: '{broken' } }] } }), { status: 200 })));
  const response = await new OllamaClient({ baseUrl: 'http://localhost:11434' }).execute({ model: 'test', userPrompt: 'Schedule' } as any, undefined, '');
  expect(response.success).toBe(true);
  expect(response.metadata?.toolCalls).toEqual([{ name: 'gcal_create_event', args: {}, arguments: {} }]);
});
