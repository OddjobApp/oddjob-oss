/**
 * GET /api/oddjob/research/runs/[executionId]/progress
 * Proxy to platform: GET /api/platform/app/research/runs/:executionId/progress
 *
 * This endpoint streams SSE (Server-Sent Events) from the platform server
 * directly through to the client for real-time progress monitoring.
 */
import { NextRequest } from "next/server";
import { proxySSE } from "../../../proxy-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  return proxySSE(req, `/api/platform/app/research/runs/${params.executionId}/progress`);
}
