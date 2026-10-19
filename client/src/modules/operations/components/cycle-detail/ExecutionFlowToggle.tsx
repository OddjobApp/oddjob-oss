import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExecutionFlowVisualizer } from '@/modules/agents/components';

export interface ExecutionFlowToggleProps {
  cycleId: number;
}

export function ExecutionFlowToggle({ cycleId }: ExecutionFlowToggleProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShow(v => !v)}
        className="mb-3 gap-2"
      >
        <Activity className="w-4 h-4" />
        {show ? 'Hide Execution Flow' : 'Show Execution Flow'}
      </Button>
      {show && (
        <ExecutionFlowVisualizer sessionId={`cycle-${cycleId}`} autoRefresh={false} />
      )}
    </div>
  );
}
