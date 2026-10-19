import { describe, expect, it, vi } from 'vitest';

/**
 * Captures the `eachMessage` callback the bus hands to kafkajs, so the poison
 * message path can be driven directly without a broker.
 */
const consumerRun = vi.fn();
const consumerStub = {
  connect: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  run: (args: any) => { consumerRun(args); return Promise.resolve(); },
  events: { GROUP_JOIN: 'consumer.group_join' },
  on: (_event: string, handler: () => void) => { handler(); return () => {}; },
};

vi.mock('kafkajs', () => ({
  Kafka: class {
    consumer() { return consumerStub; }
    producer() { return { connect: vi.fn(), send: vi.fn(), disconnect: vi.fn() }; }
    admin() { return { connect: vi.fn(), fetchTopicMetadata: vi.fn(), disconnect: vi.fn() }; }
  },
  logLevel: { WARN: 1 },
  Partitioners: { DefaultPartitioner: () => () => 0 },
}));

const { KafkaEventBus, readKafkaConfig } = await import('./kafka-event-bus.service.js');

const enabledConfig = {
  enabled: true,
  brokers: ['localhost:9092'],
  clientId: 'test',
  groupId: 'test-group',
  ssl: false,
  sasl: undefined,
};

async function deliver(bus: any, value: Buffer | null, onInvalid?: any) {
  const handler = vi.fn().mockResolvedValue(undefined);
  await bus.subscribe(['topic.v1'], handler, 'test-group', onInvalid);
  const { eachMessage } = consumerRun.mock.calls.at(-1)![0];
  await eachMessage({ topic: 'topic.v1', partition: 0, message: { value, offset: '42' } });
  return handler;
}

describe('KafkaEventBus configuration', () => {
  it('is disabled by default so local development keeps working without Kafka', () => {
    const config = readKafkaConfig({});
    expect(config.enabled).toBe(false);
    expect(config.ssl).toBe(false);
    expect(new KafkaEventBus(config).isEnabled()).toBe(false);
  });

  it('parses a broker list and consumer identity', () => {
    expect(readKafkaConfig({
      KAFKA_ENABLED: 'true',
      KAFKA_BROKERS: 'kafka-1:9092, kafka-2:9092',
      KAFKA_CLIENT_ID: 'spatial-api',
      KAFKA_GROUP_ID: 'spatial-assessors',
    })).toEqual({
      enabled: true,
      brokers: ['kafka-1:9092', 'kafka-2:9092'],
      clientId: 'spatial-api',
      groupId: 'spatial-assessors',
      ssl: false,
      sasl: undefined,
    });
  });
});

describe('KafkaEventBus poison messages', () => {
  it('does not rethrow an unparseable message, so the offset commits and the partition keeps moving', async () => {
    const bus = new KafkaEventBus(enabledConfig);

    // The assertion that matters: this resolves. If it rejected, kafkajs would
    // never commit the offset and would redeliver the same bytes forever,
    // stalling every later event on the partition behind it.
    const handler = await deliver(bus, Buffer.from('{"truncated":'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('hands the raw bytes to the invalid-message handler before skipping', async () => {
    const bus = new KafkaEventBus(enabledConfig);
    const onInvalid = vi.fn().mockResolvedValue(undefined);

    await deliver(bus, Buffer.from('not json at all'), onInvalid);

    expect(onInvalid).toHaveBeenCalledTimes(1);
    const [raw, metadata] = onInvalid.mock.calls[0];
    expect(raw.toString()).toBe('not json at all');
    expect(metadata).toEqual({ topic: 'topic.v1', partition: 0, offset: '42' });
  });

  it('survives an invalid-message handler that itself fails', async () => {
    const bus = new KafkaEventBus(enabledConfig);
    const onInvalid = vi.fn().mockRejectedValue(new Error('dead-letter topic unavailable'));

    // Still must not reject: a failing dead-letter write is not a reason to
    // jam the partition on a message we already cannot parse.
    await expect(deliver(bus, Buffer.from('}'), onInvalid)).resolves.toBeDefined();
  });

  it('passes a well-formed message through to the handler', async () => {
    const bus = new KafkaEventBus(enabledConfig);
    const event = { eventId: 'e1', eventType: 'topic.v1', organizationId: 7 };

    const handler = await deliver(bus, Buffer.from(JSON.stringify(event)));

    expect(handler).toHaveBeenCalledWith(event, { topic: 'topic.v1', partition: 0, offset: '42' });
  });
});
