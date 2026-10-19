import { Kafka, logLevel, Partitioners, type Admin, type Consumer, type EachMessagePayload, type KafkaConfig, type Producer, type SASLOptions } from 'kafkajs';
import type { SpatialEventEnvelope } from '@shared/contracts/spatial-events.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('KafkaEventBus');

export type KafkaEnvelope = SpatialEventEnvelope<string, Record<string, unknown>>;
export interface KafkaMessageMetadata {
  topic: string;
  partition: number;
  offset: string;
}

export type KafkaEventHandler = (event: KafkaEnvelope, metadata: KafkaMessageMetadata) => Promise<void>;

/**
 * Called for a message whose bytes are not parseable JSON, so the caller can
 * preserve it before the offset is committed. Anything thrown here is
 * swallowed — see `subscribe` for why a poison message must never be retried.
 */
export type KafkaInvalidMessageHandler = (
  raw: Buffer,
  metadata: KafkaMessageMetadata,
  error: unknown,
) => Promise<void>;

export interface KafkaEventBusConfig {
  enabled: boolean;
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl: boolean;
  sasl?: SASLOptions;
}

export function readKafkaConfig(env: NodeJS.ProcessEnv = process.env): KafkaEventBusConfig {
  const mechanism = env.KAFKA_SASL_MECHANISM as 'plain' | 'scram-sha-256' | 'scram-sha-512' | undefined;
  const sasl = mechanism && env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD
    ? { mechanism, username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD } as SASLOptions
    : undefined;
  return {
    enabled: env.KAFKA_ENABLED === 'true',
    brokers: (env.KAFKA_BROKERS || 'localhost:9092').split(',').map(value => value.trim()).filter(Boolean),
    clientId: env.KAFKA_CLIENT_ID || 'oddjob-api',
    groupId: env.KAFKA_GROUP_ID || 'oddjob-spatial',
    ssl: env.KAFKA_SSL === 'true',
    sasl,
  };
}

export class KafkaEventBus {
  private readonly config: KafkaEventBusConfig;
  private readonly kafka: Kafka | null;
  private producer: Producer | null = null;
  private producerReady: Promise<Producer> | null = null;
  private consumers: Consumer[] = [];
  private admin: Admin | null = null;
  private connected = false;
  private lastError: string | null = null;

  constructor(config: KafkaEventBusConfig = readKafkaConfig()) {
    this.config = config;
    const kafkaConfig: KafkaConfig = {
      clientId: config.clientId,
      brokers: config.brokers,
      logLevel: logLevel.WARN,
      ssl: config.ssl,
      sasl: config.sasl,
    };
    this.kafka = config.enabled ? new Kafka(kafkaConfig) : null;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Connects the shared producer, at most once.
   *
   * The promise is memoized rather than the producer: two concurrent publishes
   * would otherwise both see a null producer, both construct one, and both
   * connect — leaving the loser overwritten and leaked, holding broker
   * connections nothing will ever disconnect.
   */
  private async getProducer(kafka: Kafka): Promise<Producer> {
    if (!this.producerReady) {
      this.producerReady = (async () => {
        const producer = kafka.producer({
          allowAutoTopicCreation: false,
          createPartitioner: Partitioners.DefaultPartitioner,
          idempotent: true,
          maxInFlightRequests: 5,
        });
        await producer.connect();
        this.producer = producer;
        this.connected = true;
        return producer;
      })().catch(error => {
        // A failed connect must not be cached, or every later publish reuses it.
        this.producerReady = null;
        throw error;
      });
    }
    return this.producerReady;
  }

  /**
   * Partition key defaults to `subject` — the entity the event is about — and
   * falls back to the tenant when an event has no subject.
   *
   * It was the tenant for everything, which put every event for an org on one
   * partition: coarse ordering, no parallelism within a tenant, and a hot
   * partition for a large one. Keying by entity gives per-entity ordering, which
   * is the guarantee that actually matters — an action's intent and its outcome
   * now share a stream AND a partition, so they cannot be observed out of order.
   */
  async publish(event: KafkaEnvelope, partitionKey = event.subject ?? String(event.organizationId)): Promise<boolean> {
    if (!this.kafka) return false;
    try {
      const producer = await this.getProducer(this.kafka);

      await producer.send({
        topic: event.eventType,
        acks: -1,
        messages: [{
          key: partitionKey,
          value: JSON.stringify(event),
          headers: {
            'event-id': event.eventId,
            'schema-version': String(event.schemaVersion),
            'correlation-id': event.correlationId,
            ...(event.causationId ? { 'causation-id': event.causationId } : {}),
          },
        }],
      });
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async subscribe(
    topics: string[],
    handler: KafkaEventHandler,
    groupId = this.config.groupId,
    onInvalidMessage?: KafkaInvalidMessageHandler,
  ): Promise<void> {
    if (!this.kafka) return;
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    this.connected = true;
    await consumer.subscribe({ topics, fromBeginning: false });
    const joined = new Promise<void>((resolve, reject) => {
      const timeoutMs = Number(process.env.KAFKA_CONSUMER_JOIN_TIMEOUT_MS || 45_000);
      const timeout = setTimeout(() => reject(new Error(`Kafka consumer ${groupId} group join timed out after ${timeoutMs}ms`)), timeoutMs);
      consumer.on(consumer.events.GROUP_JOIN, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    void consumer.run({ eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;
      const metadata = { topic, partition, offset: message.offset };

      // A message that is not parseable JSON must NOT be rethrown. Throwing out
      // of eachMessage leaves the offset uncommitted, so kafkajs redelivers the
      // same bytes forever and the partition stops making progress — every
      // later event behind it stalls. The retry/dead-letter machinery in
      // IdempotentKafkaConsumer cannot help here either, because it lives
      // downstream of this parse. So: hand the raw bytes to the caller to
      // preserve, then commit past it.
      let event: KafkaEnvelope;
      try {
        event = JSON.parse(message.value.toString()) as KafkaEnvelope;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        logger.error(
          `Unparseable message on ${topic}[${partition}]@${message.offset}, skipping: ${this.lastError}`,
          { preview: message.value.toString('utf8').slice(0, 500) },
        );
        if (onInvalidMessage) {
          await onInvalidMessage(message.value, metadata, error).catch(dlqError =>
            logger.error(
              `Failed to preserve unparseable message on ${topic}[${partition}]@${message.offset}`,
              dlqError,
            ),
          );
        }
        return;
      }

      await handler(event, metadata);
    } }).catch(error => {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error(`Kafka consumer ${groupId} stopped`, error);
    });
    this.consumers.push(consumer);
    await joined;
  }

  async health(): Promise<{ enabled: boolean; connected: boolean; brokers: string[]; lastError: string | null }> {
    if (!this.kafka) return { enabled: false, connected: false, brokers: this.config.brokers, lastError: null };
    try {
      if (!this.admin) {
        this.admin = this.kafka.admin();
        await this.admin.connect();
      }
      await this.admin.fetchTopicMetadata();
      this.connected = true;
      this.lastError = null;
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    return { enabled: true, connected: this.connected, brokers: this.config.brokers, lastError: this.lastError };
  }

  /**
   * Creates any of `topics` the broker does not have.
   *
   * The producer runs with `allowAutoTopicCreation: false`, so publishing to a
   * topic that does not exist fails rather than quietly creating a
   * single-partition one with broker defaults. That is the right setting, but it
   * means a rename is not just a constant change — the new streams have to be
   * created before anything can publish to them.
   *
   * Idempotent: existing topics are left exactly as they are, including their
   * partition counts.
   */
  async ensureTopics(topics: readonly string[], partitions = 3): Promise<string[]> {
    if (!this.kafka) return [];
    if (!this.admin) {
      this.admin = this.kafka.admin();
      await this.admin.connect();
    }

    const existing = new Set(await this.admin.listTopics());
    const missing = topics.filter(topic => !existing.has(topic));
    if (missing.length === 0) return [];

    await this.admin.createTopics({
      waitForLeaders: true,
      topics: missing.map(topic => ({ topic, numPartitions: partitions })),
    });
    logger.info(`Created Kafka topics: ${missing.join(', ')}`);
    return missing;
  }

  async consumerLag(groupId: string, topics: string[]): Promise<{ total: number; topics: Record<string, number> }> {
    if (!this.kafka) return { total: 0, topics: {} };
    if (!this.admin) {
      this.admin = this.kafka.admin();
      await this.admin.connect();
    }
    const committed = await this.admin.fetchOffsets({ groupId, topics, resolveOffsets: false });
    const byTopic: Record<string, number> = {};
    for (const topic of topics) {
      const [ends, group] = await Promise.all([
        this.admin.fetchTopicOffsets(topic),
        Promise.resolve(committed.find(item => item.topic === topic)),
      ]);
      byTopic[topic] = ends.reduce((sum, end) => {
        const offset = group?.partitions.find(item => item.partition === end.partition)?.offset;
        const committedOffset = offset && offset !== '-1' ? BigInt(offset) : BigInt(end.low);
        const lag = BigInt(end.high) - committedOffset;
        return sum + Number(lag > 0n ? lag : 0n);
      }, 0);
    }
    return { total: Object.values(byTopic).reduce((sum, value) => sum + value, 0), topics: byTopic };
  }

  async disconnect(): Promise<void> {
    // allSettled, not all: one consumer failing to disconnect used to reject
    // before the producer and admin were ever reached, leaking both.
    const results = await Promise.allSettled([
      ...this.consumers.map(consumer => consumer.disconnect()),
      ...(this.producer ? [this.producer.disconnect()] : []),
      ...(this.admin ? [this.admin.disconnect()] : []),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') logger.warn('Kafka client failed to disconnect cleanly', result.reason);
    }

    this.consumers = [];
    this.producer = null;
    this.producerReady = null;
    this.admin = null;
    this.connected = false;
    logger.info('Kafka clients disconnected');
  }
}

export const kafkaEventBus = new KafkaEventBus();
