import { describe, it, expect } from 'vitest';
import { intentClassificationService } from '@domain/governor/core/intent-classification.service.js';
import { supportSwarmPackService } from '@domain/swarm/services/support-swarm-pack.service.js';
import { agentAssistCopilotService } from '@domain/swarm/services/agent-assist-copilot.service.js';

describe('Enterprise Conversational AI & Helpdesk Expansion Suite', () => {
  describe('Intent Classification Service', () => {
    it('classifies IT helpdesk messages correctly', () => {
      const result = intentClassificationService.classifyMessage('I need a VPN password reset on my laptop.');
      expect(result.intent).toBe('it_helpdesk_issue');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.suggestedAction).toBe('Spawn IT Support Swarm');
    });

    it('classifies HR inquiries correctly', () => {
      const result = intentClassificationService.classifyMessage('How many PTO vacation days do I have left?');
      expect(result.intent).toBe('hr_inquiry');
    });
  });

  describe('Support Swarm Pack Service', () => {
    it('spawns a Support Swarm task for IT tickets', async () => {
      const result = await supportSwarmPackService.spawnSupportSwarm({
        ticketId: 'TCK-9901',
        category: 'IT',
        subject: 'VPN Access Lockout',
        description: 'User locked out after 3 failed password attempts.',
        requesterEmail: 'user@enterprise.org'
      });

      expect(result.ticketId).toBe('TCK-9901');
      expect(result.triageTaskId).toBeGreaterThan(0);
      expect(result.assignedRoles).toContain('L1_Triage_Agent');
    });
  });

  describe('AgentAssist Copilot Service', () => {
    it('generates real-time suggestions and 1-click action buttons', async () => {
      const copilot = await agentAssistCopilotService.generateCopilotGuidance({
        conversationId: 'conv_4401',
        customerMessage: 'Please reset my system password.'
      });

      expect(copilot.suggestedReply).toContain('KB-104');
      expect(copilot.suggestedOneClickActions.length).toBeGreaterThan(0);
      expect(copilot.suggestedOneClickActions[0].label).toContain('Password Reset');
    });
  });
});
