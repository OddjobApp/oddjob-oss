/**
 * Server-side proxy: forwards all /api/oddjob/* requests to the Oddjob
 * platform API, injecting the ODDJOB_APP_TOKEN from the container environment.
 *
 * This keeps the token out of the browser entirely.
 */
import type { NextApiRequest, NextApiResponse } from "next";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN    = process.env.ODDJOB_APP_TOKEN ?? "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathSegments = (req.query.path as string[]) ?? [];
  const platformPath = `/api/platform/app/${pathSegments.join("/")}`;
  const qs = new URLSearchParams(
    Object.entries(req.query)
      .filter(([k]) => k !== "path")
      .flatMap(([k, v]) => (Array.isArray(v) ? v.map((val) => [k, val]) : [[k, v as string]]))
  ).toString();
  const url = `${PLATFORM_URL}${platformPath}${qs ? `?${qs}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${APP_TOKEN}`,
  };

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  res.status(upstream.status);

  if (contentType.includes("application/json")) {
    const data = await upstream.json();
    res.json(data);
  } else {
    const text = await upstream.text();
    res.send(text);
  }
}
