import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaService } from '../../server/domain/ai/core/ollama.service';

describe('Ollama Open-Model Reasoning Service', () => {
  let ollamaService: OllamaService;

  beforeEach(() => {
    ollamaService = new OllamaService('http://localhost:11434');
  });

  it('searches remote model catalog', () => {
    const results = ollamaService.searchRemoteModels('deepseek');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('deepseek-r1');
  });

  it('parses thinking and plan tokens from open-model responses', async () => {
    const mockRawResponse = {
      response: '<think>Analyzing problem setup step 1</think><PLAN>Execute optimization</PLAN>Final calculated result',
      eval_count: 42,
      eval_duration: 100000
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRawResponse
    } as any);

    const result = await ollamaService.generateCompletion('deepseek-r1', 'Solve equation');
    expect(result.thinking).toBe('Analyzing problem setup step 1');
    expect(result.plan).toBe('Execute optimization');
    expect(result.response).toBe('Final calculated result');
  });
});
