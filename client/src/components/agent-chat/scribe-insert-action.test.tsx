/**
 * The "Insert into Station" action, once per draft rather than once per turn.
 *
 * The gate was `turn.content.length > 25`, so a room's opening exchange grew
 * three of them — on the greeting, on "I'll draft that now", and on the actual
 * draft. The audit read them as duplicate actions. They were worse: the insert
 * appends the turn verbatim, so two of the three offered to write chatter into
 * the contract.
 *
 * insertable-draft.test.ts covers which turns qualify. This covers the panel
 * actually asking, and handing over the draft rather than the whole turn.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
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

import { apiRequest } from '@/lib/queryClient';
import { AgentChatPanel } from './AgentChatPanel';

const PARAGRAPH =
  'The vendor shall deliver each work package in accordance with the milestone schedule set ' +
  'out in Schedule 2, and shall notify the client in writing of any anticipated delay as soon ' +
  'as it becomes apparent.';

const turn = (id: number, content: string, artifacts: any[] = []) => ({
  id,
  speakerType: 'agent',
  speakerName: 'Scribe Lead',
  userId: null,
  content,
  round: 1,
  agentCardId: 1,
  inReplyToTurnId: null,
  topic: 'authoring',
  intent: 'draft',
  latencyMs: 100,
  toolsUsed: [],
  artifacts,
});

/** The studio has to be mounted for the action to be offered at all. */
const SCRIBE_MOUNT = [
  { tool: 'mount_scribe_studio', payload: { type: 'scribe_foundry_pod', documentId: 5, title: 'SOW', archetypeMode: 'sow_statement_of_work' } },
];

const stubRoom = (turns: any[]) => {
  (apiRequest as any).mockImplementation((_m: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 1, name: 'Scribe Lead', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true }]) });
    }
    if (url.startsWith('/api/crew/primers')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    }
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve({ turns, notes: [], plans: [], issues: [], members: [], session: { consensusLevel: 100 } }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
};

describe('inserting an agent draft into the studio', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
  });

  it('offers one action across a greeting, an announcement and a draft', async () => {
    // The exact opening exchange the audit captured as three duplicates.
    stubRoom([
      turn(1, "Hello! I'm the Scribe Lead. I'll help you put this Statement of Work together.", SCRIBE_MOUNT),
      turn(2, "Let me draft the scope section based on what you've described."),
      turn(3, `Here's the scope section:\n\n${PARAGRAPH}`),
    ]);

    render(<AgentChatPanel roomKey="crew-scribe-insert-test" />);

    await waitFor(() => expect(screen.getAllByTestId('scribe-insert-draft')).toHaveLength(1));
  });

  it('hands over the draft, not the conversation around it', async () => {
    // The insert appends verbatim, so this is what reaches the manuscript.
    stubRoom([turn(1, `Certainly! Here's the scope section:\n\n${PARAGRAPH}\n\nLet me know if you'd like it tightened.`, SCRIBE_MOUNT)]);

    const inserted: string[] = [];
    window.addEventListener('scribe:insert-text', (e) => inserted.push((e as CustomEvent).detail?.text));

    render(<AgentChatPanel roomKey="crew-scribe-insert-test" />);

    fireEvent.click(await screen.findByTestId('scribe-insert-draft'));

    expect(inserted).toEqual([PARAGRAPH]);
  });

  it('offers nothing when the studio is not mounted', async () => {
    stubRoom([turn(1, `Here's the scope section:\n\n${PARAGRAPH}`)]);

    render(<AgentChatPanel roomKey="crew-scribe-insert-test" />);

    await waitFor(() => expect(screen.getByText(/scope section/)).toBeInTheDocument());
    expect(screen.queryByTestId('scribe-insert-draft')).not.toBeInTheDocument();
  });

  it('offers nothing on a room of pure chatter', async () => {
    stubRoom([
      turn(1, "Hello! I'm the Scribe Lead and I'll be helping you with this document today.", SCRIBE_MOUNT),
      turn(2, 'Working on the milestone table — one moment.'),
    ]);

    render(<AgentChatPanel roomKey="crew-scribe-insert-test" />);

    await waitFor(() => expect(screen.getByText(/milestone table/)).toBeInTheDocument());
    expect(screen.queryByTestId('scribe-insert-draft')).not.toBeInTheDocument();
  });
});
