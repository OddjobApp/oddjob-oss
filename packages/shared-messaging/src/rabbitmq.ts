/**
 * RabbitMQ Client
 * 
 * Provides connection management and queue operations
 * for all microservices.
 */

import * as amqp from "amqplib";
import type { Connection, Channel, ConsumeMessage } from "amqplib";
import { QUEUES, EXCHANGES, type MessageEnvelope } from "./types.js";

// Configuration
const RABBIT_URL = process.env.RABBIT_URL || "amqp://guest:guest@localhost:5672";

// Singleton instances
let connection: Connection | null = null;
let channel: Channel | null = null;

/**
 * Connect to RabbitMQ
 */
export async function connect(): Promise<void> {
    if (connection) return;

    try {
        connection = await (amqp as any).connect(RABBIT_URL);
        channel = await (connection as any).createChannel();

        // Set up exchanges
        await channel!.assertExchange(EXCHANGES.JOBS, 'topic', { durable: true });
        await channel!.assertExchange(EXCHANGES.PIPELINES, 'topic', { durable: true });
        await channel!.assertExchange(EXCHANGES.EVENTS, 'fanout', { durable: true });

        // Set up dead letter queue
        await channel!.assertQueue(QUEUES.DEAD_LETTER, { durable: true });

        // Handle connection close
        connection!.on("close", () => {
            console.warn("[shared-messaging] RabbitMQ connection closed");
            connection = null;
            channel = null;
        });

        connection!.on("error", (err) => {
            console.error("[shared-messaging] RabbitMQ error:", err);
        });

        console.log("[shared-messaging] Connected to RabbitMQ");
    } catch (error) {
        console.error("[shared-messaging] Failed to connect to RabbitMQ:", error);
        throw error;
    }
}

/**
 * Get the channel (auto-connect if needed)
 */
export async function getChannel(): Promise<Channel> {
    if (!channel) {
        await connect();
    }
    if (!channel) {
        throw new Error("Failed to establish RabbitMQ channel");
    }
    return channel;
}

/**
 * Publish a message to a queue
 */
export async function publish<T>(
    queue: string,
    payload: T,
    options?: {
        type?: string;
        correlationId?: string;
        priority?: number;
        expiration?: number;
    }
): Promise<void> {
    const ch = await getChannel();

    const envelope: MessageEnvelope<T> = {
        messageId: crypto.randomUUID(),
        type: options?.type || "unknown",
        timestamp: Date.now(),
        source: process.env.SERVICE_NAME || "unknown",
        correlationId: options?.correlationId,
        payload,
    };

    await ch.assertQueue(queue, {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: QUEUES.DEAD_LETTER,
    });

    ch.sendToQueue(queue, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        priority: options?.priority,
        expiration: options?.expiration?.toString(),
        correlationId: options?.correlationId,
        messageId: envelope.messageId,
        timestamp: envelope.timestamp,
    });
}

/**
 * Publish a message to an exchange
 */
export async function publishToExchange<T>(
    exchange: string,
    routingKey: string,
    payload: T,
    options?: {
        type?: string;
        correlationId?: string;
    }
): Promise<void> {
    const ch = await getChannel();

    const envelope: MessageEnvelope<T> = {
        messageId: crypto.randomUUID(),
        type: options?.type || routingKey,
        timestamp: Date.now(),
        source: process.env.SERVICE_NAME || "unknown",
        correlationId: options?.correlationId,
        payload,
    };

    ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        correlationId: options?.correlationId,
        messageId: envelope.messageId,
        timestamp: envelope.timestamp,
    });
}

/**
 * Subscribe to a queue
 */
export async function subscribe<T>(
    queue: string,
    handler: (message: MessageEnvelope<T>, ack: () => void, nack: (requeue?: boolean) => void) => Promise<void>,
    options?: {
        prefetch?: number;
    }
): Promise<void> {
    const ch = await getChannel();

    await ch.assertQueue(queue, {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: QUEUES.DEAD_LETTER,
    });

    if (options?.prefetch) {
        await ch.prefetch(options.prefetch);
    }

    await ch.consume(queue, async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
            const envelope: MessageEnvelope<T> = JSON.parse(msg.content.toString());

            await handler(
                envelope,
                () => ch.ack(msg),
                (requeue = false) => ch.nack(msg, false, requeue)
            );
        } catch (error) {
            console.error(`[shared-messaging] Error processing message from ${queue}:`, error);
            ch.nack(msg, false, false); // Send to dead letter
        }
    });

    console.log(`[shared-messaging] Subscribed to queue: ${queue}`);
}

/**
 * Subscribe to an exchange
 */
export async function subscribeToExchange<T>(
    exchange: string,
    routingPattern: string,
    handler: (message: MessageEnvelope<T>) => Promise<void>,
    options?: {
        queueName?: string;
        prefetch?: number;
    }
): Promise<void> {
    const ch = await getChannel();

    // Create an exclusive queue for this subscription
    const queueName = options?.queueName || `${exchange}.${routingPattern}.${process.pid}`;
    await ch.assertQueue(queueName, {
        durable: !options?.queueName, // Exclusive queues are not durable
        exclusive: !options?.queueName,
    });

    await ch.bindQueue(queueName, exchange, routingPattern);

    if (options?.prefetch) {
        await ch.prefetch(options.prefetch);
    }

    await ch.consume(queueName, async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
            const envelope: MessageEnvelope<T> = JSON.parse(msg.content.toString());
            await handler(envelope);
            ch.ack(msg);
        } catch (error) {
            console.error(`[shared-messaging] Error processing message from ${exchange}:`, error);
            ch.nack(msg, false, false);
        }
    });

    console.log(`[shared-messaging] Subscribed to exchange: ${exchange} with pattern: ${routingPattern}`);
}

/**
 * Close the connection
 */
export async function close(): Promise<void> {
    if (channel) {
        await channel.close();
        channel = null;
    }
    if (connection) {
        await (connection as any).close();
        connection = null;
    }
    console.log("[shared-messaging] RabbitMQ connection closed");
}

