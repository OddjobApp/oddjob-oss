/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable drizzle stand-in: each terminal call (.limit/.returning/await)
// resolves the next queued result for that operation family.
const { state, mockDb, mockGetTwilioConfig, mockTwilioRequest } = vi.hoisted(() => {
    const state = {
        selectQueue: [] as any[][],
        insertQueue: [] as any[][],
        updateQueue: [] as any[][],
        deleteQueue: [] as any[][],
        insertValues: [] as any[],
        updateSets: [] as any[],
    };

    const db = {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => {
                    const result = () => state.selectQueue.shift() ?? [];
                    return {
                        limit: vi.fn(async () => result()),
                        // listIdentities awaits the where() result directly
                        then: (onFulfilled?: any, onRejected?: any) =>
                            Promise.resolve(result()).then(onFulfilled, onRejected),
                    };
                }),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn((v: any) => {
                state.insertValues.push(v);
                return { returning: vi.fn(async () => state.insertQueue.shift() ?? [{ id: 1 }]) };
            }),
        })),
        update: vi.fn(() => ({
            set: vi.fn((v: any) => {
                state.updateSets.push(v);
                return {
                    where: vi.fn(() => ({
                        returning: vi.fn(async () => state.updateQueue.shift() ?? [{ id: 1 }]),
                    })),
                };
            }),
        })),
        delete: vi.fn(() => ({
            where: vi.fn(() => ({
                returning: vi.fn(async () => state.deleteQueue.shift() ?? []),
            })),
        })),
    };

    return {
        state,
        mockDb: db,
        mockGetTwilioConfig: vi.fn(
            async (_orgId?: number | null): Promise<{ accountSid: string; authToken: string; fromNumber: string } | null> => ({
                accountSid: "AC_test",
                authToken: "token_test",
                fromNumber: "+15005550006",
            }),
        ),
        mockTwilioRequest: vi.fn(
            async (_config: any, _path?: string, _body?: Record<string, string>) => ({ sid: "SM_test" }),
        ),
    };
});

vi.mock("@server/database_service.js", () => ({ db: mockDb }));
vi.mock("@domain/tools/v1/capabilities/twilio-helpers.js", () => ({
    getTwilioConfig: mockGetTwilioConfig,
    twilioRequest: mockTwilioRequest,
}));

const {
    omnichannelService,
    normalizeChannelIdentifier,
    generateVerificationCode,
} = await import("./omnichannel.service.js");

function resetState() {
    state.selectQueue.length = 0;
    state.insertQueue.length = 0;
    state.updateQueue.length = 0;
    state.deleteQueue.length = 0;
    state.insertValues.length = 0;
    state.updateSets.length = 0;
}

const baseRow = {
    id: 7,
    organizationId: 3,
    userId: "user-1",
    channelType: "sms" as const,
    channelIdentifier: "+14155552671",
    isVerified: false,
    verificationCode: "123456",
    verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    defaultProjectId: null,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe("normalizeChannelIdentifier", () => {
    it("prefixes a bare digits number with + for sms", () => {
        expect(normalizeChannelIdentifier("sms", "14155552671")).toBe("+14155552671");
    });

    it("keeps an already-E.164 number", () => {
        expect(normalizeChannelIdentifier("sms", "+14155552671")).toBe("+14155552671");
    });

    it("rejects non-E.164 input for sms/whatsapp", () => {
        expect(normalizeChannelIdentifier("sms", "not-a-number")).toBeNull();
        expect(normalizeChannelIdentifier("sms", "+0155")).toBeNull();
        expect(normalizeChannelIdentifier("whatsapp", "123")).toBeNull();
        expect(normalizeChannelIdentifier("sms", "")).toBeNull();
    });

    it("strips the whatsapp: scheme prefix on whatsapp identifiers", () => {
        expect(normalizeChannelIdentifier("whatsapp", "whatsapp:+14155552671")).toBe("+14155552671");
    });

    it("stores telegram identifiers verbatim (chat ids, possibly negative)", () => {
        expect(normalizeChannelIdentifier("telegram", "-1001234567890")).toBe("-1001234567890");
    });
});

describe("generateVerificationCode", () => {
    it("produces 6-digit codes", () => {
        for (let i = 0; i < 100; i++) {
            expect(generateVerificationCode()).toMatch(/^\d{6}$/);
        }
    });
});

describe("omnichannelService.startPairing", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("inserts a pending identity and delivers the stored code", async () => {
        state.selectQueue.push([]); // no existing row
        state.insertQueue.push([{ id: 42 }]);

        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "14155552671",
        });

        expect(result).toEqual({ ok: true, id: 42, delivered: true });
        const inserted = state.insertValues[0];
        expect(inserted.channelIdentifier).toBe("+14155552671");
        expect(inserted.isVerified).toBe(false);
        expect(inserted.verificationCode).toMatch(/^\d{6}$/);
        expect(inserted.verificationExpiresAt.getTime()).toBeGreaterThan(Date.now());

        // The code sent over the wire is the same one persisted — the API
        // result intentionally carries only the row id.
        const sentBody = mockTwilioRequest.mock.calls[0][2]!.Body as string;
        expect(sentBody).toContain(inserted.verificationCode);
    });

    it("re-pairing the same user's number updates the existing row", async () => {
        state.selectQueue.push([{ ...baseRow }]);
        state.updateQueue.push([{ id: 7 }]);

        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "+14155552671",
        });

        expect(result).toEqual({ ok: true, id: 7, delivered: true });
        expect(state.insertValues).toHaveLength(0);
        expect(state.updateSets[0].isVerified).toBe(false);
        expect(state.updateSets[0].verificationCode).toMatch(/^\d{6}$/);
    });

    it("rejects an identifier already claimed by another user in the org", async () => {
        state.selectQueue.push([{ ...baseRow, userId: "user-2" }]);

        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "+14155552671",
        });

        expect(result).toEqual({ ok: false, reason: "identifier_in_use" });
        expect(state.insertValues).toHaveLength(0);
        expect(state.updateSets).toHaveLength(0);
        expect(mockTwilioRequest).not.toHaveBeenCalled();
    });

    it("rejects a number already verified in another organization, without texting it", async () => {
        // Inbound SMS has no org; a number verified twice would be routed to
        // whichever tenant the database listed first.
        state.selectQueue.push([]); // nothing in this org
        state.selectQueue.push([{ id: 99 }]); // verified elsewhere

        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "+14155552671",
        });

        expect(result).toEqual({ ok: false, reason: "identifier_in_use" });
        expect(state.insertValues).toHaveLength(0);
        expect(mockTwilioRequest).not.toHaveBeenCalled();
    });

    it("rejects malformed identifiers before touching the DB", async () => {
        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "hello",
        });

        expect(result).toEqual({ ok: false, reason: "invalid_identifier" });
        expect(state.insertValues).toHaveLength(0);
    });

    it("reports delivered=false when Twilio is not configured", async () => {
        mockGetTwilioConfig.mockResolvedValueOnce(null);
        state.selectQueue.push([]);
        state.insertQueue.push([{ id: 43 }]);

        const result = await omnichannelService.startPairing({
            organizationId: 3,
            userId: "user-1",
            channelType: "sms",
            channelIdentifier: "+14155552671",
        });

        expect(result).toEqual({ ok: true, id: 43, delivered: false });
    });
});

describe("omnichannelService.verifyPairing", () => {
    beforeEach(() => {
        resetState();
    });

    it("verifies a correct, unexpired code and clears the challenge", async () => {
        state.selectQueue.push([{ ...baseRow }]);

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "123456",
        });

        expect(result).toEqual({ ok: true });
        // The first write claims an attempt; the second records the verification.
        expect(state.updateSets).toHaveLength(2);
        expect(state.updateSets[1]).toMatchObject({
            isVerified: true,
            verificationCode: null,
            verificationExpiresAt: null,
            settings: { verifyAttempts: 0 },
        });
    });

    it("rejects a wrong code", async () => {
        state.selectQueue.push([{ ...baseRow }]);

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "999999",
        });

        expect(result).toEqual({ ok: false, reason: "wrong_code" });
        // Only the attempt claim was written; nothing was verified.
        expect(state.updateSets).toHaveLength(1);
        expect(state.updateSets[0]).not.toHaveProperty("isVerified");
    });

    it("stops checking codes once the attempts are spent, even a correct one", async () => {
        state.selectQueue.push([{ ...baseRow }]);
        state.updateQueue.push([]); // the atomic claim found no attempts left

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "123456",
        });

        expect(result).toEqual({ ok: false, reason: "too_many_attempts" });
        expect(state.updateSets).toHaveLength(1);
    });

    it("refuses to verify a number another identity verified meanwhile", async () => {
        state.selectQueue.push([{ ...baseRow }]);
        state.selectQueue.push([{ id: 99 }]); // verified elsewhere

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "123456",
        });

        expect(result).toEqual({ ok: false, reason: "identifier_in_use" });
        expect(state.updateSets.some((set) => set.isVerified === true)).toBe(false);
    });

    it("rejects an expired code", async () => {
        state.selectQueue.push([{
            ...baseRow,
            verificationExpiresAt: new Date(Date.now() - 1000),
        }]);

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "123456",
        });

        expect(result).toEqual({ ok: false, reason: "expired" });
    });

    it("is idempotent for an already-verified identity", async () => {
        state.selectQueue.push([{ ...baseRow, isVerified: true, verificationCode: null }]);

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "anything",
        });

        expect(result).toEqual({ ok: true });
        expect(state.updateSets).toHaveLength(0);
    });

    it("reports not_found for a row owned by another user", async () => {
        state.selectQueue.push([{ ...baseRow, userId: "user-2" }]);

        const result = await omnichannelService.verifyPairing({
            organizationId: 3,
            userId: "user-1",
            identityId: 7,
            code: "123456",
        });

        expect(result).toEqual({ ok: false, reason: "not_found" });
    });
});

describe("omnichannelService.resolveVerifiedIdentity", () => {
    beforeEach(resetState);

    it("returns the verified row for a known sender", async () => {
        state.selectQueue.push([{ ...baseRow, isVerified: true }]);
        const row = await omnichannelService.resolveVerifiedIdentity("sms", "14155552671");
        expect(row?.id).toBe(7);
    });

    it("refuses to route a number verified for more than one identity", async () => {
        // Rows from before the one-owner rule: picking either would hand one
        // tenant's sender to another.
        state.selectQueue.push([{ ...baseRow, isVerified: true }, { ...baseRow, id: 8, organizationId: 4, isVerified: true }]);
        expect(await omnichannelService.resolveVerifiedIdentity("sms", "+14155552671")).toBeNull();
    });

    it("returns null for unknown or unverified senders", async () => {
        state.selectQueue.push([]);
        expect(await omnichannelService.resolveVerifiedIdentity("sms", "+14155552671")).toBeNull();
        // Malformed input never reaches the DB
        expect(await omnichannelService.resolveVerifiedIdentity("sms", "nope")).toBeNull();
    });
});

describe("omnichannelService.sendChannelMessage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("sends sms via Twilio messages API and returns true", async () => {
        const ok = await omnichannelService.sendChannelMessage(
            { channelType: "sms", channelIdentifier: "+14155552671", organizationId: 3 },
            "hello",
        );
        expect(ok).toBe(true);
        expect(mockTwilioRequest).toHaveBeenCalledWith(
            expect.objectContaining({ accountSid: "AC_test" }),
            "/Messages.json",
            { To: "+14155552671", From: "+15005550006", Body: "hello" },
        );
        expect(mockGetTwilioConfig).toHaveBeenCalledWith(3);
    });

    it("returns false instead of throwing when Twilio is unconfigured", async () => {
        mockGetTwilioConfig.mockResolvedValueOnce(null);
        const ok = await omnichannelService.sendChannelMessage(
            { channelType: "sms", channelIdentifier: "+14155552671" },
            "hello",
        );
        expect(ok).toBe(false);
    });

    it("returns false instead of throwing when Twilio API errors", async () => {
        mockTwilioRequest.mockRejectedValueOnce(new Error("Twilio API error 400"));
        const ok = await omnichannelService.sendChannelMessage(
            { channelType: "sms", channelIdentifier: "+14155552671", organizationId: 3 },
            "hello",
        );
        expect(ok).toBe(false);
    });
});

describe("omnichannelService.listIdentities / removeIdentity", () => {
    beforeEach(resetState);

    it("strips verificationCode from listed rows", async () => {
        state.selectQueue.push([{ ...baseRow, verificationCode: "654321" }]);
        const rows = await omnichannelService.listIdentities(3, "user-1");
        expect(rows).toHaveLength(1);
        expect(rows[0]).not.toHaveProperty("verificationCode");
        expect(rows[0].channelIdentifier).toBe("+14155552671");
    });

    it("reports whether a row was actually removed", async () => {
        state.deleteQueue.push([{ id: 7 }]);
        expect(await omnichannelService.removeIdentity(3, "user-1", 7)).toBe(true);

        state.deleteQueue.push([]);
        expect(await omnichannelService.removeIdentity(3, "user-1", 99)).toBe(false);
    });
});
