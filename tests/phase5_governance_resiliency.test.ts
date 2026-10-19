import { describe, it, expect } from 'vitest';
import { channelGatewayService, GenericChannelAdapter } from '@domain/governor/core/channel-gateway.service.js';
import { policyEnforcementService } from '@domain/governor/core/policy-enforcement.service.js';
import { containerReconciliationService } from '@domain/infrastructure/container-reconciliation.service.js';

describe('Phase 5 & 5.5 Execution Suite', () => {
  describe('Channel Gateway Service', () => {
    it('dispatches messages via Slack adapter successfully', async () => {
      const result = await channelGatewayService.dispatchResponse('slack', 'general_channel', 'Hello from Oddjob!');
      expect(result.status).toBe('sent');
      expect(result.channel).toBe('slack');
    });

    it('handles incoming channel commands cleanly', async () => {
      const result = await channelGatewayService.handleIncomingMessage({
        channel: 'discord',
        channelId: 'dev_chat',
        senderId: 'dev_user_99',
        senderName: 'Jane Developer',
        text: 'Deploy staging build #405'
      });

      expect(result.message).toBeDefined();
    });
  });

  describe('Policy Enforcement Service', () => {
    it('allows normal tool execution and file access', () => {
      const evalResult = policyEnforcementService.evaluateAccess({
        agentId: 1,
        agentRole: 'developer',
        actionType: 'file_access',
        targetResource: 'server/domain/swarm/services/task-marketplace.service.ts'
      });

      expect(evalResult.allowed).toBe(true);
      expect(evalResult.ruleMatched).toBe('RULE_DEFAULT_ALLOW');
    });

    it('blocks access to restricted sensitive file paths', () => {
      const evalResult = policyEnforcementService.evaluateAccess({
        agentId: 2,
        agentRole: 'qa',
        actionType: 'file_access',
        targetResource: '/etc/passwd'
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.ruleMatched).toBe('RULE_RESTRICTED_FILE_PATH');
      expect(evalResult.requiresHILApproval).toBe(true);
    });

    it('blocks destructive command execution', () => {
      const evalResult = policyEnforcementService.evaluateAccess({
        agentId: 3,
        agentRole: 'devops',
        actionType: 'tool_execution',
        targetResource: 'rm -rf /'
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.ruleMatched).toBe('RULE_DESTRUCTIVE_COMMAND_BLOCKED');
    });
  });

  describe('Container Reconciliation & Port Recycling Service', () => {
    it('reserves and reclaims host ports from the dynamic pool', () => {
      const p1 = containerReconciliationService.reservePort(3005);
      expect(p1).toBe(3005);

      const allocated = containerReconciliationService.getAllocatedPorts();
      expect(allocated).toContain(3005);

      const reclaimed = containerReconciliationService.reclaimStalePort(3005);
      expect(reclaimed).toBe(true);
      expect(containerReconciliationService.getAllocatedPorts()).not.toContain(3005);
    });
  });
});
