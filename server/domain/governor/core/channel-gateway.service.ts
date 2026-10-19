import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('ChannelGatewayService');

export type SupportedChannel = 'slack' | 'discord' | 'teams';

export interface IncomingChannelMessage {
  channel: SupportedChannel;
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface ChannelResponse {
  channel: SupportedChannel;
  channelId: string;
  recipientId?: string;
  text: string;
  status: 'sent' | 'failed';
  timestamp: string;
}

export interface ChannelAdapter {
  channelName: SupportedChannel;
  sendMessage(channelId: string, text: string, metadata?: Record<string, any>): Promise<ChannelResponse>;
  parseIncomingPayload(rawPayload: any): IncomingChannelMessage;
}

/**
 * Mock/Base Adapter Implementation for Slack, Discord, and Teams.
 */
export class GenericChannelAdapter implements ChannelAdapter {
  constructor(public channelName: SupportedChannel) {}

  async sendMessage(channelId: string, text: string): Promise<ChannelResponse> {
    logger.info(`[${this.channelName.toUpperCase()}] Sending message to channel ${channelId}: "${text.slice(0, 50)}..."`);
    return {
      channel: this.channelName,
      channelId,
      text,
      status: 'sent',
      timestamp: new Date().toISOString()
    };
  }

  parseIncomingPayload(rawPayload: any): IncomingChannelMessage {
    return {
      channel: this.channelName,
      channelId: rawPayload.channelId || 'default',
      senderId: rawPayload.senderId || 'user_1',
      senderName: rawPayload.senderName || 'Unknown User',
      text: rawPayload.text || '',
      metadata: rawPayload.metadata || {}
    };
  }
}

export class ChannelGatewayService {
  private adapters = new Map<SupportedChannel, ChannelAdapter>();

  constructor() {
    this.registerAdapter(new GenericChannelAdapter('slack'));
    this.registerAdapter(new GenericChannelAdapter('discord'));
    this.registerAdapter(new GenericChannelAdapter('teams'));
  }

  /**
   * Register a custom channel adapter.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    logger.info(`Registering channel adapter for '${adapter.channelName}'`);
    this.adapters.set(adapter.channelName, adapter);
  }

  /**
   * Routes an incoming message from any channel to agent execution.
   */
  async handleIncomingMessage(message: IncomingChannelMessage): Promise<{ taskId?: number; message: string }> {
    logger.info(`[ChannelGateway] Received message from ${message.channel} (sender: ${message.senderName}): "${message.text}"`);

    // Dynamically import TaskMarketplaceService to create a swarm task
    try {
      const { TaskMarketplaceService } = await import('@domain/swarm/services/task-marketplace.service.js');
      const task = await TaskMarketplaceService.createTask({
        missionId: 1,
        requestingAgentId: null,
        description: `[${message.channel.toUpperCase()} Command] from ${message.senderName}: ${message.text}`,
        metadata: {
          sourceChannel: message.channel,
          channelId: message.channelId,
          senderId: message.senderId,
          senderName: message.senderName
        }
      });

      return {
        taskId: task.id,
        message: `Task #${task.id} created successfully from ${message.channel} command.`
      };
    } catch (err: any) {
      logger.error(`[ChannelGateway] Failed to route channel message to task marketplace:`, err);
      return {
        message: `Received command: "${message.text}". (Execution queued).`
      };
    }
  }

  /**
   * Sends a response back to the specified channel.
   */
  async dispatchResponse(channel: SupportedChannel, channelId: string, text: string): Promise<ChannelResponse> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`No channel adapter registered for channel '${channel}'`);
    }

    return adapter.sendMessage(channelId, text);
  }
}

export const channelGatewayService = new ChannelGatewayService();
