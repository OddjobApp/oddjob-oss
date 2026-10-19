import React from "react";
import { useSearch } from "wouter";
import { resolveActiveOrgId } from "@/lib/queryClient";
import { ComputerUseStudio } from "./ComputerUseStudio";

/**
 * /workspace/computer-use: Computer Use Studio as a page of its own, so a push
 * notification ("the computer needs you") has somewhere to land. Query parameters,
 * not path segments (wouter's :rest* matches only one segment):
 *   ?session=<desktop session id>&task=<task id>
 */
export default function ComputerUsePage() {
  const params = new URLSearchParams(useSearch());
  const organizationId = resolveActiveOrgId() ?? undefined;
  return (
    <div className="h-[calc(100vh-4rem)] min-h-[560px]" data-testid="computer-use-page">
      <ComputerUseStudio
        sessionId={params.get("session") ?? undefined}
        taskId={params.get("task") ?? undefined}
        organizationId={organizationId}
        initialTeaching={params.get("teach") === "1"}
      />
    </div>
  );
}
