"use client";

import { useEffect } from "react";
import { markAsRead } from "./handoff-queue";

/**
 * Hook to mark queued handoff notifications as read when a workbench mounts.
 * Call this at the top of each workbench content component.
 *
 * @param workbenchId - The workbench identifier matching STAGE_IDENTIFIERS values
 *                      (e.g. "pm-workbench", "scrum-master-workbench", "qa-workbench")
 */
export function useMarkHandoffsRead(workbenchId: string): void {
  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    if (orgId && /^\d+$/.test(orgId)) markAsRead(workbenchId, orgId);
  }, [workbenchId]);
}
