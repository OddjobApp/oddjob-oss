import { describe, it, expect, afterEach } from "vitest";
import { buildFcmMessage, isGoneFcmError, fcmService } from "./fcm.service.js";

describe("buildFcmMessage", () => {
    it("carries the notification, the URL as string data, and the approvals channel", () => {
        expect(buildFcmMessage("tok", { title: "Approval needed", body: "Deploy", url: "/workspace/chat/k", tag: "approval-7" })).toEqual({
            message: {
                token: "tok",
                notification: { title: "Approval needed", body: "Deploy" },
                data: { url: "/workspace/chat/k", tag: "approval-7" },
                android: { priority: "HIGH", notification: { channel_id: "approvals", tag: "approval-7" } },
            },
        });
    });

    it("omits the tag when there is none", () => {
        const { message } = buildFcmMessage("tok", { title: "t", body: "b", url: "/" });
        expect(message.data).toEqual({ url: "/" });
        expect(message.android.notification).toEqual({ channel_id: "approvals" });
    });
});

describe("isGoneFcmError", () => {
    // Shapes from the FCM HTTP v1 error reference.
    it("drops tokens FCM says are unregistered", () => {
        expect(isGoneFcmError(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })).toBe(true);
        expect(isGoneFcmError(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } })).toBe(true);
    });

    it("keeps tokens on errors that are ours or transient", () => {
        expect(isGoneFcmError(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } })).toBe(false);
        expect(isGoneFcmError(503, { error: { status: "UNAVAILABLE" } })).toBe(false);
        expect(isGoneFcmError(401, { error: { status: "UNAUTHENTICATED" } })).toBe(false);
    });
});

describe("fcmService credentials", () => {
    const vars = ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_FILE", "FIREBASE_PROJECT_ID"] as const;
    const saved = Object.fromEntries(vars.map((v) => [v, process.env[v]]));
    afterEach(() => {
        for (const v of vars) {
            if (saved[v] === undefined) delete process.env[v];
            else process.env[v] = saved[v];
        }
        fcmService.resetForTests();
    });

    it("is off with no key and no project", () => {
        for (const v of vars) delete process.env[v];
        fcmService.resetForTests();
        expect(fcmService.isConfigured()).toBe(false);
    });

    it("runs keyless on the project id, for organizations that forbid service-account keys", () => {
        for (const v of vars) delete process.env[v];
        process.env.FIREBASE_PROJECT_ID = "oddjob-f75c7";
        fcmService.resetForTests();
        expect(fcmService.isConfigured()).toBe(true);
    });

    it("rejects a key missing its private key rather than sending unauthenticated", () => {
        for (const v of vars) delete process.env[v];
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "p", client_email: "a@p.iam.gserviceaccount.com" });
        fcmService.resetForTests();
        expect(fcmService.isConfigured()).toBe(false);
    });
});
