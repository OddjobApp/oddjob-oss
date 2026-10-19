import { randomBytes } from "node:crypto";
import type http from "node:http";

/**
 * Short-lived, single-use tickets for WebSocket upgrades. The upgrade hook runs outside
 * Express, so it has no session; an authenticated HTTP route issues a ticket bound to what
 * the caller may see, and the upgrade presents it once.
 */
export function createTicketStore<T>(ttlMs: number) {
    const tickets = new Map<string, T & { expiresAt: number }>();
    return {
        issue(data: T, now = Date.now()): string {
            for (const [key, value] of tickets) if (value.expiresAt <= now) tickets.delete(key);
            const ticket = randomBytes(32).toString("base64url");
            tickets.set(ticket, { ...data, expiresAt: now + ttlMs });
            return ticket;
        },
        /** Gone after the first attempt, valid or not. */
        consume(ticket: string | null | undefined, now = Date.now()): T | undefined {
            if (!ticket) return undefined;
            const found = tickets.get(ticket);
            tickets.delete(ticket);
            if (!found || found.expiresAt <= now) return undefined;
            const { expiresAt: _expiresAt, ...data } = found;
            return data as unknown as T;
        },
        clear() {
            tickets.clear();
        },
    };
}

/**
 * Browsers always send Origin on a WebSocket handshake and page scripts cannot forge it,
 * so requiring it to match the Host blocks cross-site WebSocket hijacking.
 */
export function isSameOriginUpgrade(request: http.IncomingMessage): boolean {
    const origin = request.headers.origin;
    const host = request.headers["x-forwarded-host"] ?? request.headers.host;
    if (typeof origin !== "string" || typeof host !== "string") return false;
    try {
        return new URL(origin).host === host.split(",")[0].trim();
    } catch {
        return false;
    }
}

export function rejectUpgrade(socket: { write(chunk: string): unknown; destroy(): unknown }, status: number, text: string) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
}
