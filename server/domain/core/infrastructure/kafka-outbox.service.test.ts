/**
 * Outbox relay ordering.
 *
 * The relay is the only thing standing between "the database committed" and
 * "the topic saw it", so the order it publishes in IS the order consumers
 * observe. Two rules matter and neither is enforced by Kafka itself: the batch
 * has to be drained in sequence order, and a key whose event failed must not
 * have its later events published ahead of the retry.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const publish = vi.fn();

vi.mock('./kafka-event-bus.service.js', () => ({
  kafkaEventBus: {
    isEnabled: () => true,
    publish: (...args: unknown[]) => publish(...args),
  },
}));

const candidates: Array<{ id: string; partitionKey: string; payload: unknown; attempts: number; sequence: number }> = [];

/**
 * Minimal stand-in for the Drizzle query builder: every method chains, and the
 * object is thenable so `await` resolves it. Only claim-updates call
 * `.returning()`, and the relay uses the result for truthiness alone.
 */
function chain(resolve: () => unknown): any {
  const link: any = {
    from: () => link,
    where: () => link,
    set: () => link,
    orderBy: () => link,
    limit: () => link,
    returning: () => Promise.resolve([{ claimed: true }]),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return link;
}

vi.mock('@server/database_service.js', () => ({
  db: {
    select: () => chain(() => candidates),
    update: () => chain(() => undefined),
    insert: () => chain(() => undefined),
  },
}));

const { KafkaOutboxRelay } = await import('./kafka-outbox.service.js');

let nextSequence = 1;
function candidate(id: string, partitionKey: string) {
  return { id, partitionKey, payload: { eventId: id }, attempts: 0, sequence: nextSequence++ };
}

beforeEach(() => {
  publish.mockReset();
  publish.mockResolvedValue(true);
  candidates.length = 0;
  nextSequence = 1;
});

describe('KafkaOutboxRelay.flush', () => {
  it('publishes the batch in the order the query returned it', async () => {
    candidates.push(candidate('a', '1'), candidate('b', '1'), candidate('c', '2'));

    const published = await new KafkaOutboxRelay().flush();

    expect(published).toBe(3);
    expect(publish.mock.calls.map(call => (call[0] as any).eventId)).toEqual(['a', 'b', 'c']);
  });

  it('stops publishing a key once one of its events fails, so the retry cannot be overtaken', async () => {
    candidates.push(candidate('a', '1'), candidate('b', '1'), candidate('c', '1'));
    publish.mockRejectedValueOnce(new Error('broker down'));

    const published = await new KafkaOutboxRelay().flush();

    // 'a' failed and is rescheduled; 'b' and 'c' must wait for the next flush
    // rather than reaching the topic ahead of it.
    expect(published).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][0] as any).eventId).toBe('a');
  });

  it('keeps draining unrelated keys when one key fails', async () => {
    candidates.push(candidate('a', '1'), candidate('b', '2'), candidate('c', '1'), candidate('d', '2'));
    publish.mockRejectedValueOnce(new Error('broker down'));

    const published = await new KafkaOutboxRelay().flush();

    // Key 1 is blocked after 'a'; key 2 is untouched by that failure.
    expect(published).toBe(2);
    expect(publish.mock.calls.map(call => (call[0] as any).eventId)).toEqual(['a', 'b', 'd']);
  });

  it('stamps each event with its outbox sequence on the way out', async () => {
    // Producers cannot set this: they build the envelope before their outbox row
    // exists, so the relay is the only place the total order is known.
    candidates.push(candidate('a', '1'), candidate('b', '1'));

    await new KafkaOutboxRelay().flush();

    expect(publish.mock.calls.map(call => (call[0] as any).sequenceNumber)).toEqual([1, 2]);
  });

  it('preserves the rest of the stored envelope when stamping', async () => {
    candidates.push({ id: 'a', partitionKey: '1', attempts: 0, sequence: 7, payload: { eventId: 'a', type: 'observation', correlationId: 'c1' } });

    await new KafkaOutboxRelay().flush();

    expect(publish.mock.calls[0][0]).toEqual({ eventId: 'a', type: 'observation', correlationId: 'c1', sequenceNumber: 7 });
  });

  it('does not run concurrently with itself', async () => {
    candidates.push(candidate('a', '1'));
    const relay = new KafkaOutboxRelay();

    let release: () => void = () => {};
    // Resolves once the first flush has actually reached publish — releasing
    // before that point would hit the placeholder above and hang the test.
    const reachedPublish = new Promise<void>(signal => {
      publish.mockImplementationOnce(() => new Promise<boolean>(resolve => {
        release = () => resolve(true);
        signal();
      }));
    });

    const first = relay.flush();
    const second = await relay.flush();
    expect(second).toBe(0);

    await reachedPublish;
    release();
    expect(await first).toBe(1);
  });
});
