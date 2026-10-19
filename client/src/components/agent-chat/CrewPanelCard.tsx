import React from 'react';
import { cn } from '@/lib/utils';

export interface PanelCardProps {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

export function PanelCard({ title, icon, badge, children, className, testId }: PanelCardProps) {
  return (
    <section
      className={cn('shrink-0 rounded-lg border border-border/70 bg-card p-3', className)}
      data-testid={testId}
    >
      <header className="mb-2 flex items-center gap-1.5">
        {icon}
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        {badge}
      </header>
      {children}
    </section>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic leading-relaxed text-muted-foreground">{children}</p>;
}
