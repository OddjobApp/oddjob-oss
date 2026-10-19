import compression from "compression";
import type { Request, Response } from "express";

/**
 * Which responses the compression middleware may encode.
 *
 * Never a Server-Sent Events stream. `text/event-stream` is compressible by the
 * default filter, and a gzip/brotli encoder holds small writes until it has a
 * block to emit or the response ends; an SSE stream never ends and its events
 * are a few hundred bytes. Every stream in the app (/api/events/stream,
 * /api/decisions/stream, crew rooms, forge logs) was encoded for any browser,
 * since browsers always send Accept-Encoding, and delivered no live event at
 * all. Tests and curl send no Accept-Encoding, which is why nothing caught it.
 */
export function shouldCompress(req: Request, res: Response): boolean {
    const contentType = String(res.getHeader("Content-Type") ?? "");
    if (contentType.includes("text/event-stream")) return false;
    if (String(req.headers.accept ?? "").includes("text/event-stream")) return false;
    if (contentType.includes("application/json")) return true;
    return compression.filter(req, res);
}
