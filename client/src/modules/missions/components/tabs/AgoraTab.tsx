import React from 'react';
import { AgoraCanvas } from '@domain-ui/agora/ui/AgoraCanvas';

export default function AgoraTab({ mission, run }: { mission: any; run?: any }) {
  if (!mission?.id) return null;

  return (
    <div className="h-[80vh] w-full border border-[#ccc] rounded-lg overflow-hidden">
      <AgoraCanvas missionId={mission.id} mission={mission} run={run} />
    </div>
  );
}
