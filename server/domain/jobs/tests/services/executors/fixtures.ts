export const EXECUTOR_FIXTURES = {
  api: {
    valid: {
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
    invalid: {
      url: 'not-a-url',
      method: 'INVALID',
    },
  },
  ai_agent: {
    valid: {
      goal: 'Process customer data',
      systemPrompt: 'You are a data processing agent',
      model: 'gpt-4',
      provider: 'openai',
    },
    invalid: {
      goal: 'too short',
      systemPrompt: 'too short',
    },
  },
  shell: {
    valid: {
      command: 'echo "hello"',
      timeout: 5000,
    },
    invalid: {
      command: '', // empty command
      timeout: -1, // negative timeout
    },
  },
};

export const MOCK_RESPONSES = {
  api: {
    success: {
      status: 200,
      data: { result: 'success' },
    },
    timeout: {
      error: 'ETIMEDOUT',
    },
    rateLimit: {
      status: 429,
      headers: { 'Retry-After': '60' },
    },
  },
};
