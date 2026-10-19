import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('IntentClassificationService');

export type PrimaryIntent =
  | 'it_helpdesk_issue'
  | 'hr_inquiry'
  | 'system_outage_alert'
  | 'sdlc_task_command'
  | 'general_faq';

export interface ClassifiedIntent {
  intent: PrimaryIntent;
  confidence: number;
  extractedEntities: Record<string, any>;
  suggestedAction: string;
}

export class IntentClassificationService {
  /**
   * Classifies incoming text messages from multi-channel inputs into actionable enterprise intents.
   */
  classifyMessage(text: string, context?: Record<string, any>): ClassifiedIntent {
    logger.info(`Classifying message intent: "${text.slice(0, 50)}..."`);
    const lower = text.toLowerCase();

    let intent: PrimaryIntent = 'sdlc_task_command';
    let confidence = 0.92;
    const extractedEntities: Record<string, any> = {};

    if (lower.includes('password') || lower.includes('vpn') || lower.includes('wifi') || lower.includes('laptop')) {
      intent = 'it_helpdesk_issue';
      extractedEntities.category = 'it_hardware_access';
    } else if (lower.includes('pto') || lower.includes('payroll') || lower.includes('benefits') || lower.includes('vacation')) {
      intent = 'hr_inquiry';
      extractedEntities.category = 'hr_benefits';
    } else if (lower.includes('outage') || lower.includes('down') || lower.includes('500 error') || lower.includes('incident')) {
      intent = 'system_outage_alert';
      extractedEntities.severity = 'critical';
    } else if (lower.includes('what is') || lower.includes('how do i') || lower.includes('policy')) {
      intent = 'general_faq';
    }

    const suggestedAction = intent === 'it_helpdesk_issue'
      ? 'Spawn IT Support Swarm'
      : intent === 'system_outage_alert'
      ? 'Trigger Incident Response Swarm & What-If Simulation'
      : 'Route to SDLC Task Marketplace';

    return {
      intent,
      confidence,
      extractedEntities,
      suggestedAction
    };
  }
}

export const intentClassificationService = new IntentClassificationService();
