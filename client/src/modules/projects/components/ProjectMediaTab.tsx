import React from "react";
import { Link } from "wouter";
import { Clapperboard, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@shared/media-studio";
import { useProjectMedia } from "../hooks/use-projects";

/**
 * A Project Space's Media tab: the films made in its rooms, what each holds and has
 * spent, and a way back to the room where Media Studio opens on it.
 */

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function ProjectMediaTab({ projectKey }: { projectKey: string }) {
  const { data, isLoading, error } = useProjectMedia(projectKey);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (error) {
    return (
      <Card>
        <CardContent role="alert" className="py-6 text-sm text-destructive">
          {(error as Error).message || "The productions could not be loaded."}
        </CardContent>
      </Card>
    );
  }

  const productions = data?.productions ?? [];
  return (
    <div className="space-y-4" data-testid="project-media-tab">
      {productions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No films belong to this project yet. In one of its rooms, pick <span className="font-medium text-foreground">Make a Film</span> or ask for Media Studio.
          </CardContent>
        </Card>
      ) : (
        <section aria-label="Productions" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Clapperboard className="h-4 w-4 text-primary" aria-hidden />
            Productions <span className="text-muted-foreground">({productions.length})</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {productions.map((production) => (
              <Card key={production.id} data-testid={`project-production-${production.id}`}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-foreground">{production.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {plural(production.scenes, "scene")} · {plural(production.shots, "shot")} · {plural(production.approvedTakes, "approved take")} · {plural(production.reels, "reel")}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{production.aspectRatio}</Badge>
                  </div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {formatCents(production.spendCents)} of {formatCents(production.budgetLimitCents)} spent
                  </div>
                  {production.room ? (
                    <Link
                      href={`/workspace/chat/${production.room.sessionKey}`}
                      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
                      data-testid={`project-production-room-${production.id}`}
                    >
                      <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                      Open in {production.room.title || "its room"}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not made in a room</span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
