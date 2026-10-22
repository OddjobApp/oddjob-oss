/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@server/database_service.js", () => ({ db: {} }));
import { enqueueKafkaEvent } from "./kafka-outbox.service.js";

/** Nothing drains the outbox while Kafka is off, so nothing is written to it. */
describe("Kafka outbox", () => {
    afterEach(() => vi.unstubAllEnvs());
    const event = { eventId: "e1", eventType: "spatial.signal.v1", organizationId: 7, subject: "s" } as any;
    const writer = () => {
        const values = vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) }));
        return { insert: vi.fn(() => ({ values })), values };
    };

    it("writes nothing while Kafka is disabled", async () => {
        vi.stubEnv("KAFKA_ENABLED", "");
        const w = writer();
        await enqueueKafkaEvent(w, event);
        expect(w.insert).not.toHaveBeenCalled();
    });

    it("writes the event for the relay while Kafka is enabled", async () => {
        vi.stubEnv("KAFKA_ENABLED", "true");
        const w = writer();
        await enqueueKafkaEvent(w, event);
        expect(w.values).toHaveBeenCalledWith(expect.objectContaining({ eventId: "e1", topic: "spatial.signal.v1", organizationId: 7, partitionKey: "s" }));
    });
});
