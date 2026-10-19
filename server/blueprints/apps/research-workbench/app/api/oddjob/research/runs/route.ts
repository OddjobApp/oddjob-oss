/**
 * GET /api/oddjob/research/runs
 * Proxy to platform: GET /api/platform/app/research/runs
 */
import { NextRequest } from "next/server";
import { proxyJson } from "../proxy-utils";

export async function GET(req: NextRequest) {
  return proxyJson(req, "/api/platform/app/research/runs");
}
