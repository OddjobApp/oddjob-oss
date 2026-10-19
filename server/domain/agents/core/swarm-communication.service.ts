import { createLogger } from "@server/utils/logger.js";
import { queueService } from "@domain/core/infrastructure/queue/queue-service.js";
import { redis, redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { v4 as uuidv4 } from "uuid";
import { ScopedTopicIndexer } from "../../ai/core/scoped-topic-indexer.js";

const logger = createLogger("SwarmCommunicationService");
// The domain redisService provides dedicated publisher/subscriber clients already
const publisher = redisService.publisher;
const subscriber = redisService.subscriber;

export interface SwarmMessage {
    id: string;
    senderId: string;
    targetSwarmId: string;
    type: "broadcast" | "directed" | "heartbeat";
    payload: any;
    timestamp: Date;
}

/**
 * Prototype for decentralized agent swarm communication.
 * In Phase 7, this facilitates inter-agent coordination without central mission control bottlenecks.
 */
export class SwarmCommunicationService {
    /**
     * Broadcasts a message to all agents in a specific swarm.
     */
    async broadcast(swarmId: string, senderId: string, payload: any) {
        const message: SwarmMessage = {
            id: uuidv4(),
            senderId,
            targetSwarmId: swarmId,
            type: "broadcast",
            payload,
            timestamp: new Date()
        };

        logger.info(`Swarm ${swarmId}: Broadcast from ${senderId}`, { messageId: message.id });

        // Phase 7: Utilize Redis Pub/Sub for low-latency decentralized messaging
        try {
            const channel = `swarm:${swarmId}:broadcast`;
            await publisher.publish(channel, JSON.stringify(message));
        } catch (err) {
            logger.warn(`Redis publish failed for swarm ${swarmId}, falling back to system queue: ${err}`);
            await queueService.addJobWithTrace(queueService.systemQueue, "swarm-broadcast", {
                swarmId,
                message
            });
        }

        return message;
    }

    /**
     * Sends a direct message to a specific agent within a swarm.
     */
    async sendDirect(swarmId: string, senderId: string, targetAgentId: string, payload: any) {
        const message: SwarmMessage = {
            id: uuidv4(),
            senderId,
            targetSwarmId: swarmId,
            type: "directed",
            payload: { ...payload, targetAgentId },
            timestamp: new Date()
        };

        logger.info(`Swarm ${swarmId}: Direct message ${senderId} -> ${targetAgentId}`);

        try {
            const channel = `swarm:${swarmId}:agent:${targetAgentId}`;
            await publisher.publish(channel, JSON.stringify(message));
        } catch (err) {
            logger.warn(`Redis direct publish failed for agent ${targetAgentId}, falling back to system queue: ${err}`);
            await queueService.addJobWithTrace(queueService.systemQueue, "swarm-directed", {
                swarmId,
                targetAgentId,
                message
            });
        }

        return message;
    }

    /**
     * Sends a governed direct swarm message with Graph_A \cap Graph_B subgraph projection.
     */
    async sendGovernedSwarmMessage(
        swarmId: string,
        senderAgentId: string,
        targetAgentId: string,
        senderTopicKey: string,
        targetTopicKey: string,
        payload: any
    ) {
        const viewA = ScopedTopicIndexer.getAgentSubgraphView(senderAgentId, senderTopicKey);
        const viewB = ScopedTopicIndexer.getAgentSubgraphView(targetAgentId, targetTopicKey);
        const intersection = ScopedTopicIndexer.intersectAgentGraphs(viewA, viewB);

        const governedPayload = {
            ...payload,
            subgraphProjection: {
                sharedIntersectionNodes: intersection,
                senderTopicKey,
                targetTopicKey
            }
        };

        return this.sendDirect(swarmId, senderAgentId, targetAgentId, governedPayload);
    }

    /**
     * Joins a swarm by registering a presence heartbeat.
     */
    async heartbeat(swarmId: string, agentId: string) {
        logger.debug(`Swarm ${swarmId}: Heartbeat from ${agentId}`);

        try {
            const key = `swarm:${swarmId}:members`;
            await redis.sadd(key, agentId);
            await redis.expire(key, 60); // Presence expires after 60s
        } catch (err) {
            logger.error(`Failed to register heartbeat for agent ${agentId} in swarm ${swarmId}: ${err}`);
        }
    }

    /**
     * Retrieves all active members in a specific swarm.
     */
    async getMembers(swarmId: string): Promise<string[]> {
        try {
            return await redis.smembers(`swarm:${swarmId}:members`);
        } catch (err) {
            logger.error(`Failed to fetch members for swarm ${swarmId}: ${err}`);
            return [];
        }
    }

    private handlers: Map<string, Set<(message: SwarmMessage) => void>> = new Map();
    private isListenerInitialized = false;

    private initGlobalListener() {
        if (this.isListenerInitialized) return;
        
        subscriber.on("message", (channel: string, message: string) => {
            const channelHandlers = this.handlers.get(channel);
            if (channelHandlers && channelHandlers.size > 0) {
                try {
                    const parsed = JSON.parse(message) as SwarmMessage;
                    channelHandlers.forEach(handler => {
                        try {
                            handler(parsed);
                        } catch (e) {
                            logger.error(`Error in swarm message handler for channel ${channel}`, e);
                        }
                    });
                } catch (e) {
                    logger.error(`Failed to parse swarm message from channel ${channel}`, e);
                }
            }
        });

        this.isListenerInitialized = true;
        logger.info("Swarm decentralized listener initialized");
    }

    /**
     * Subscribes to swarm broadcast events.
     */
    async subscribe(swarmId: string, handler: (message: SwarmMessage) => void) {
        this.initGlobalListener();
        const channel = `swarm:${swarmId}:broadcast`;
        
        if (!this.handlers.has(channel)) {
            this.handlers.set(channel, new Set());
            await subscriber.subscribe(channel);
            logger.debug(`Subscribed to Redis channel: ${channel}`);
        }
        
        this.handlers.get(channel)!.add(handler);
    }

    /**
     * Unsubscribes from swarm broadcast events.
     */
    async unsubscribe(swarmId: string, handler: (message: SwarmMessage) => void) {
        const channel = `swarm:${swarmId}:broadcast`;
        const channelHandlers = this.handlers.get(channel);
        
        if (channelHandlers) {
            channelHandlers.delete(handler);
            if (channelHandlers.size === 0) {
                this.handlers.delete(channel);
                await subscriber.unsubscribe(channel);
                logger.debug(`Unsubscribed from Redis channel: ${channel}`);
            }
        }
    }
}

export const swarmCommunicationService = new SwarmCommunicationService();


