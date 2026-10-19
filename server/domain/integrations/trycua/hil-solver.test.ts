/** @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const listIdentities = vi.hoisted(() => vi.fn());
const sendChannelMessage = vi.hoisted(() => vi.fn());
vi.mock("../core/omnichannel.service.js", () => ({
    omnichannelService: { listIdentities, sendChannelMessage },
}));

import { mintSolverToken, verifySolverToken, sendSolverLink, SOLVER_LINK_TTL_MS } from "./hil-solver.js";

const grant = { taskId: "task-1", userId: "u1", organizationId: 291 };
const task = { id: "task-1", userId: "u1", organizationId: 291, task: "Book the meeting room" };

describe("hil solver token", () => {
    beforeEach(() => {
        vi.stubEnv("SESSION_SECRET", "test-secret");
        vi.stubEnv("APP_URL", "https://app.example.com");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("round-trips a signed grant", () => {
        const token = mintSolverToken(grant)!;
        const solved = verifySolverToken(token);
        expect(solved).toMatchObject({ taskId: "task-1", userId: "u1", organizationId: 291 });
        expect(solved!.expiresAt).toBeGreaterThan(Date.now());
        expect(solved!.expiresAt).toBeLessThanOrEqual(Date.now() + SOLVER_LINK_TTL_MS);
    });

    it("rejects a tampered payload and a wrong secret", () => {
        const token = mintSolverToken(grant)!;
        const [payload, sig] = token.split(".");
        const forged = `${Buffer.from(JSON.stringify({ ...grant, taskId: "task-2", expiresAt: Date.now() + 1000 })).toString("base64url")}.${sig}`;
        expect(verifySolverToken(forged)).toBeNull();
        vi.stubEnv("SESSION_SECRET", "other-secret");
        vi.stubEnv("INTERNAL_API_SECRET", "");
        expect(verifySolverToken(token)).toBeNull();
    });

    it("rejects expired and malformed tokens", () => {
        const expired = mintSolverToken(grant, Date.now() - SOLVER_LINK_TTL_MS - 1000)!;
        expect(verifySolverToken(expired)).toBeNull();
        expect(verifySolverToken("not-a-token")).toBeNull();
        expect(verifySolverToken("abc.")).toBeNull();
    });
});

describe("sendSolverLink", () => {
    beforeEach(() => {
        vi.stubEnv("SESSION_SECRET", "test-secret");
        vi.stubEnv("APP_URL", "https://app.example.com");
        listIdentities.mockReset();
        sendChannelMessage.mockReset();
    });
    afterEach(() => vi.unstubAllEnvs());

    it("texts each verified SMS identity a signed link", async () => {
        listIdentities.mockResolvedValue([
            { channelType: "sms", channelIdentifier: "+15551234567", isVerified: true },
            { channelType: "sms", channelIdentifier: "+15559999999", isVerified: false },
            { channelType: "telegram", channelIdentifier: "tg-1", isVerified: true },
        ]);
        await sendSolverLink(task);
        expect(sendChannelMessage).toHaveBeenCalledTimes(1);
        const [target, text] = sendChannelMessage.mock.calls[0];
        expect(target).toMatchObject({ channelType: "sms", channelIdentifier: "+15551234567", organizationId: 291 });
        expect(text).toContain("/hil/solve/");
        expect(text).toContain("Book the meeting room");
    });

    it("does nothing without a verified sms identity", async () => {
        listIdentities.mockResolvedValue([{ channelType: "sms", channelIdentifier: "+1555", isVerified: false }]);
        await sendSolverLink(task);
        expect(sendChannelMessage).not.toHaveBeenCalled();
    });

    it("skips silently when there is no public URL", async () => {
        vi.stubEnv("APP_URL", "");
        vi.stubEnv("PUBLIC_URL", "");
        await sendSolverLink(task);
        expect(listIdentities).not.toHaveBeenCalled();
        expect(sendChannelMessage).not.toHaveBeenCalled();
    });

    it("never throws on a lookup failure", async () => {
        listIdentities.mockRejectedValue(new Error("db down"));
        await expect(sendSolverLink(task)).resolves.toBeUndefined();
    });
});
