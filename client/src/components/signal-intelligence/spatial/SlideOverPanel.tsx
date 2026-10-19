import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * SlideOverPanel — A drawer component entering from the trailing edge (right in LTR).
 * Requirements: 6.6, 6.7, 6.8
 *
 * Features:
 * - Max-width 480px, or 90vw on viewports narrower than 540px
 * - Focus trap within the panel when open
 * - Escape key closes the panel
 * - Returns focus to the triggering element on close
 * - Semantic HTML with appropriate ARIA attributes
 */

export interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement>;
}

/** Selector for all focusable elements within the panel. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function SlideOverPanel({
  open,
  onClose,
  title,
  description,
  children,
  triggerRef,
}: SlideOverPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ─── Store the triggering element's reference on open ─────────────────────
  useEffect(() => {
    if (open) {
      // Capture the element that had focus before the panel opened
      previousFocusRef.current =
        (triggerRef?.current as HTMLElement) ??
        (document.activeElement as HTMLElement);
    }
  }, [open, triggerRef]);

  // ─── Focus the panel on open ──────────────────────────────────────────────
  useEffect(() => {
    if (open && panelRef.current) {
      // Small delay to allow the DOM to settle after render
      const raf = requestAnimationFrame(() => {
        const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          // If no focusable child, focus the panel container itself
          panelRef.current?.focus();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  // ─── Return focus to trigger on close ─────────────────────────────────────
  useEffect(() => {
    if (!open && previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // ─── Escape key handler ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      // ─── Focus trap: Tab / Shift+Tab ────────────────────────────────
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;

        const focusableElements = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstEl = focusableElements[0];
        const lastEl = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift+Tab from first → wrap to last
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          // Tab from last → wrap to first
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        aria-hidden="true"
        onClick={onClose}
        data-testid="slide-over-backdrop"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-over-title"
        aria-describedby={description ? 'slide-over-description' : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-testid="slide-over-panel"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex flex-col',
          'bg-background border-l border-border shadow-xl',
          'w-[90vw] max-w-[480px]',
          // On viewports narrower than 540px, use 90vw
          // (already handled by w-[90vw] max-w-[480px] — 90vw < 480px below 533px)
          'animate-in slide-in-from-right duration-300',
          'focus-visible:outline-none',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="space-y-1">
            <h2
              id="slide-over-title"
              className="text-lg font-semibold text-foreground"
            >
              {title}
            </h2>
            {description && (
              <p
                id="slide-over-description"
                className="text-sm text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-accent transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            data-testid="slide-over-close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </>
  );
}
