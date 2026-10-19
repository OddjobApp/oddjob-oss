import React from "react";
import ClientProjectStudio from "@/modules/project-studio/ProjectStudio";
import type { ProjectStudioProps } from "@/modules/project-studio/types";

export type { ProjectStudioProps };

/**
 * Project Studio — Hybrid Operational Cycle & CPM Wave Orchestration Pod.
 *
 * 4-pane governed planning environment:
 * - Sequence Spine: station outline, health rings, and critical path badges
 * - Multi-Mode Canvas: Horizon Gantt, Topological DAG, and Living Wave Canvas
 * - Companion Dock: Inspector (PERT 3-point duration), Hybrid Squad Allocator, and Governance
 * - Execution Dock: Fiscal ledger, token burn meters, and cycle launch controls
 */
export function ProjectStudioPod(props: ProjectStudioProps) {
  return <ClientProjectStudio {...props} />;
}

export const ProjectStudioPodAlias = ProjectStudioPod;
export default ProjectStudioPod;
