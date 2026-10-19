import React from "react";
import ClientComputerUseStudio from "@/modules/computer-studio/ComputerUseStudio";
import type { ComputerUseStudioProps } from "@/modules/computer-studio/types";

export type { ComputerUseStudioProps };

/**
 * Computer Use Studio pod: run an agent on the organization's desktop and supervise it.
 *
 * - Left: desktop session, a new task, and the desktop's task history
 * - Centre: the live desktop (noVNC; watch-only unless you take control), or periodic
 *   screenshots with manual actions when the live desktop is not reachable
 * - Right: the selected task's steps and pending approval, the learned skill it used or
 *   drafted from your takeover, and its replay
 */
export function ComputerUseStudioPod(props: ComputerUseStudioProps) {
  return <ClientComputerUseStudio {...props} />;
}

export const ComputerUseStudioPodAlias = ComputerUseStudioPod;
export default ComputerUseStudioPod;
