/**
 * POST /api/oddjob/research/runs/[executionId]/rerun
 * Proxy to platform: POST /api/platform/app/research/runs/:executionId/rerun
 */
import { NextRequest } from "next/server";
import { proxyJson } from "../../../proxy-utils";

export async function POST(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  return proxyJson(req, `/api/platform/app/research/runs/${params.executionId}/rerun`);
}
