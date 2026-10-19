import { describe, expect, it } from 'vitest';
import { formatCopilotCrewHandoff } from './copilot-crew-handoff';

describe('formatCopilotCrewHandoff', () => {
  it('preserves the discussion and its source context for crew review', () => {
    const result = formatCopilotCrewHandoff({
      source: 'copilot',
      createdAt: 1,
      projectName: 'Launch',
      page: 'mission_detail',
      mode: 'plan',
      messages: [
        { role: 'user', content: 'How should we launch?' },
        { role: 'agent', content: 'Start with a pilot.' },
      ],
    });

    expect(result).toContain('Project: Launch');
    expect(result).toContain('Page: mission detail');
    expect(result).toContain('User:\nHow should we launch?');
    expect(result).toContain('Oddjob Copilot:\nStart with a pilot.');
  });
});
