import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
    default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

// A minimal drizzle stand-in: records what each statement was, and answers
// selects with `subs` and inserts with `claim`.
let subs: any[] = [];
let claim: any[] = [];
const ops: string[] = [];
vi.mock("@server/database_service.js", () => {
    const chain = (kind: string, result: () => unknown) => {
        const self: any = {};
        for (const m of ["from", "where", "set", "values", "onConflictDoNothing", "onConflictDoUpdate", "limit"]) {
            self[m] = () => self;
        }
        self.returning = () => Promise.resolve(result());
        self.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
        ops.push(kind);
        return self;
    };
    return {
        db: {
            select: () => chain("select", () => subs),
            insert: () => chain("insert", () => claim),
            update: () => chain("update", () => []),
            delete: () => chain("delete", () => []),
        },
    };
});

import { pushService, safePushUrl } from "./push.service.js";
import { fcmService } from "./fcm.service.js";

const sub = (id: number, failureCount = 0) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a", failureCount });
const payload = { title: "Approval needed", body: "Deploy", url: "/assistant/workbench" };

describe("pushService", () => {
    beforeEach(() => {
        process.env.VAPID_PUBLIC_KEY = "pub";
        process.env.VAPID_PRIVATE_KEY = "priv";
        pushService.resetForTests();
        sendNotification.mockReset();
        subs = [];
        claim = [];
        ops.length = 0;
    });
    afterEach(() => {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        pushService.resetForTests();
    });

    it("is a no-op without VAPID keys", async () => {
        delete process.env.VAPID_PRIVATE_KEY;
        pushService.resetForTests();
        subs = [sub(1)];
        expect(pushService.isConfigured()).toBe(false);
        expect(await pushService.sendToUser("u1", payload)).toBe(0);
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it("sends to every subscribed browser and counts deliveries", async () => {
        subs = [sub(1), sub(2)];
        sendNotification.mockResolvedValue({});
        expect(await pushService.sendToUser("u1", payload)).toBe(2);
        const body = JSON.parse(sendNotification.mock.calls[0][1]);
        expect(body).toMatchObject({ title: "Approval needed", body: "Deploy", url: "/assistant/workbench" });
    });

    it("deletes a subscription the push service reports gone", async () => {
        subs = [sub(1)];
        sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
        expect(await pushService.sendToUser("u1", payload)).toBe(0);
        expect(ops).toContain("delete");
    });

    it("keeps a subscription after a transient failure", async () => {
        subs = [sub(1)];
        sendNotification.mockRejectedValue(Object.assign(new Error("busy"), { statusCode: 503 }));
        await pushService.sendToUser("u1", payload);
        expect(ops).not.toContain("delete");
        expect(ops).toContain("update");
    });

    it("sendOnce sends only when it wins the delivery claim", async () => {
        subs = [sub(1)];
        sendNotification.mockResolvedValue({});

        claim = [];
        expect(await pushService.sendOnce("approval", 7, "u1", payload)).toBe(false);
        expect(sendNotification).not.toHaveBeenCalled();

        claim = [{ userId: "u1" }];
        expect(await pushService.sendOnce("approval", 7, "u1", payload)).toBe(true);
        expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("never lets a notification open another origin", () => {
        expect(safePushUrl("/missions/4")).toBe("/missions/4");
        expect(safePushUrl("https://evil.example")).toBe("/");
        expect(safePushUrl("//evil.example")).toBe("/");
        expect(safePushUrl(undefined)).toBe("/");
    });
});

describe("pushService.canReach", () => {
    const saved = { project: process.env.FIREBASE_PROJECT_ID, file: process.env.FIREBASE_SERVICE_ACCOUNT_FILE, json: process.env.FIREBASE_SERVICE_ACCOUNT_JSON };
    beforeEach(() => {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        delete process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
        delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        pushService.resetForTests();
        fcmService.resetForTests();
        subs = [];
    });
    afterEach(() => {
        for (const [k, v] of [["FIREBASE_PROJECT_ID", saved.project], ["FIREBASE_SERVICE_ACCOUNT_FILE", saved.file], ["FIREBASE_SERVICE_ACCOUNT_JSON", saved.json]] as const) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        fcmService.resetForTests();
    });

    it("reaches someone who has only the phone app, with browser push off", async () => {
        process.env.FIREBASE_PROJECT_ID = "oddjob-test";
        subs = [{ id: 7 }]; // the registered phone
        expect(pushService.isConfigured()).toBe(false);
        expect(pushService.anyConfigured()).toBe(true);
        expect(await pushService.canReach("u1")).toBe(true);
    });

    it("reaches no one when neither channel is configured", async () => {
        delete process.env.FIREBASE_PROJECT_ID;
        subs = [{ id: 7 }];
        expect(pushService.anyConfigured()).toBe(false);
        expect(await pushService.canReach("u1")).toBe(false);
    });
});
