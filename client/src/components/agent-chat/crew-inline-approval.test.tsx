import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock apiRequest
// importOriginal + spread so the factory cannot go stale as the module gains
// exports; listing them by hand is what broke when resolveActiveOrgId was added.
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

describe('CREW Inline Approval Card & Requester Permission Inheritance (Tier 3.5)', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
  });

  it('renders inline approval card with requester permission attribution', async () => {
    (apiRequest as any).mockImplementation((method: string, url: string) => {
      if (url.startsWith('/api/agent-cards')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve([
            { id: 1, name: 'Copilot', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true },
          ]),
        });
      }
      if (url.startsWith('/api/crew/primers')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }),
        });
      }
      if (url.startsWith('/api/crew/')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              turns: [
                {
                  id: 101,
                  speakerType: 'agent',
                  speakerName: 'Software Architect',
                  userId: null,
                  content: 'Here is the draft cycle for your approval.',
                  round: 1,
                  agentCardId: 1,
                  inReplyToTurnId: null,
                  topic: 'architecture',
                  intent: 'proposal',
                  latencyMs: 120,
                  toolsUsed: [{ name: 'propose_cycle_draft', ok: true, ms: 50 }],
                  artifacts: [
                    {
                      tool: 'propose_cycle_draft',
                      payload: {
                        type: 'approval_request',
                        kind: 'cycle_draft',
                        proposalId: 44201,
                        title: 'Operational Cycle Draft: "Incident Auto-Remediation"',
                        reason: 'Automate webhook incident triage with SOC2 approval gate',
                        cycleName: 'Incident Auto-Remediation',
                        scaffoldPacks: ['auth-jwt', 'observability-otel'],
                        requestedBy: 'sec_officer',
                        organizationId: 1,
                        status: 'pending',
                      },
                    },
                  ],
                },
              ],
              notes: [],
              plans: [],
              issues: [],
              members: [],
              session: { consensusLevel: 100 },
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="crew-approval-unit-test" />);

    // Verify the Inline Approval Card renders
    await waitFor(() => {
      expect(screen.getByTestId('inline-approval-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Operational Cycle Draft: "Incident Auto-Remediation"')).toBeInTheDocument();
    expect(screen.getByText(/Automate webhook incident triage with SOC2 approval gate/)).toBeInTheDocument();
    expect(screen.getByText(/Permissions inherited from/)).toBeInTheDocument();
    expect(screen.getByText('@sec_officer')).toBeInTheDocument();
    expect(screen.getByText('auth-jwt')).toBeInTheDocument();
    expect(screen.getByText('observability-otel')).toBeInTheDocument();

    // Verify Action Buttons
    const approveBtn = screen.getByTestId('approve-proposal-button');
    const rejectBtn = screen.getByTestId('reject-proposal-button');
    expect(approveBtn).toBeInTheDocument();
    expect(rejectBtn).toBeInTheDocument();
  });

  it('clicking Approve dispatches decision with requester credentials and updates card status', async () => {
    (apiRequest as any).mockImplementation((method: string, url: string, data: any) => {
      if (url === '/api/approvals/44201/decision') {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve({ status: 'approved', proposalId: 44201 }),
        });
      }
      if (url.startsWith('/api/crew/message')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve({ success: true }),
        });
      }
      if (url.startsWith('/api/agent-cards')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve([
            { id: 1, name: 'Copilot', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true },
          ]),
        });
      }
      if (url.startsWith('/api/crew/primers')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [] }) });
      }
      if (url.startsWith('/api/crew/')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              turns: [
                {
                  id: 101,
                  speakerType: 'agent',
                  speakerName: 'Software Architect',
                  userId: null,
                  content: 'Proposal ready.',
                  round: 1,
                  agentCardId: 1,
                  inReplyToTurnId: null,
                  topic: 'architecture',
                  intent: 'proposal',
                  latencyMs: 120,
                  toolsUsed: [],
                  artifacts: [
                    {
                      tool: 'propose_cycle_draft',
                      payload: {
                        type: 'approval_request',
                        kind: 'cycle_draft',
                        proposalId: 44201,
                        title: 'Operational Cycle Draft: "Incident Auto-Remediation"',
                        reason: 'Automate incident triage',
                        requestedBy: 'sec_officer',
                        status: 'pending',
                      },
                    },
                  ],
                },
              ],
              notes: [],
              plans: [],
              issues: [],
              members: [],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="crew-approval-action-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('approve-proposal-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('approve-proposal-button'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/approvals/44201/decision',
        { decision: 'approved' }
      );
    });

    // Verify status switches to approved
    await waitFor(() => {
      expect(screen.getByText(/Decision recorded as/i)).toBeInTheDocument();
      expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
    });
  });

  it('renders interactive CAPTCHA HIL resolution box and submits solution in modifiedOutput', async () => {
    (apiRequest as any).mockImplementation((method: string, url: string) => {
      if (url.startsWith('/api/agent-cards')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve([
            { id: 1, name: 'Copilot', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true },
          ]),
        });
      }
      if (url.startsWith('/api/crew/primers')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }),
        });
      }
      if (url.startsWith('/api/crew/')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              turns: [
                {
                  id: 103,
                  speakerType: 'agent',
                  speakerName: 'Titan Browser Agent',
                  userId: null,
                  content: 'Paused for CAPTCHA challenge.',
                  round: 1,
                  agentCardId: 1,
                  inReplyToTurnId: null,
                  topic: 'browser',
                  intent: 'hil_pause',
                  latencyMs: 150,
                  toolsUsed: [],
                  artifacts: [
                    {
                      tool: 'pause_for_captcha',
                      payload: {
                        type: 'captcha_solution',
                        kind: 'captcha_solution',
                        proposalId: 99101,
                        title: 'Solve CAPTCHA / Security Challenge',
                        status: 'pending',
                        context: {
                          type: 'captcha_solution',
                          goal: 'Download monthly invoice from vendor portal',
                          screenshot: 'data:image/jpeg;base64,mockScreenshotBase64Data',
                        },
                      },
                    },
                  ],
                },
              ],
              notes: [],
              plans: [],
              issues: [],
              members: [],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="crew-captcha-hil-test" />);

    // Verify CAPTCHA resolution box and screenshot render
    await waitFor(() => {
      expect(screen.getByTestId('captcha-solution-box')).toBeInTheDocument();
      expect(screen.getByTestId('captcha-solution-input')).toBeInTheDocument();
      expect(screen.getByAltText('CAPTCHA Challenge')).toBeInTheDocument();
    });

    // Enter the solved text
    fireEvent.change(screen.getByTestId('captcha-solution-input'), {
      target: { value: '7XG4K' },
    });

    // Click submit
    fireEvent.click(screen.getByTestId('approve-proposal-button'));

    // Verify apiRequest was called with decision and modifiedOutput containing the solution
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/approvals/99101/decision',
        {
          decision: 'approved',
          modifiedOutput: { solution: '7XG4K' },
        }
      );
    });
  });

  it('renders an outbound email draft card and sends on Send email', async () => {
    (apiRequest as any).mockImplementation((method: string, url: string, data: any) => {
      if (url === '/api/approvals/55301/decision') {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ status: 'approved', outboundMessage: { handled: true, sent: true } }),
        });
      }
      if (url.startsWith('/api/crew/message')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      if (url.startsWith('/api/agent-cards')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve([
            { id: 1, name: 'Copilot', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true },
          ]),
        });
      }
      if (url.startsWith('/api/crew/primers')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [] }) });
      }
      if (url.startsWith('/api/crew/')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              turns: [
                {
                  id: 105,
                  speakerType: 'agent',
                  speakerName: 'Outbound Agent',
                  userId: null,
                  content: 'Draft ready for review.',
                  round: 1,
                  agentCardId: 1,
                  inReplyToTurnId: null,
                  topic: 'outreach',
                  intent: 'proposal',
                  latencyMs: 120,
                  toolsUsed: [{ name: 'propose_outbound_message', ok: true, ms: 40 }],
                  artifacts: [
                    {
                      tool: 'propose_outbound_message',
                      payload: {
                        type: 'approval_request',
                        kind: 'outbound_message',
                        channel: 'email',
                        sendTool: 'send_agentmail',
                        proposalId: 55301,
                        title: 'New email to dana@northwind.io',
                        from: 'sam@x.ai',
                        to: ['dana@northwind.io'],
                        subject: 'Three infra roles and a migration',
                        body: 'Hi Dana,\n\nSaw Northwind opened three infra roles.',
                        trigger: 'Replying to the room\'s research request about Northwind\'s open roles',
                        sensitivity: 'external_first_contact',
                        reason: 'Follow-up on the March migration conversation',
                        requestedBy: 'outbound_agent',
                        status: 'pending',
                      },
                    },
                  ],
                },
              ],
              notes: [],
              plans: [],
              issues: [],
              members: [],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="crew-outbound-email-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('outbound-message-preview')).toBeInTheDocument();
    });

    // Card shows the draft exactly like the reference surface
    expect(screen.getByText('New email')).toBeInTheDocument();
    expect(screen.getByText('Ready to send')).toBeInTheDocument();
    expect(screen.getByText('sam@x.ai')).toBeInTheDocument();
    expect(screen.getByText('dana@northwind.io')).toBeInTheDocument();
    expect(screen.getByText('Three infra roles and a migration')).toBeInTheDocument();
    expect(screen.getByText(/Saw Northwind opened three infra roles/)).toBeInTheDocument();

    // Situation context for the reviewer's decision
    expect(screen.getByTestId('outbound-trigger')).toHaveTextContent(/research request about Northwind/);
    expect(screen.getByText('First contact')).toBeInTheDocument();
    expect(screen.getByText('@outbound_agent')).toBeInTheDocument();

    const sendBtn = screen.getByTestId('approve-proposal-button');
    expect(sendBtn).toHaveTextContent(/send email/i);
    expect(screen.getByTestId('reject-proposal-button')).toHaveTextContent(/discard/i);

    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/approvals/55301/decision',
        { decision: 'approved' }
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });
  });

  it('supports interactive visual escalation with zoom and click coordinates for challenge resolution', async () => {
    (apiRequest as any).mockImplementation((method: string, url: string) => {
      if (url.includes('/api/crew/crew-visual-hil-test')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              crew: { id: 1, name: 'Visual HIL Crew', slug: 'crew-visual-hil-test' },
              turns: [
                {
                  id: 104,
                  speakerType: 'agent',
                  speakerName: 'Titan Browser Agent',
                  userId: null,
                  content: 'Verification required',
                  timestamp: new Date().toISOString(),
                  round: 1,
                  agentCardId: 1,
                  inReplyToTurnId: null,
                  topic: 'browser',
                  intent: 'hil_pause',
                  latencyMs: 150,
                  toolsUsed: [],
                  artifacts: [
                    {
                      tool: 'pause_for_captcha',
                      payload: {
                        type: 'security_challenge',
                        kind: 'security_challenge',
                        proposalId: 99102,
                        title: 'Solve Security Verification',
                        status: 'pending',
                        context: {
                          type: 'security_challenge',
                          goal: 'Bypass cloudflare challenge',
                          screenshot: 'data:image/jpeg;base64,mockScreenshotBase64Data',
                        },
                      },
                    },
                  ],
                },
              ],
              notes: [],
              plans: [],
              issues: [],
              members: [],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="crew-visual-hil-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('captcha-solution-box')).toBeInTheDocument();
      expect(screen.getByTestId('toggle-zoom-button')).toBeInTheDocument();
    });

    // Test zoom toggle
    fireEvent.click(screen.getByTestId('toggle-zoom-button'));
    expect(screen.getByText('Fit')).toBeInTheDocument();

    // Click on challenge image to mark target coordinates
    const img = screen.getByTestId('captcha-challenge-image');
    fireEvent.click(img, { clientX: 120, clientY: 85 });

    // Submit with coordinates
    fireEvent.click(screen.getByTestId('approve-proposal-button'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/approvals/99102/decision',
        expect.objectContaining({
          decision: 'approved',
          modifiedOutput: expect.objectContaining({
            coordinates: expect.any(Object),
          }),
        })
      );
    });
  });
});
