/** @vitest-environment node */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopBrokerCommand } from "./desktop-broker-client.js";

const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    const socket = process.platform === "win32"
        ? `\\\\.\\pipe\\oddjob-desktop-test-${randomUUID()}`
        : join(tmpdir(), `oddjob-desktop-${randomUUID()}.sock`);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, resolve);
    });
    return socket;
}

describe("desktop broker transport", () => {
    it("sends desktop operations through the private socket", async () => {
        let received: unknown;
        const socket = await listen((request, response) => {
            expect(request.url).toBe("/docker");
            let body = "";
            request.on("data", (chunk) => { body += chunk; });
            request.on("end", () => {
                received = JSON.parse(body);
                response.end(JSON.stringify({ code: 0, stdout: "172.17.0.1:51000\n", stderr: "" }));
            });
        });
        const args = ["port", "oddjob-desktop-org-1", "6901/tcp"];
        expect(await desktopBrokerCommand(socket, args, 1000)).toBe("172.17.0.1:51000\n");
        expect(received).toEqual({ args });
    });

    it("preserves missing-container evidence for provisioning", async () => {
        const socket = await listen((_request, response) => {
            response.end(JSON.stringify({ code: 1, stdout: "", stderr: "Error: No such object: oddjob-desktop-org-1" }));
        });
        await expect(desktopBrokerCommand(socket, ["inspect"], 1000)).rejects.toMatchObject({ stderr: expect.stringContaining("No such object") });
    });

    it("rejects a denied host operation", async () => {
        const socket = await listen((_request, response) => {
            response.writeHead(400);
            response.end(JSON.stringify({ code: 1, stdout: "", stderr: "Docker operation denied" }));
        });
        await expect(desktopBrokerCommand(socket, ["build", "."], 1000)).rejects.toThrow("Docker operation denied");
    });
});
