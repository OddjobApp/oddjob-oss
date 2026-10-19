/**
 * Shared proxy utilities for research API routes.
 * Forwards requests to the Oddjob platform server with authentication.
 */
import { NextRequest, NextResponse } from "next/server";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://127.0.0.1:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";

/**
 * Proxy a JSON request to the platform server.
 */
export async function proxyJson(
  req: NextRequest,
  platformPath: string
): Promise<NextResponse> {
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${PLATFORM_URL}${platformPath}${searchParams ? `?${searchParams}` : ""}`;

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = JSON.stringify(await req.json());
    } catch {
      body = undefined;
    }
  }

  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APP_TOKEN}`,
    },
    body,
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const text = await upstream.text();
  return new NextResponse(text, { status: upstream.status });
}

/**
 * Proxy an SSE (Server-Sent Events) stream from the platform server.
 * Passes the readable stream directly through to the client.
 */
export async function proxySSE(
  req: NextRequest,
  platformPath: string
): Promise<NextResponse> {
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${PLATFORM_URL}${platformPath}${searchParams ? `?${searchParams}` : ""}`;

  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${APP_TOKEN}`,
    },
  });

  if (!upstream.ok) {
    // If upstream fails, return the error as JSON
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    }
    const text = await upstream.text();
    return new NextResponse(text, { status: upstream.status });
  }

  // Stream the SSE response body directly to the client
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
