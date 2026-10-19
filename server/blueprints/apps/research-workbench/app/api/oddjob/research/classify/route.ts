/**
 * POST /api/oddjob/research/classify
 * Proxy to platform: POST /api/platform/app/research/classify
 */
import { NextRequest } from "next/server";
import { proxyJson } from "../proxy-utils";

export async function POST(req: NextRequest) {
  return proxyJson(req, "/api/platform/app/research/classify");
}
