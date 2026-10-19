/**
 * NativeWorkbenchRegistry — In-App Workbench Component Resolver
 * Dynamically resolves cycle workbench URLs & slugs to native React components
 * for instant loading with active user session inheritance across all operational cycles.
 */
import React from "react";
import { PMWorkbench } from "./PMWorkbench";
import { ScrumMasterWorkbench } from "./ScrumMasterWorkbench";
import { QAWorkbench } from "./QAWorkbench";
import { ProductLaunchWorkbench } from "./ProductLaunchWorkbench";
import { StakeholderWorkbench } from "./StakeholderWorkbench";
import { DevOpsWorkbench } from "./DevOpsWorkbench";
import { ResearchWorkbench } from "./ResearchWorkbench";

export interface NativeWorkbenchProps {
  publicPath?: string | null;
  slug?: string | null;
  name?: string | null;
  missionId?: number;
  cycleId?: number;
}

/**
 * Checks if a workbench path or slug can be rendered natively in-app.
 */
export function hasNativeWorkbench(publicPath?: string | null, slug?: string | null, name?: string | null): boolean {
  const norm = `${publicPath || ""} ${slug || ""} ${name || ""}`.toLowerCase();
  
  if (norm.includes("pm-workbench") || norm.includes("intake") || norm.includes("requirement") || norm.includes("initialization") || norm.includes("analysis")) return true;
  if (norm.includes("scrum-master") || norm.includes("sprint") || norm.includes("kickoff") || norm.includes("planning") || norm.includes("backlog")) return true;
  if (norm.includes("qa-workbench") || norm.includes("qa") || norm.includes("regression") || norm.includes("testing") || norm.includes("quality")) return true;
  if (norm.includes("product-launch") || norm.includes("launch-command-center") || norm.includes("launch") || norm.includes("gtm")) return true;
  if (norm.includes("stakeholder") || norm.includes("uat") || norm.includes("cab") || norm.includes("release candidate")) return true;
  if (norm.includes("devops") || norm.includes("deploy") || norm.includes("incident") || norm.includes("hotfix") || norm.includes("sre") || norm.includes("infrastructure") || norm.includes("scouting")) return true;
  if (norm.includes("research") || norm.includes("synthesis") || norm.includes("crawler") || norm.includes("investigation")) return true;
  
  return true; // All operational cycle steps map to a native in-app workbench!
}

/**
 * Renders the native workbench component matching the publicPath/slug.
 */
export function NativeWorkbench({ publicPath, slug, name, missionId, cycleId }: NativeWorkbenchProps) {
  const norm = `${publicPath || ""} ${slug || ""} ${name || ""}`.toLowerCase();

  // 1. Scrum Master & Sprint Planning
  if (norm.includes("scrum-master") || norm.includes("sprint") || norm.includes("kickoff") || norm.includes("planning") || norm.includes("backlog")) {
    return <ScrumMasterWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 2. QA & Test Automation
  if (norm.includes("qa-workbench") || norm.includes("qa") || norm.includes("regression") || norm.includes("testing") || norm.includes("quality")) {
    return <QAWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 3. Product Launch & GTM
  if (norm.includes("product-launch") || norm.includes("launch-command-center") || norm.includes("launch") || norm.includes("gtm")) {
    return <ProductLaunchWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 4. Stakeholder, UAT & CAB Governance
  if (norm.includes("stakeholder") || norm.includes("uat") || norm.includes("cab") || norm.includes("release candidate")) {
    return <StakeholderWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 5. DevOps, Deployment & Incident Routing
  if (norm.includes("devops") || norm.includes("deploy") || norm.includes("incident") || norm.includes("hotfix") || norm.includes("sre") || norm.includes("infrastructure") || norm.includes("scouting")) {
    return <DevOpsWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 6. Research & Synthesis
  if (norm.includes("research") || norm.includes("synthesis") || norm.includes("crawler") || norm.includes("investigation")) {
    return <ResearchWorkbench missionId={missionId} cycleId={cycleId} />;
  }

  // 7. PM, Requirements & Intake Studio (Default)
  return <PMWorkbench missionId={missionId} cycleId={cycleId} />;
}
