import { kafkaEventBus } from './kafka-event-bus.service.js';
import { kafkaOutboxRelay } from './kafka-outbox.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('KafkaRuntime');

class KafkaRuntimeService {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized || !kafkaEventBus.isEnabled()) return;
    this.initialized = true;
    try {
      const health = await kafkaEventBus.health();
      if (!health.connected) throw new Error(health.lastError || 'Kafka unavailable');

      // Before anything publishes or subscribes. Auto-creation is disabled on
      // the producer, so a stream that does not exist is a hard failure rather
      // than a silently misconfigured topic — which makes this the step that
      // lets a rename roll out without a manual broker task.
      const { ALL_SPATIAL_TOPICS } = await import('@shared/contracts/spatial-events.js');
      await kafkaEventBus.ensureTopics(ALL_SPATIAL_TOPICS);

      kafkaOutboxRelay.start();
      const { spatialKafkaConsumers } = await import('@domain/signal-intelligence/core/spatial-kafka.service.js');
      await spatialKafkaConsumers.initialize();
      logger.info('Kafka runtime initialized');
    } catch (error) {
      this.initialized = false;
      logger.error('Kafka runtime initialization failed', error);
      if (process.env.KAFKA_REQUIRED === 'true') throw error;
    }
  }

  async shutdown(): Promise<void> {
    kafkaOutboxRelay.stop();
    await kafkaEventBus.disconnect();
    this.initialized = false;
  }
}

export const kafkaRuntimeService = new KafkaRuntimeService();
