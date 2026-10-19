import { useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Ban, RotateCw } from "lucide-react";
import { useSessionActions } from "../hooks/useSessionActions.js";
import type { SessionStatus } from "../types/index.js";

export interface SessionActionBarProps {
  sessionId: string;
  status: SessionStatus;
}

export function SessionActionBar({ sessionId, status }: SessionActionBarProps) {
  const { cancel, retryPhase } = useSessionActions(sessionId);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");

  const canCancel = status === "active" || status === "paused";
  const canRetry = status === "failed";

  return (
    <div className="flex flex-col gap-2" data-testid="session-action-bar">
      <div className="flex items-center gap-2">
        {canCancel && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowCancel((v) => !v)}
            disabled={cancel.isPending}
            data-testid="cancel-session"
          >
            <Ban className="mr-1 h-4 w-4" /> Cancel Session
          </Button>
        )}
        {canRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => retryPhase.mutate(undefined)}
            disabled={retryPhase.isPending}
            data-testid="retry-phase"
          >
            <RotateCw className="mr-1 h-4 w-4" /> {retryPhase.isPending ? "Retrying…" : "Retry Phase"}
          </Button>
        )}
      </div>

      {showCancel && (
        <div className="space-y-2 rounded-md border p-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for cancellation (optional)"
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.mutate({ reason: reason || undefined });
                setShowCancel(false);
                setReason("");
              }}
            >
              {cancel.isPending ? "Cancelling…" : "Confirm Cancel"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCancel(false)}>Dismiss</Button>
          </div>
        </div>
      )}
    </div>
  );
}
