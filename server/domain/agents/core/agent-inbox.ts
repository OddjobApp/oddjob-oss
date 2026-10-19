import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentInbox");

interface AgentMessage {
    id: string;
    fromAgentId: string;
    toAgentId: string;
    type: 'task' | 'thought' | 'result' | 'direct';
    content: any;
    timestamp: number;
}

/**
 * AgentInbox (Hermes Protocol)
 * 
 * Manages inter-agent communication and task delegation across the pod ecosystem.
 */
class AgentInboxService {
    private inboxes: Map<string, AgentMessage[]> = new Map();
    private readonly MAX_MESSAGES_PER_INBOX = 50;

    constructor() {
        this.initializeSubscriptions();
    }

    private initializeSubscriptions() {
        logger.info("[Hermes] Initializing Agent Inbox Subscriptions...");

        // Listen for messages directed at agents
        eventStream.on(POD_EVENTS.AGENT.MESSAGE_SENT, (event) => {
            const message: AgentMessage = {
                id: event.eventId,
                fromAgentId: event.payload.fromAgentId,
                toAgentId: event.payload.toAgentId,
                type: event.payload.type || 'direct',
                content: event.payload.content,
                timestamp: event.timestamp
            };

            this.deliverMessage(message);
        });

        // Listen for task delegations
        eventStream.on(POD_EVENTS.AGENT.TASK_DELEGATED, (event) => {
            const message: AgentMessage = {
                id: event.eventId,
                fromAgentId: event.payload.fromAgentId,
                toAgentId: event.payload.toAgentId,
                type: 'task',
                content: event.payload.task,
                timestamp: event.timestamp
            };

            this.deliverMessage(message);
        });
    }

    private deliverMessage(message: AgentMessage) {
        if (!message.toAgentId) return;

        logger.info(`[Hermes] Delivering ${message.type} to Agent ${message.toAgentId} from ${message.fromAgentId}`);

        const inbox = this.inboxes.get(message.toAgentId) || [];
        inbox.unshift(message);
        
        // Cap the inbox size
        this.inboxes.set(message.toAgentId, inbox.slice(0, this.MAX_MESSAGES_PER_INBOX));

        // Notify specifically that this agent's inbox was updated
        eventStream.publish(POD_EVENTS.AGENT.INBOX_UPDATED, {
            agentId: message.toAgentId,
            messageId: message.id
        }, {
            subject: `agent:${message.toAgentId}`
        }, "agent_inbox");
    }

    /**
     * Retrieve messages for a specific agent.
     */
    getMessagesByAgentId(agentId: string): AgentMessage[] {
        return this.inboxes.get(agentId) || [];
    }

    /**
     * Sends a message to an agent.
     */
    async sendMessage(fromAgentId: string, toAgentId: string, content: any, type: AgentMessage['type'] = 'direct') {
        return eventStream.publish(POD_EVENTS.AGENT.MESSAGE_SENT, {
            fromAgentId,
            toAgentId,
            content,
            type
        }, {
            subject: `agent:${toAgentId}`
        }, "agent_inbox");
    }

    /**
     * Clear an agent's inbox.
     */
    clearInbox(agentId: string) {
        this.inboxes.delete(agentId);
    }
}

export const agentInbox = new AgentInboxService();
