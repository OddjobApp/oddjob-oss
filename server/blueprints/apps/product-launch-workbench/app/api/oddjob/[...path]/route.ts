/**
 * Server-side proxy for the product-launch-workbench.
 * Forwards /api/oddjob/* to the Oddjob platform API with ODDJOB_APP_TOKEN.
 */
import { NextRequest, NextResponse } from "next/server";

const PLATFORM_URL = process.env.ODDJOB_PLATFORM_URL ?? "http://localhost:5000";
const APP_TOKEN = process.env.ODDJOB_APP_TOKEN ?? "";

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }

async function proxy(req: NextRequest, pathSegments: string[]) {
  const platformPath = `/api/platform/app/${pathSegments.join("/")}`;
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${PLATFORM_URL}${platformPath}${searchParams ? `?${searchParams}` : ""}`;
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = JSON.stringify(await req.json()); } catch { body = undefined; }
  }
  const upstream = await fetch(url, { method: req.method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${APP_TOKEN}` }, body });
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) { return NextResponse.json(await upstream.json(), { status: upstream.status }); }
  return new NextResponse(await upstream.text(), { status: upstream.status });
}
