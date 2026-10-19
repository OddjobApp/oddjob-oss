import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const mockApiRequest = vi.fn();

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import { CrewComposer } from './CrewComposer';
import { TurnRow } from './TurnRow';

const agents = [
  { id: 1, name: 'Copilot', personaType: 'copilot', capabilities: [], enabled: true },
];

const knowledgeTopics = [
  { id: 11, name: 'Pricing', documentCount: 4 },
  { id: 12, name: 'Vendor A', documentCount: 2 },
];

function installApiMock() {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'GET' && url === '/api/knowledge/topics') {
      return { json: async () => ({ topics: knowledgeTopics }) };
    }
    return { json: async () => ({}) };
  });
}

function renderComposer(extraProps: Record<string, any> = {}) {
  return render(
    createElement(CrewComposer, {
      onSend: vi.fn(),
      disabled: false,
      memberCount: 1,
      agents: agents as any,
      ...extraProps,
    }),
  );
}

describe('Crew composer #-topic intellisense', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    installApiMock();
  });

  afterEach(() => cleanup());

  it('opens the topic lookup after # and two characters', async () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'compare #pr' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-popover')).toBeTruthy());
    expect(screen.getByTestId('crew-topic-option-11')).toHaveTextContent('#Pricing');
  });

  it('does not open for a single character after #', () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'compare #p' } });

    expect(screen.queryByTestId('crew-topic-popover')).toBeNull();
  });

  it('does not open for a # inside a URL fragment', () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'see https://x.com/a#pricing' } });

    expect(screen.queryByTestId('crew-topic-popover')).toBeNull();
  });

  it('does not open for a markdown heading', () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# heading' } });

    expect(screen.queryByTestId('crew-topic-popover')).toBeNull();
  });

  it('inserts a bare tag for a single-word topic on Enter', async () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'talk #pr' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-popover')).toBeTruthy());
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea.value).toBe('talk #pricing ');
    expect(screen.queryByTestId('crew-topic-popover')).toBeNull();
  });

  it('inserts the bracketed spelling for a multi-word topic', async () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'compare #vend' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-option-12')).toBeTruthy());
    fireEvent.click(screen.getByTestId('crew-topic-option-12'));

    expect(textarea.value).toBe('compare #[Vendor A] ');
  });

  it('offers a freeform create row for an unknown tag', async () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'deep dive #quantum' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-create')).toBeTruthy());
    fireEvent.click(screen.getByTestId('crew-topic-create'));

    expect(textarea.value).toBe('deep dive #quantum ');
  });

  it('surfaces room-recent labels before the knowledge vocabulary', async () => {
    renderComposer({ recentTopics: ['Pricing Model'] });

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'on #pri' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-popover')).toBeTruthy());
    const recent = screen.getByTestId('crew-topic-option-Pricing Model');
    expect(recent).toHaveTextContent('Used in this room');
  });

  it('dismisses the popover on Escape', async () => {
    renderComposer();

    const textarea = screen.getByTestId('crew-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'about #pri' } });

    await waitFor(() => expect(screen.getByTestId('crew-topic-popover')).toBeTruthy());
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('crew-topic-popover')).toBeNull();
  });
});

describe('TurnRow declared-topic chips', () => {
  const topic = (over: Record<string, any> = {}) => ({
    id: 5,
    sessionId: 1,
    turnId: 1,
    organizationId: 1,
    round: 1,
    topicId: 11,
    label: 'Pricing',
    rawLabel: 'pricing',
    source: 'user' as const,
    status: 'applied' as const,
    ...over,
  });

  it('renders chips under a user turn', () => {
    render(
      <TurnRow
        turn={{
          id: 1,
          speakerType: 'user',
          userId: 'u1',
          speakerName: 'User',
          content: 'talk about #pricing please',
          artifacts: [],
        } as any}
        topics={[topic()]}
        names={[]}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />,
    );

    const chip = screen.getByTestId('crew-topic-chip');
    expect(chip).toHaveTextContent('#Pricing');
    expect(chip).toHaveAttribute('data-topic-id', '11');
  });

  it('renders chips under an agent turn', () => {
    render(
      <TurnRow
        turn={{
          id: 2,
          speakerType: 'agent',
          speakerName: 'Copilot',
          content: 'Recommending a #[Pricing] review.',
          artifacts: [],
        } as any}
        topics={[topic({ turnId: 2, source: 'agent' })]}
        names={[]}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />,
    );

    expect(screen.getByTestId('crew-topic-chip')).toHaveTextContent('#Pricing');
  });

  it('renders no chip container when the turn has no tags', () => {
    render(
      <TurnRow
        turn={{
          id: 3,
          speakerType: 'agent',
          speakerName: 'Copilot',
          content: 'No tags here.',
          artifacts: [],
        } as any}
        names={[]}
        onArtifactSubmit={vi.fn()}
        currentUserId="u1"
      />,
    );

    expect(screen.queryByTestId('crew-topic-chips')).toBeNull();
  });
});
