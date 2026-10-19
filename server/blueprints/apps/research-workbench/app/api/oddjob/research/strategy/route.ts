/**
 * POST /api/oddjob/research/strategy
 * Proxy to platform: POST /api/platform/app/research/strategy
 */
import { NextRequest } from "next/server";
import { proxyJson } from "../proxy-utils";

export async function POST(req: NextRequest) {
  return proxyJson(req, "/api/platform/app/research/strategy");
}
