import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AgentChatPanel from './AgentChatPanel';

describe('CREW Room — Workflow Diagram & Mermaid X-Ray Artifact Rendering', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders a visual Mermaid X-Ray diagram artifact inside TurnRow when render_workflow_diagram is called', async () => {
    const mockTurn: any = {
      id: 101,
      speakerType: 'agent',
      speakerName: 'Copilot',
      userId: null,
      content: 'I have rendered the flow diagram for the Chaos Engineering Blueprint.',
      round: 1,
      agentCardId: 1,
      latencyMs: 1200,
      toolsUsed: [{ name: 'render_workflow_diagram', ok: true, ms: 150 }],
      artifacts: [
        {
          tool: 'render_workflow_diagram',
          payload: {
            type: 'workflow_diagram',
            title: 'Chaos Engineering & Auto-Recovery Drill',
            chart: `graph TD\n    chaos_inject["1. Fault Injection Probe"]\n    anomaly_detect["2. Anomaly Detection"]\n    chaos_inject --> anomaly_detect`,
          },
        },
      ],
      createdAt: new Date().toISOString(),
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/api/crew/')) {
        return new Response(
          JSON.stringify({
            id: 'test-workflow-diagram-room',
            turns: [mockTurn],
            activeAgentIds: [1],
            consensusPct: 80,
            direction: 'Chaos drill verification',
            critique: null,
            futureTopics: [],
            blackboardNotes: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      // The panel fetches its own turns and roster; it accepts only a room key.
      // The literals previously passed here (roomId/initialTurns/cards/
      // availableRoster) were props it has never declared.
      <AgentChatPanel roomKey="test-workflow-diagram-room" />
    );

    // Verify artifact title, badge, and turn artifact container render
    expect(await screen.findByText('Chaos Engineering & Auto-Recovery Drill')).toBeDefined();
    expect(await screen.findByText('Mermaid X-Ray')).toBeDefined();
    expect(await screen.findByTestId('turn-artifact')).toBeDefined();

    vi.restoreAllMocks();
  });
});
