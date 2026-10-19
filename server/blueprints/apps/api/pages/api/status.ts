import type { NextApiRequest, NextApiResponse } from "next";
import https from "node:https";
import http from "node:http";

// Configure your endpoints here — the AI forge will customize these from mission context
const ENDPOINTS = [
  { id: "health", name: "Health Check", url: "http://localhost:3000/api/health", method: "GET" },
  { id: "auth", name: "Auth Service", url: "https://httpbin.org/status/200", method: "GET" },
  { id: "data", name: "Data API", url: "https://httpbin.org/delay/1", method: "GET" },
  { id: "webhook", name: "Webhook Receiver", url: "https://httpbin.org/status/503", method: "GET" },
];

async function probe(url: string, method: string): Promise<{ status: "up" | "down" | "degraded"; latency: number }> {
  return new Promise(resolve => {
    const start = Date.now();
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method, timeout: 5000 }, res => {
      const latency = Date.now() - start;
      const code = res.statusCode || 0;
      res.resume();
      if (code >= 200 && code < 300) resolve({ status: latency > 2000 ? "degraded" : "up", latency });
      else resolve({ status: "down", latency });
    });
    req.on("error", () => resolve({ status: "down", latency: Date.now() - start }));
    req.on("timeout", () => { req.destroy(); resolve({ status: "down", latency: 5000 }); });
    req.end();
  });
}

const cache: Record<string, { status: string; latency: number | null; lastChecked: string; uptime: number }> = {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const checkId = req.query.check as string | undefined;
  const toCheck = checkId ? ENDPOINTS.filter(e => e.id === checkId) : ENDPOINTS;

  await Promise.all(toCheck.map(async ep => {
    try {
      const result = await probe(ep.url, ep.method);
      const prev = cache[ep.id];
      const prevUptime = prev?.uptime ?? 100;
      cache[ep.id] = {
        status: result.status,
        latency: result.latency,
        lastChecked: new Date().toLocaleTimeString(),
        uptime: result.status === "up" ? Math.min(100, prevUptime) : Math.max(0, prevUptime - 1),
      };
    } catch {
      cache[ep.id] = { status: "unknown", latency: null, lastChecked: new Date().toLocaleTimeString(), uptime: cache[ep.id]?.uptime ?? 0 };
    }
  }));

  const endpoints = ENDPOINTS.map(ep => ({
    id: ep.id,
    name: ep.name,
    url: ep.url,
    method: ep.method,
    ...(cache[ep.id] || { status: "unknown", latency: null, lastChecked: "never", uptime: 100 }),
  }));

  res.status(200).json({ endpoints });
}
