/**
 * Pages Router proxy for the DevOps Workbench.
 * Forwards /api/oddjob/* → /api/platform/app/* on the Oddjob platform
 * with the ODDJOB_APP_TOKEN Bearer credential.
 *
 * Supports GET, POST, PUT, DELETE.
 * SSE (text/event-stream) responses are piped directly to the client.
 */
import type { NextApiRequest, NextApiResponse } from "next";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN    = process.env.ODDJOB_APP_TOKEN ?? "";

export const config = {
  api: {
    // Disable body parsing so we can forward raw bodies and SSE streams intact.
    bodyParser: false,
    // Disable response size limit to allow long-running SSE connections.
    responseLimit: false,
    externalResolver: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path: pathSegments, ...queryParams } = req.query;

  // Build upstream path: /api/platform/app/<segments>
  const segments = Array.isArray(pathSegments) ? pathSegments : [pathSegments ?? ""];
  const platformPath = `/api/platform/app/${segments.join("/")}`;

  // Re-attach remaining query string params (everything except 'path').
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) {
      value.forEach((v) => qs.append(key, v));
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const upstreamUrl = `${PLATFORM_URL}${platformPath}${qs.toString() ? `?${qs.toString()}` : ""}`;

  // Read request body for mutating methods.
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readBody(req);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APP_TOKEN}`,
      },
      body: body && body.length > 0 ? body : undefined,
    });
  } catch (err) {
    res.status(502).json({ error: "Upstream platform unreachable", detail: String(err) });
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // ── SSE: pipe the stream directly ──────────────────────────────────────────
  if (contentType.includes("text/event-stream")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
          // Flush buffered data to the client immediately.
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      } catch {
        // Client disconnected — swallow the error.
      } finally {
        res.end();
      }
    };

    req.on("close", () => reader.cancel().catch(() => {}));
    await pump();
    return;
  }

  // ── JSON / text ────────────────────────────────────────────────────────────
  res.status(upstream.status);

  if (contentType.includes("application/json")) {
    try {
      const data = await upstream.json();
      res.json(data);
    } catch {
      res.status(502).json({ error: "Invalid JSON from upstream" });
    }
    return;
  }

  // Fall back to plain text.
  const text = await upstream.text();
  res.setHeader("Content-Type", contentType || "text/plain");
  res.send(text);
}

// ── Helper: buffer the incoming request body ──────────────────────────────────
function readBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
