/**
 * Server-side proxy: forwards all /api/oddjob/* requests to the Oddjob
 * platform API, injecting the ODDJOB_APP_TOKEN from the container environment.
 * Supports GET, POST, PUT, DELETE and SSE (text/event-stream) streaming.
 */
import type { NextApiRequest, NextApiResponse } from "next";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN    = process.env.ODDJOB_APP_TOKEN ?? "";

export const config = {
  api: {
    // Disable body parsing so we can forward the raw body for non-GET requests
    bodyParser: true,
    // Disable response limit for SSE streams
    responseLimit: false,
    externalResolver: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathSegments = (req.query.path as string[]) ?? [];
  const platformPath = `/api/platform/app/${pathSegments.join("/")}`;

  // Reconstruct query string, excluding the catch-all "path" param
  const qs = new URLSearchParams(
    Object.entries(req.query)
      .filter(([k]) => k !== "path")
      .flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((val) => [k, val]) : [[k, v as string]]
      )
  ).toString();

  const url = `${PLATFORM_URL}${platformPath}${qs ? `?${qs}` : ""}`;

  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${APP_TOKEN}`,
  };

  // Forward Accept header so SSE endpoints receive the correct hint
  if (req.headers["accept"]) {
    upstreamHeaders["Accept"] = req.headers["accept"] as string;
  }

  const upstream = await fetch(url, {
    method: req.method,
    headers: upstreamHeaders,
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? JSON.stringify(req.body)
        : undefined,
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  res.status(upstream.status);

  // ── SSE streaming ──────────────────────────────────────────────────────────
  if (contentType.includes("text/event-stream")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    // Clean up if the client disconnects
    req.socket.on("close", () => {
      try { reader.cancel(); } catch {}
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
        // Flush to push chunks to the client immediately
        if (typeof (res as any).flush === "function") (res as any).flush();
      }
    } catch {
      // Client disconnected mid-stream — not an error
    } finally {
      res.end();
    }
    return;
  }

  // ── JSON ───────────────────────────────────────────────────────────────────
  if (contentType.includes("application/json")) {
    const data = await upstream.json();
    return res.json(data);
  }

  // ── Plain text / other ─────────────────────────────────────────────────────
  const text = await upstream.text();
  res.send(text);
}
