import React from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MediaStudioSelection } from "@shared/media-studio";

/** Sends something picked in the studio to the chat, so the next message is about it. */
export type MediaDiscuss = (target: Omit<MediaStudioSelection, "productionId">) => void;

/** Shown only beside a room that takes the selection. */
export function DiscussButton({ onDiscuss, target, className }: { onDiscuss?: MediaDiscuss; target: Omit<MediaStudioSelection, "productionId">; className?: string }) {
  if (!onDiscuss) return null;
  return (
    <Button
      type="button" size="icon" variant="ghost" className={cn("h-7 w-7", className)}
      aria-label={`Discuss ${target.label} in chat`} title="Discuss in chat"
      onClick={() => onDiscuss(target)}
    >
      <MessageSquare className="h-3.5 w-3.5" />
    </Button>
  );
}
