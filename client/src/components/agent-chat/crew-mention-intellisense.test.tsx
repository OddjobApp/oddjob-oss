import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const mockApiRequest = vi.fn();

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

class EventSourceStub {
  static readonly OPEN = 1;
  readyState = 1;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

import { AgentChatPanel } from './AgentChatPanel';
import { TurnRow, AgentPill } from './TurnRow';

const copilotCard = {
  id: 7,
  name: 'Copilot',
  description: 'Platform copilot.',
  personaType: 'copilot',
  soulArchetype: 'Navigator',
  capabilities: ['app launch'],
  enabled: true,
};

const coderCard = {
  id: 12,
  name: 'Coder',
  description: 'Coding specialist.',
  personaType: 'coder',
  soulArchetype: 'Engineer',
  capabilities: ['code review'],
  enabled: true,
};

function installApiMock() {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'GET' && url === '/api/agent-cards') return { json: async () => [copilotCard, coderCard] };
    if (method === 'GET' && url.startsWith('/api/crew/primers')) return { json: async () => ({ primers: [], topicArchetypes: [] }) };
    if (method === 'GET' && url.startsWith('/api/crew/')) {
      return { json: async () => ({ session: null, members: [], turns: [], notes: [], plans: [], issues: [], raisedHands: [], participants: [], currentUserId: null }) };
    }
    return { json: async () => ({}) };
  });
}

describe('Crew composer @-mention intellisense', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    (globalThis as any).EventSource = EventSourceStub;
  });

  afterEach(() => cleanup());

  it('shows matching agents after typing @ and three letters with full agent pill attributes', async () => {
    installApiMock();

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hey @Cod' } });

    await waitFor(() => expect(screen.getByTestId('crew-mention-popover')).toBeTruthy());
    const option = screen.getByTestId('crew-mention-option-12');
    expect(option).toHaveTextContent('@Coder');
    expect(option).toHaveTextContent('Engineer');
    expect(option).toHaveTextContent('Squad');
    expect(option).toHaveTextContent('code review');
    expect(screen.getByText('Squad Agent Pills')).toBeInTheDocument();
  });

  it('does not show suggestions before three letters', async () => {
    installApiMock();

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hey @Co' } });

    expect(screen.queryByTestId('crew-mention-popover')).toBeNull();
  });

  it('navigates suggestions with keyboard and inserts mention with trailing space on Enter', async () => {
    installApiMock();

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello @Cop' } });

    await waitFor(() => expect(screen.getByTestId('crew-mention-popover')).toBeTruthy());
    const optionCopilot = screen.getByTestId('crew-mention-option-7');
    expect(optionCopilot).toHaveAttribute('aria-selected', 'true');

    // Press Enter to select
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('Hello @Copilot ');
    expect(screen.queryByTestId('crew-mention-popover')).toBeNull();
  });

  it('dismisses suggestions when Escape is pressed', async () => {
    installApiMock();

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Ping @Cod' } });

    await waitFor(() => expect(screen.getByTestId('crew-mention-popover')).toBeTruthy());

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('crew-mention-popover')).toBeNull();
  });
});

describe('TurnRow Agent Pill rendering with names prop', () => {
  it('renders @AgentName in user turns as styled agent pills', () => {
    render(
      <TurnRow
        turn={{
          id: 1,
          speakerType: 'user',
          userId: 'u1',
          speakerName: 'User',
          content: 'Can @Coder and @Copilot inspect the pipeline?',
          artifacts: [],
        } as any}
        names={['Coder', 'Copilot']}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />
    );

    const pills = screen.getAllByTestId('crew-agent-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent('@Coder');
    expect(pills[1]).toHaveTextContent('@Copilot');
  });

  it('renders @AgentName in agent turns as styled agent pills', () => {
    render(
      <TurnRow
        turn={{
          id: 2,
          speakerType: 'agent',
          speakerName: 'Coder',
          content: 'Handing off to @Copilot for final verification.',
          artifacts: [],
        } as any}
        names={['Coder', 'Copilot']}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />
    );

    const pill = screen.getByTestId('crew-agent-pill');
    expect(pill).toHaveTextContent('@Copilot');
    expect(pill).toHaveAttribute('data-agent-name', 'Copilot');
  });

  it('leaves non-agent mentions as plain text', () => {
    render(
      <TurnRow
        turn={{
          id: 3,
          speakerType: 'user',
          userId: 'u1',
          speakerName: 'User',
          content: 'Reach out to support@example.com or @UnknownAgent',
          artifacts: [],
        } as any}
        names={['Coder']}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />
    );

    expect(screen.queryByTestId('crew-agent-pill')).toBeNull();
    expect(screen.getByText(/support@example.com or @UnknownAgent/)).toBeInTheDocument();
  });
});
