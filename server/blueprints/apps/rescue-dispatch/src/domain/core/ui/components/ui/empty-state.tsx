import { memo, ReactNode } from "react";
import { Button } from './button.js';
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode | {
    label: string;
    onClick: () => void;
    icon?: React.ComponentType<{ className?: string }>;
  };
  className?: string;
}

/**
 * Memoized empty state component.
 * Only re-renders when props change.
 */
export const EmptyState = memo(function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action,
  className 
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      {Icon && (
        <Icon className="w-12 h-12 text-muted-foreground mb-4" aria-hidden="true" />
      )}
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-6">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          {typeof action === 'object' && 'label' in action ? (
            (() => {
              const ActionIcon = (action as any).icon;
              return (
                <Button onClick={(action as any).onClick} className="gap-2">
                  {ActionIcon && <ActionIcon className="h-4 w-4" />}
                  {(action as any).label}
                </Button>
              );
            })()
          ) : (
            action as ReactNode
          )}
        </div>
      )}
    </div>
  );
});

