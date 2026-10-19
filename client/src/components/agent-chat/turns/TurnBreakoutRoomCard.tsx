import React from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CrewCard,
  CrewCardHeader,
  CrewCardBody,
  CrewCardFooter,
} from '../CrewCard';

export interface TurnBreakoutRoomCardProps {
  payload: Record<string, any>;
  tool?: string;
}

export function TurnBreakoutRoomCard({ payload: p }: TurnBreakoutRoomCardProps) {
  const subTopic = (p.subTopic as string) || (p.title as string) || 'Divergent Sub-Topic';
  const rationale = (p.rationale as string) || (p.description as string) || 'Supervisor suggested a dedicated room for this topic.';
  const proposedTitle = (p.proposedTitle as string) || subTopic;
  const childUrl = (p.childUrl as string) || (p.childSessionKey ? `/workspace/chat/${p.childSessionKey}` : '#');

  return (
    <CrewCard
      testId="turn-artifact"
      label="Breakout session suggestion"
    >
      <CrewCardHeader
        icon={<GitBranch className="h-4 w-4" />}
        title={proposedTitle}
        description="Breakout suggested by the supervisor"
      />
      <CrewCardBody>
        <p className="text-foreground"><span className="text-muted-foreground">Sub-topic: </span><span className="font-medium">{subTopic}</span></p>
        <p className="leading-relaxed text-muted-foreground">{rationale}</p>
      </CrewCardBody>
      <CrewCardFooter note="The parent discussion continues uninterrupted.">
        <Button
          asChild
          size="sm"
          className="gap-1.5"
          data-testid="join-breakout-btn"
        >
          <a href={childUrl}>
            <span>Open breakout room</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
