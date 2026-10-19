import React, { useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MEDIA_ASPECT_RATIOS, type MediaAspectRatio } from "@shared/media-studio";

export interface FilmBrief {
  productionTitle: string;
  aspectRatio: MediaAspectRatio;
}

export interface FilmBriefPodProps {
  onComplete?: (brief: FilmBrief) => void;
  onStageComplete?: (brief: FilmBrief) => void;
}

/**
 * The Make a Film playbook card's intake: the production's title and aspect ratio.
 * Sending it asks the room to start the production and open Media Studio on it.
 * Nothing is rendered or spent from here.
 */
export default function FilmBriefPod({ onComplete, onStageComplete }: FilmBriefPodProps) {
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>("16:9");
  const send = onComplete ?? onStageComplete;

  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
      data-testid="film-brief-pod"
      onSubmit={(event) => {
        event.preventDefault();
        const productionTitle = title.trim();
        if (!productionTitle || !send) return;
        send({ productionTitle, aspectRatio });
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Clapperboard className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Start a film</p>
          <p className="text-xs text-muted-foreground">
            The room starts the production and opens Media Studio beside the conversation. Every video render asks for approval before anything is spent.
          </p>
        </div>
      </div>
      <label htmlFor="film-brief-title" className="grid gap-1 text-xs font-medium">
        Title
        <Input id="film-brief-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Rooftop chase" />
      </label>
      <label htmlFor="film-brief-aspect" className="grid gap-1 text-xs font-medium">
        Aspect ratio
        <select
          id="film-brief-aspect"
          value={aspectRatio}
          onChange={(event) => setAspectRatio(event.target.value as MediaAspectRatio)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {MEDIA_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
      </label>
      <Button type="submit" disabled={!title.trim() || !send}>Start the film</Button>
    </form>
  );
}
