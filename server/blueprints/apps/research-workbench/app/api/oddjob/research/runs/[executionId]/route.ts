/**
 * GET    /api/oddjob/research/runs/[executionId]
 * DELETE /api/oddjob/research/runs/[executionId]
 *
 * Proxy to platform:
 *   GET    /api/platform/app/research/runs/:executionId
 *   DELETE /api/platform/app/research/runs/:executionId
 */
import { NextRequest } from "next/server";
import { proxyJson } from "../../proxy-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  return proxyJson(req, `/api/platform/app/research/runs/${params.executionId}`);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  return proxyJson(req, `/api/platform/app/research/runs/${params.executionId}`);
}
