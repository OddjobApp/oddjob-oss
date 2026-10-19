import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = req.query.path;
  const path = Array.isArray(raw) ? raw.join("/") : raw || "";
  const query = req.url?.includes("?") ? `?${req.url.split("?")[1]}` : "";
  const baseUrl = process.env.ODDJOB_PLATFORM_URL || process.env.ODDJOB_API_URL || "http://localhost:5000";
  const token = process.env.ODDJOB_APP_TOKEN;

  if (!token) {
    res.status(503).json({ error: "Missing ODDJOB_APP_TOKEN. Restart this app from App Arsenal or App Builder." });
    return;
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/platform/app/${path}${query}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "Platform proxy error", detail: error.message });
  }
}
