import { WebSocketServer, WebSocket } from "ws";
import { createLogger } from "@server/utils/logger.js";
import { trycuaService } from "./trycua-service.js";
import { createTicketStore, isSameOriginUpgrade, rejectUpgrade } from "./ws-tickets.js";

const logger = createLogger("TrycuaStreamGateway");

interface StreamTicket {
    sessionId: string;
    organizationId: number;
    userId: string;
}

/**
 * Issued by POST /api/integrations/trycua/sessions/:id/stream-ticket after its login and
 * session-access checks. The socket used to trust the organizationId and userId in the
 * client's JOIN message, so anyone could stream any org's desktop given a session id.
 */
const streamTickets = createTicketStore<StreamTicket>(60_000);

export function issueStreamTicket(ticket: StreamTicket): string {
    return streamTickets.issue(ticket);
}

/** How often (ms) the gateway polls the VM for a new screenshot. */
const POLL_INTERVAL_MS = 1000;

interface StreamClient {
    ws: WebSocket;
    sessionId: string;
    organizationId: number;
    userId: string;
    timer: ReturnType<typeof setInterval> | null;
}

export class TrycuaStreamGateway {
    private static wss: WebSocketServer;
    private static clients = new Map<WebSocket, StreamClient>();

    static initialize(): void {
        this.wss = new WebSocketServer({ noServer: true });
        logger.info("Trycua Stream Gateway initialized.");

        this.wss.on("connection", (ws: WebSocket, _request: unknown, grant: StreamTicket) => {
            logger.info("Trycua stream client connected.", { organizationId: grant.organizationId, sessionId: grant.sessionId });

            ws.on("message", async (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());

                    if (msg.type === "JOIN") {
                        // Who and what come from the ticket; the message's own ids are ignored.
                        const { sessionId, organizationId, userId } = grant;
                        if (msg.payload?.sessionId && msg.payload.sessionId !== sessionId) {
                            ws.send(JSON.stringify({ type: "ERROR", payload: "This stream ticket is for another session" }));
                            return;
                        }

                        // Stop existing poll if re-joining
                        const existing = this.clients.get(ws);
                        if (existing?.timer) clearInterval(existing.timer);

                        // Verify session exists and is active
                        try {
                            await trycuaService.getSession(sessionId, organizationId);
                        } catch (err: any) {
                            ws.send(JSON.stringify({ type: "ERROR", payload: err.message }));
                            return;
                        }

                        const client: StreamClient = { ws, sessionId, organizationId, userId, timer: null };
                        this.clients.set(ws, client);

                        // Send initial frame immediately
                        await this.sendFrame(client);

                        // Start polling
                        client.timer = setInterval(() => this.sendFrame(client), POLL_INTERVAL_MS);
                        ws.send(JSON.stringify({ type: "JOINED", payload: { sessionId } }));
                        logger.info(`Client streaming session ${sessionId}`);
                    }

                    if (msg.type === "LEAVE") {
                        this.cleanup(ws);
                    }
                } catch (err) {
                    logger.warn("Failed to parse Trycua stream message", { err });
                }
            });

            ws.on("close", () => {
                this.cleanup(ws);
                logger.info("Trycua stream client disconnected.");
            });

            ws.on("error", (err) => {
                logger.warn("Trycua stream WebSocket error", { err });
                this.cleanup(ws);
            });
        });
    }

    static handleUpgrade(request: any, socket: any, head: any): void {
        if (!isSameOriginUpgrade(request)) {
            rejectUpgrade(socket, 403, "Forbidden");
            return;
        }
        const grant = streamTickets.consume(new URL(request.url || "/", "http://x").searchParams.get("ticket"));
        if (!grant) {
            rejectUpgrade(socket, 401, "Unauthorized");
            return;
        }
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit("connection", ws, request, grant);
        });
    }

    private static async sendFrame(client: StreamClient): Promise<void> {
        if (client.ws.readyState !== WebSocket.OPEN) {
            this.cleanup(client.ws);
            return;
        }

        try {
            const frame = await trycuaService.getScreenshot(
                client.sessionId,
                client.organizationId,
                client.userId,
            );
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: "FRAME",
                    payload: { sessionId: client.sessionId, dataUrl: frame, ts: Date.now() },
                }));
            }
        } catch (err: any) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: "SESSION_ENDED",
                    payload: { sessionId: client.sessionId, reason: err.message },
                }));
            }
            this.cleanup(client.ws);
        }
    }

    private static cleanup(ws: WebSocket): void {
        const client = this.clients.get(ws);
        if (client?.timer) clearInterval(client.timer);
        this.clients.delete(ws);
    }
}
