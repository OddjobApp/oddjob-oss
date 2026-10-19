import React from 'react';
import { GeneratedImageCard } from '@/components/agent-chat/GeneratedImageCard';
import { cn } from '@/lib/utils';

export interface GeneratedImageCardPodProps {
  url?: string;
  title?: string;
  description?: string;
  isGenerating?: boolean;
  className?: string;
}

export default function GeneratedImageCardPod({
  url = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
  title = 'Autonomous Swarm Topology',
  description = 'High-dimensional graph embedding representing agent collaboration clusters and mission delegation channels.',
  isGenerating = false,
  className,
}: GeneratedImageCardPodProps) {
  return (
    <div className={cn('w-full max-w-xl mx-auto', className)}>
      <GeneratedImageCard
        url={url}
        title={title}
        description={description}
        isGenerating={isGenerating}
      />
    </div>
  );
}

export { GeneratedImageCardPod };
