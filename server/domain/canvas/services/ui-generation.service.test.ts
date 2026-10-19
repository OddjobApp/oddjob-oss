import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies.
//
// vi.hoisted, because the vi.mock factories below are hoisted above these
// declarations: as plain consts they were read from the temporal dead zone the
// moment ui-generation.service imported system-ai, and the file failed to
// collect with "Cannot access 'mockGetAiConfig' before initialization" —
// reporting 0 tests rather than a failure.
const { mockGetAiConfig, mockGetClient, mockExecute, mockAugmentSystemPrompt } = vi.hoisted(() => ({
  mockGetAiConfig: vi.fn(),
  mockGetClient: vi.fn(),
  mockExecute: vi.fn(),
  mockAugmentSystemPrompt: vi.fn(),
}));

vi.mock('@domain/ai/core/system-ai.service', () => ({
  systemAiService: {
    getAiConfig: mockGetAiConfig,
  },
}));

vi.mock('@domain/ai/core/ai-client.service', () => ({
  AIClientFactory: {
    getClient: mockGetClient,
  },
}));

vi.mock('@domain/agents/agent-persona.service', () => ({
  AgentPersonaService: {
    augmentSystemPrompt: mockAugmentSystemPrompt,
  },
}));

import { UiGenerationService } from './ui-generation.service.js';

describe('UiGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockGetAiConfig.mockResolvedValue({ model: 'test-model', apiKey: 'test-key' });
    mockGetClient.mockReturnValue({ execute: mockExecute });
    mockAugmentSystemPrompt.mockReturnValue('augmented-system-prompt');
    mockExecute.mockResolvedValue({ success: true, output: { app_tsx: '<div>Generated UI</div>', theme_css: 'body { color: red; }' } });
  });

  it('should invoke the UI Specialist agent with the correct parameters', async () => {
    const openApiSpec = { openapi: '3.0.0', info: { title: 'Test API' } };
    const organizationId = 123;

    await UiGenerationService.generateUiFromSpec(openApiSpec, '#000000', organizationId);

    // 1. Verify AI config was fetched for the correct persona and org
    expect(mockGetAiConfig).toHaveBeenCalledWith('ui_specialist', organizationId);

    // 2. Verify the system prompt was augmented for the persona
    expect(mockAugmentSystemPrompt).toHaveBeenCalledWith('ui_specialist');

    // 3. Verify the AI client was invoked with the correct details.
    //
    // The service asks for JSON now ("We now expect a JSON object"), not text,
    // and the user prompt is a compact JSON.stringify({ openApiSpec,
    // themeColor }) — not the pretty-printed spec on its own, which is what
    // the stringContaining match was looking for.
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        systemPrompt: 'augmented-system-prompt',
        responseType: 'json',
      }),
      undefined,
      'test-key'
    );

    // The spec and the theme both reach the model, which is what the prompt
    // assertion was for.
    const [call] = mockExecute.mock.calls;
    expect(JSON.parse(call[0].userPrompt)).toEqual({
      openApiSpec,
      themeColor: '#000000',
    });
  });

  it('should return the generated code on success', async () => {
    const generatedCode = '<div>Generated UI</div>';
    mockExecute.mockResolvedValue({ success: true, output: { app_tsx: generatedCode, theme_css: '' } });

    const result = await UiGenerationService.generateUiFromSpec({}, '#000000', 1);
    
    expect(result.app_tsx).toBe(generatedCode);
  });

  it('should throw an error if AI configuration is not found', async () => {
    mockGetAiConfig.mockResolvedValue(null);

    await expect(UiGenerationService.generateUiFromSpec({}, '#000000', 1)).rejects.toThrow(
      'AI Configuration (ui_specialist) not found'
    );
  });

  it('should throw an error if the agent execution fails', async () => {
    mockExecute.mockResolvedValue({ success: false, error: 'AI failed' });

    await expect(UiGenerationService.generateUiFromSpec({}, '#000000', 1)).rejects.toThrow(
      'UI Specialist agent failed: AI failed'
    );
  });
});
