/** @vitest-environment node */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn(async () => ({ id: "s1" }));
const getScreenshot = vi.fn(async () => "data:image/png;base64,AAAA");
vi.mock("./trycua-service.js", () => ({ trycuaService: { getSession, getScreenshot } }));

const { TrycuaStreamGateway, issueStreamTicket } = await import("./trycua-stream.gateway.js");

let server: http.Server;
let host: string;

beforeAll(async () => {
    TrycuaStreamGateway.initialize();
    server = http.createServer();
    server.on("upgrade", (req, socket, head) => TrycuaStreamGateway.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    getSession.mockClear();
    getScreenshot.mockClear();
});

function open(query: string, origin = `http://${host}`) {
    return new WebSocket(`ws://${host}/api/trycua/stream${query}`, { headers: { origin } });
}

function rejection(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)));
}

function nextMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => ws.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
}

describe("TrycuaStreamGateway", () => {
    it("refuses sockets without a ticket or from another site", async () => {
        expect(await rejection(open(""))).toBe(401);
        expect(await rejection(open("?ticket=forged"))).toBe(401);
        const ticket = issueStreamTicket({ sessionId: "s1", organizationId: 7, userId: "u7" });
        expect(await rejection(open(`?ticket=${ticket}`, "https://evil.example"))).toBe(403);
    });

    it("streams the ticket's session as the ticket's org and user, whatever JOIN claims", async () => {
        const ws = open(`?ticket=${issueStreamTicket({ sessionId: "s1", organizationId: 7, userId: "u7" })}`);
        await new Promise((resolve) => ws.on("open", resolve));
        const frame = nextMessage(ws);
        // The old protocol: the client names the org and user. A different org must not work.
        ws.send(JSON.stringify({ type: "JOIN", payload: { sessionId: "s1", organizationId: 999, userId: "attacker" } }));

        expect((await frame).type).toBe("FRAME");
        expect(getSession).toHaveBeenCalledWith("s1", 7);
        expect(getScreenshot).toHaveBeenCalledWith("s1", 7, "u7");
        ws.close();
    });

    it("will not stream a different session than the ticket's", async () => {
        const ws = open(`?ticket=${issueStreamTicket({ sessionId: "s1", organizationId: 7, userId: "u7" })}`);
        await new Promise((resolve) => ws.on("open", resolve));
        const reply = nextMessage(ws);
        ws.send(JSON.stringify({ type: "JOIN", payload: { sessionId: "someone-elses" } }));
        expect(await reply).toMatchObject({ type: "ERROR" });
        expect(getScreenshot).not.toHaveBeenCalled();
        ws.close();
    });
});
