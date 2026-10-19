import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('PolicyEnforcementService');

export interface AccessContext {
  agentId: number;
  agentRole: string;
  actionType: 'tool_execution' | 'file_access' | 'network_egress' | 'model_routing';
  targetResource: string;
  dataClassification?: 'public' | 'internal' | 'sensitive' | 'restricted';
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason: string;
  ruleMatched: string;
  requiresHILApproval: boolean;
}

export class PolicyEnforcementService {
  private restrictedPaths = ['/etc/passwd', '/etc/shadow', '.env', '.env.production', '/root'];
  private blockedCommands = ['rm -rf /', 'drop table', 'shutdown', 'format c:'];

  /**
   * Evaluates an agent action against security and governance policies.
   */
  evaluateAccess(context: AccessContext): PolicyEvaluationResult {
    logger.info(`Evaluating policy for agent #${context.agentId} (${context.agentRole}) -> ${context.actionType}:${context.targetResource}`);

    // Rule 1: Restricted file path access check
    if (context.actionType === 'file_access') {
      const isRestricted = this.restrictedPaths.some(p => context.targetResource.toLowerCase().includes(p));
      if (isRestricted) {
        logger.warn(`Policy Denied: File path '${context.targetResource}' is restricted.`);
        return {
          allowed: false,
          reason: `Access to restricted file path '${context.targetResource}' is denied.`,
          ruleMatched: 'RULE_RESTRICTED_FILE_PATH',
          requiresHILApproval: true
        };
      }
    }

    // Rule 2: Dangerous tool / command execution check
    if (context.actionType === 'tool_execution') {
      const isBlocked = this.blockedCommands.some(cmd => context.targetResource.toLowerCase().includes(cmd));
      if (isBlocked) {
        logger.warn(`Policy Denied: Command '${context.targetResource}' matches blocked pattern.`);
        return {
          allowed: false,
          reason: `Execution of destructive command '${context.targetResource}' is blocked by policy.`,
          ruleMatched: 'RULE_DESTRUCTIVE_COMMAND_BLOCKED',
          requiresHILApproval: true
        };
      }
    }

    // Rule 3: Data classification & model routing check
    if (context.dataClassification === 'restricted' && context.actionType === 'model_routing') {
      if (context.targetResource.includes('public_cloud')) {
        return {
          allowed: false,
          reason: 'Restricted data cannot be routed to public cloud models. Local models required.',
          ruleMatched: 'RULE_DATA_RESIDENCY_PRIVACY',
          requiresHILApproval: false
        };
      }
    }

    // Default Allow
    return {
      allowed: true,
      reason: 'Action permitted by role capabilities.',
      ruleMatched: 'RULE_DEFAULT_ALLOW',
      requiresHILApproval: false
    };
  }
}

export const policyEnforcementService = new PolicyEnforcementService();
