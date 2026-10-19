import React from "react";
import { ThoughtStream } from "@domain/mission/ui/modules/missions/components/ThoughtStream";

interface ThoughtsTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function ThoughtsTab({ run }: ThoughtsTabProps) {
  if (!run?.id) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        No active run detected.
      </div>
    );
  }
  return <ThoughtStream missionRunId={run.id} />;
}
