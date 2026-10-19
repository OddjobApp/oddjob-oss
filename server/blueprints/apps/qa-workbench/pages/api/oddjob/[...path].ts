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

  const upstream = await fetch(url, {
    method: req.method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${APP_TOKEN}` },
    body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  res.status(upstream.status);
  if (contentType.includes("application/json")) { res.json(await upstream.json()); }
  else { res.send(await upstream.text()); }
}
