/**
 * DrillDownPanel - Reusable slide-in detail panel
 *
 * Desktop: Slides in from right side
 * Mobile: Full-screen modal
 *
 * Replaces full-page navigation with inline exploration.
 */

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DrillDownPanelProps {
  // Display
  isOpen: boolean;
  title: string;
  subtitle?: string;

  // Content
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;

  // Behavior
  onClose: () => void;
  onBack?: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";

  // Styling
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;

  // Accessibility
  closeButtonAriaLabel?: string;
}

/**
 * DrillDownPanel component
 *
 * Usage:
 * ```tsx
 * const [selectedMission, setSelectedMission] = useState(null);
 *
 * return (
 *   <>
 *     <MissionList onClick={(m) => setSelectedMission(m)} />
 *
 *     <DrillDownPanel
 *       isOpen={!!selectedMission}
 *       title={selectedMission?.name}
 *       onClose={() => setSelectedMission(null)}
 *     >
 *       <MissionDetailsContent mission={selectedMission} />
 *     </DrillDownPanel>
 *   </>
 * );
 * ```
 */
export const DrillDownPanel = React.forwardRef<HTMLDivElement, DrillDownPanelProps>(
  (
    {
      isOpen,
      title,
      subtitle,
      children,
      header,
      footer,
      onClose,
      onBack,
      size = "md",
      className,
      headerClassName,
      bodyClassName,
      footerClassName,
      closeButtonAriaLabel = "Close panel",
    },
    ref
  ) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Handle escape key
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen) {
          onClose();
        }
      };

      if (isOpen) {
        document.addEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "hidden";
      }

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "unset";
      };
    }, [isOpen, onClose]);

    // Handle click outside on desktop
    const handleBackdropClick = (e: React.MouseEvent) => {
      if (e.target === panelRef.current) {
        onClose();
      }
    };

    if (!isOpen) return null;

    // Size mapping for desktop panel width
    const sizeWidths = {
      sm: "w-96",
      md: "w-[500px]",
      lg: "w-[700px]",
      xl: "w-[900px]",
      full: "w-full",
    };

    return (
      <>
        {/* Backdrop - click to close */}
        <div
          ref={panelRef}
          onClick={handleBackdropClick}
          className={cn(
            "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
            isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          aria-hidden="true"
        />

        {/* Panel */}
        <div
          ref={ref}
          className={cn(
            // Base styles
            "fixed z-50 bg-background/95 backdrop-blur-sm border border-border/50 flex flex-col",

            // Animation
            "transition-all duration-300 ease-out",

            // Desktop (right-side slide-in)
            "hidden md:flex md:right-0 md:top-0 md:h-screen md:rounded-l-lg md:shadow-2xl",
            sizeWidths[size],

            // Mobile (full-screen modal)
            "md:hidden",
            isOpen
              ? "inset-0 m-0 rounded-t-2xl max-h-[90vh] bottom-0"
              : "inset-0 m-0 rounded-t-2xl max-h-[90vh] translate-y-full",

            // Custom class
            className
          )}
        >
          {/* Header */}
          <div
            className={cn(
              "flex-shrink-0 border-b border-border/30 bg-background/40",
              "px-4 py-4 sm:px-6 flex items-start justify-between gap-4",
              headerClassName
            )}
          >
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-1 truncate">{subtitle}</p>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              aria-label={closeButtonAriaLabel}
              className={cn(
                "flex-shrink-0 inline-flex items-center justify-center rounded-lg",
                "w-8 h-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Custom header content (optional) */}
          {header && <div className="flex-shrink-0 border-b border-border/30">{header}</div>}

          {/* Body - scrollable content */}
          <div
            ref={contentRef}
            className={cn(
              "flex-1 overflow-y-auto overscroll-contain",
              "px-4 py-4 sm:px-6",
              bodyClassName
            )}
          >
            {children}
          </div>

          {/* Footer - sticky actions */}
          {footer && (
            <div
              className={cn(
                "flex-shrink-0 border-t border-border/30 bg-background/40",
                "px-4 py-4 sm:px-6 flex gap-3",
                footerClassName
              )}
            >
              {footer}
            </div>
          )}
        </div>
      </>
    );
  }
);

DrillDownPanel.displayName = "DrillDownPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Preset Compositions
// ─────────────────────────────────────────────────────────────────────────────

interface DrillDownMissionProps extends Omit<DrillDownPanelProps, "title"> {
  mission: { id: string; name: string; status?: string; progress?: number };
}

/**
 * Mission-specific drill-down panel
 */
export const MissionDrillDown = React.forwardRef<HTMLDivElement, DrillDownMissionProps>(
  ({ mission, ...props }, ref) => {
    return (
      <DrillDownPanel
        ref={ref}
        title={mission.name}
        subtitle={mission.status && `Status: ${mission.status}`}
        size="lg"
        {...props}
      />
    );
  }
);

MissionDrillDown.displayName = "MissionDrillDown";

interface DrillDownCycleProps extends Omit<DrillDownPanelProps, "title"> {
  cycle: { id: string; name: string; status?: string; phase?: string };
}

/**
 * Cycle-specific drill-down panel
 */
export const CycleDrillDown = React.forwardRef<HTMLDivElement, DrillDownCycleProps>(
  ({ cycle, ...props }, ref) => {
    return (
      <DrillDownPanel
        ref={ref}
        title={cycle.name}
        subtitle={cycle.phase && `Phase: ${cycle.phase}`}
        size="lg"
        {...props}
      />
    );
  }
);

CycleDrillDown.displayName = "CycleDrillDown";

// ─────────────────────────────────────────────────────────────────────────────
// Hooks for Managing Panel State
// ─────────────────────────────────────────────────────────────────────────────

interface DrillDownState<T> {
  isOpen: boolean;
  item: T | null;
  previousItems: T[];
}

export function useDrillDown<T extends { id: string }>(initialItem: T | null = null) {
  const [state, setState] = React.useState<DrillDownState<T>>({
    isOpen: !!initialItem,
    item: initialItem,
    previousItems: [],
  });

  const open = React.useCallback((item: T) => {
    setState((prev) => ({
      isOpen: true,
      item,
      previousItems: prev.item ? [...prev.previousItems, prev.item] : prev.previousItems,
    }));
  }, []);

  const close = React.useCallback(() => {
    setState((prev) => ({
      isOpen: false,
      item: null,
      previousItems: prev.previousItems,
    }));
  }, []);

  const back = React.useCallback(() => {
    setState((prev) => {
      if (prev.previousItems.length > 0) {
        const newPrevious = [...prev.previousItems];
        const item = newPrevious.pop()!;
        return {
          isOpen: true,
          item,
          previousItems: newPrevious,
        };
      }
      return prev;
    });
  }, []);

  return {
    isOpen: state.isOpen,
    item: state.item,
    previousItems: state.previousItems,
    canGoBack: state.previousItems.length > 0,
    open,
    close,
    back,
  };
}

export default DrillDownPanel;
