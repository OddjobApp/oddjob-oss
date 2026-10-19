import * as React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * ContextualTooltip — Displays a tooltip within 200ms on hover/focus.
 * Content is capped at 120 characters per requirement 1.5.
 *
 * Requirements: 1.5
 *
 * Usage:
 * ```tsx
 * <ContextualTooltip hint="Explanation of this element's purpose">
 *   <button>Hover me</button>
 * </ContextualTooltip>
 * ```
 */

/** Maximum characters allowed in a tooltip hint. */
const MAX_HINT_LENGTH = 120;

/** Delay in milliseconds before the tooltip appears (requirement: ≤200ms). */
const TOOLTIP_DELAY_MS = 200;

export interface ContextualTooltipProps {
  /** The explanation text (max 120 characters). Truncated if exceeds limit. */
  hint: string;
  /** The element that triggers the tooltip on hover/focus. */
  children: React.ReactNode;
  /** Optional side placement (default: "top"). */
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function ContextualTooltip({
  hint,
  children,
  side = 'top',
}: ContextualTooltipProps) {
  // Truncate hint to 120 characters to comply with requirement 1.5
  const truncatedHint =
    hint.length > MAX_HINT_LENGTH ? hint.slice(0, MAX_HINT_LENGTH) : hint;

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[280px] text-xs"
          data-testid="contextual-tooltip-content"
        >
          {truncatedHint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { MAX_HINT_LENGTH, TOOLTIP_DELAY_MS };
