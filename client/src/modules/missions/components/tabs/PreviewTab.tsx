/**
 * Preview Tab
 * 
 * Delegates to existing ForgePreview component for sophisticated app preview.
 */

import React from "react";
import { ForgePreview } from "@domain/mission/ui/modules/missions/components/ForgePreview";

interface PreviewTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function PreviewTab({ mission }: PreviewTabProps) {
  const previewSlug = (mission.blackboard as any)?.viaAppSlug || 
    (mission.blackboard as any)?.forge_app_slug || 
    (mission.blackboard as any)?.appSlug;

  return (
    <ForgePreview 
      slug={previewSlug || mission.name?.toLowerCase().replace(/\s+/g, '-') || 'preview'} 
      missionId={mission.id} 
    />
  );
}
