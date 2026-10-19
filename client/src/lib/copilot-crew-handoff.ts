export const CREW_HANDOFF_STORAGE_PREFIX = 'oddjob:crew-handoff:';

export interface CopilotHandoffMessage {
  role: 'user' | 'agent';
  content: string;
}

export interface CopilotCrewHandoff {
  source: 'copilot';
  createdAt: number;
  projectName?: string | null;
  page?: string;
  mode?: string;
  messages: CopilotHandoffMessage[];
}

export function crewHandoffStorageKey(roomKey: string): string {
  return `${CREW_HANDOFF_STORAGE_PREFIX}${roomKey}`;
}

export function formatCopilotCrewHandoff(handoff: CopilotCrewHandoff): string {
  const context = [
    handoff.projectName ? `Project: ${handoff.projectName}` : null,
    handoff.page ? `Page: ${handoff.page.replace(/_/g, ' ')}` : null,
    handoff.mode ? `Copilot mode: ${handoff.mode}` : null,
  ].filter(Boolean);
  const transcript = handoff.messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Oddjob Copilot'}:\n${message.content.trim()}`)
    .join('\n\n');

  return [
    'Continue this discussion from Oddjob Copilot with the CREW.',
    context.length > 0 ? context.join('\n') : null,
    '--- Copilot discussion ---',
    transcript,
    '--- End discussion ---',
    'Review the discussion, identify unresolved questions, and recommend the next best action.',
  ].filter(Boolean).join('\n\n');
}

