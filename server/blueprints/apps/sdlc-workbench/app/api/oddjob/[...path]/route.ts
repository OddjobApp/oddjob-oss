/**
 * Server-side proxy for the sdlc-workbench shared server.
 * Forwards /api/oddjob/* to the Oddjob platform API with ODDJOB_APP_TOKEN.
 * Supports JSON responses AND SSE streaming (for agent chat).
 */
import { NextRequest, NextResponse } from "next/server";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  const platformPath = `/api/platform/app/${pathSegments.join("/")}`;
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${PLATFORM_URL}${platformPath}${searchParams ? `?${searchParams}` : ""}`;

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = JSON.stringify(await req.json()); } catch { body = undefined; }
  }

  const upstream = await fetch(url, {
    method: req.method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${APP_TOKEN}` },
    body,
  });

  const contentType = upstream.headers.get("content-type") ?? "";

  // SSE streaming — pass through the stream directly
  if (contentType.includes("text/event-stream")) {
    return new NextResponse(upstream.body as any, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // JSON responses
  if (contentType.includes("application/json")) {
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  // Fallback: return as text
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": contentType || "text/plain" },
  });
}
