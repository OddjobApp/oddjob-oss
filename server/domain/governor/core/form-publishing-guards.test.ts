/**
 * FormPublishingService argument guards.
 *
 * publish() did `fields.map(...)` with no check, so when request_human_input was
 * executed despite failing parameter validation (the tool worker adapter logged
 * "Attempting execution with original args" and ran anyway) `fields` arrived
 * undefined and this threw "Cannot read properties of undefined (reading 'map')"
 * ~700 times. publish() catches everything and returns null, so the only trace was
 * a log line reading: Failed to publish form "undefined".
 *
 * publish() still returns null on failure — that is its established contract and
 * callers depend on it. What changed is that the failure now says what was wrong
 * instead of surfacing a TypeError from deep inside the mapping step.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));

vi.mock("@server/database_service.js", () => ({
    db: { select: () => ({ from: () => ({ where: () => [] }) }), insert: () => ({ values: () => ({ returning: () => [{ id: 1 }] }) }) },
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: h.info, warn: vi.fn(), error: h.error, debug: vi.fn() }),
}));
// This mocked redis.service.js, a module that no longer exists, so the real client
// connected and its "Redis [main] error" logs failed the no-error assertion wherever
// Redis was not running.
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    getRedisClient: () => ({ set: vi.fn().mockResolvedValue("OK") }),
}));

import { formPublishingService } from "@domain/governor/core/form-publishing-service.js";

/** The Error the service caught, as passed to logger.error. */
const loggedError = () => h.error.mock.calls.at(-1)?.[1];

beforeEach(() => vi.clearAllMocks());

describe("FormPublishingService.publish argument guards", () => {
    it.each([
        ["undefined fields", undefined],
        ["null fields", null],
        ["an empty field list", []],
    ])("reports %s by name instead of a TypeError", async (_label, fields) => {
        const result = await formPublishingService.publish("My Form", fields as any);

        expect(result).toBeNull();
        const err = loggedError();
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TypeError);
        expect(err.message).toMatch(/no fields/i);
        // The original failure surfaced as a mapping error from inside publish().
        expect(err.message).not.toMatch(/reading 'map'/);
    });

    it.each([
        ["a missing name", undefined],
        ["an empty name", ""],
    ])("reports %s rather than publishing a form called \"undefined\"", async (_label, name) => {
        const result = await formPublishingService.publish(name as any, [{ name: "f", label: "F" }]);

        expect(result).toBeNull();
        expect(loggedError().message).toMatch(/without a name/i);
    });

    it("still publishes when name and fields are both present", async () => {
        const result = await formPublishingService.publish("Good Form", [{ name: "f", label: "F", type: "text" }]);

        expect(result).toBe(1);
        expect(h.error).not.toHaveBeenCalled();
    });
});
