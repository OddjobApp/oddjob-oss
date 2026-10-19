/**
 * HatMenu — the operational-mode card strip.
 *
 * A visible trigger that expands a row of mode cards; picking one switches mode
 * and navigates to that mode's route.
 *
 * Open state lives in OperationalModeContext, not here. It used to be local
 * `useState`, which left the context's own `isHatMenuOpen`/`toggleHatMenu`
 * dead and forced two non-React escape hatches — a `window.__hatMenuToggle`
 * global and a `document` custom event — so that anything outside this subtree
 * could open the menu. All three are gone; callers use the context.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Check, MessageSquare, Radio, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocation } from 'wouter';
import { getEntryForUrl } from '@/lib/spa-utils';
import {
  useOperationalMode,
  hasPersistedMode,
  modeForPath,
  MODE_LABELS,
  MODE_ROUTES,
  landingForMode,
  type OperationalMode,
} from '@/contexts/OperationalModeContext';

const MODE_ENTRIES: {
  mode: OperationalMode;
  icon: React.ElementType;
  description: string;
  color: string;
}[] = [
  {
    mode: 'agent-chat',
    icon: MessageSquare,
    description: 'Converse with specialized AI agents',
    color: 'from-blue-500/20 to-indigo-500/20 border-blue-500/30',
  },
  {
    mode: 'feeds-cycles',
    icon: Radio,
    description: 'Manage operational cycles & feeds',
    color: 'from-amber-500/20 to-orange-500/20 border-amber-500/30',
  },
  {
    mode: 'h3-spatial-watch',
    icon: Globe,
    description: 'Configurable signals, modeled impact & response',
    color: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/30',
  },
];

const CARDS_ID = 'hat-menu-cards';

export interface HatMenuProps {
  /** Applied only when the user has never picked a mode themselves. */
  defaultMode?: OperationalMode;
}

export function HatMenu({ defaultMode }: HatMenuProps) {
  const { activeMode, setMode, isHatMenuOpen, closeHatMenu } = useOperationalMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [location, setLocation] = useLocation();

  // A remembered mode is the user's choice and outranks the prop. Applying
  // `defaultMode` unconditionally used to overwrite it — via setMode, which
  // persists — so the prop silently erased what the user last picked.
  useEffect(() => {
    if (defaultMode && !hasPersistedMode()) setMode(defaultMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the strip honest about where you actually are. Previously only
  // /workspace/spatial self-corrected, so deep-linking to any other mode's
  // route left the strip highlighting a mode you were not looking at.
  useEffect(() => {
    const routeMode = modeForPath(location);
    if (routeMode && routeMode !== activeMode) setMode(routeMode);
  }, [location, activeMode, setMode]);

  const selectMode = useCallback(
    (mode: OperationalMode) => {
      setMode(mode);
      // Navigate even when the mode is already active: that is the one way back
      // when mode and route have diverged, and wouter no-ops if we are there.
      // The LANDING page, not the identity route — Feeds & Cycles opens on the
      // Launchpad, which it does not own and must not claim via modeForPath.
      const destination = landingForMode(mode);
      if (getEntryForUrl(location) !== getEntryForUrl(destination)) {
        window.location.assign(destination);
      } else {
        setLocation(destination);
      }
      closeHatMenu();
    },
    [setMode, location, setLocation, closeHatMenu],
  );

  // Escape, and clicking away. `containerRef` existed before but was never
  // read, so the menu could only be dismissed by choosing something.
  useEffect(() => {
    if (!isHatMenuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeHatMenu();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      // The trigger lives outside this subtree (it is the sidebar's hat icon),
      // so it would otherwise count as "outside": mousedown would close the
      // strip and the click straight after would reopen it, making the icon
      // unable to close what it opened.
      if (target?.closest('[data-hat-menu-trigger]')) return;
      if (!containerRef.current?.contains(target as Node)) closeHatMenu();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isHatMenuOpen, closeHatMenu]);

  // Focus the active card when the strip opens, so the keyboard has somewhere
  // to start — role="menu" promises arrow-key navigation.
  useEffect(() => {
    if (!isHatMenuOpen) return;
    const index = Math.max(0, MODE_ENTRIES.findIndex(entry => entry.mode === activeMode));
    cardRefs.current[index]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHatMenuOpen]);

  const onCardKeyDown = useCallback((event: React.KeyboardEvent, index: number) => {
    const last = MODE_ENTRIES.length - 1;
    let next: number | null = null;

    // The strip is horizontal, but menu semantics imply vertical keys too, and
    // both wrap.
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;

    if (next !== null) {
      event.preventDefault();
      cardRefs.current[next]?.focus();
    }
  }, []);

  return (
    <div ref={containerRef} data-testid="hat-menu-container">
      {/* No trigger of its own: the sidebar's hat icon owns that, and reaches
          this through OperationalModeContext. There used to be an empty 50x50
          button pinned to fixed viewport coordinates ON TOP of that icon,
          intercepting its clicks and drifting out of alignment with it at other
          breakpoints — the icon now just calls toggleHatMenu(). */}

      {/* Mode Cards Strip — pushes content down when open */}
      {isHatMenuOpen && (
        <div
          id={CARDS_ID}
          className="fixed inset-x-3 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-2 fade-in-0 duration-200 md:static md:inset-auto md:max-h-none md:overflow-visible md:rounded-none md:border-x-0 md:border-t-0 md:bg-card/80 md:px-4 md:py-3 md:shadow-none"
          role="menu"
          aria-label="Operational modes"
          data-testid="hat-menu-cards"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" data-testid="hat-menu-card-grid">
            {MODE_ENTRIES.map(({ mode, icon: Icon, description, color }, index) => {
              const isActive = mode === activeMode;

              return (
                <button
                  key={mode}
                  ref={element => { cardRefs.current[index] = element; }}
                  type="button"
                  role="menuitem"
                  onClick={() => selectMode(mode)}
                  onKeyDown={event => onCardKeyDown(event, index)}
                  className={cn(
                    'relative flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 sm:min-h-0 sm:flex-col sm:justify-center sm:gap-2 sm:p-4 sm:text-center',
                    'hover:scale-[1.02] active:scale-[0.98]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive
                      ? `bg-gradient-to-br ${color} border-primary/50 shadow-md`
                      : 'bg-card/50 border-border/50 hover:border-border hover:bg-card/80'
                  )}
                  data-testid={`hat-mode-card-${mode}`}
                  data-active={isActive || undefined}
                >
                  <Icon className={cn(
                    'h-6 w-6 shrink-0 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )} />
                  <span className="min-w-0 flex-1 sm:flex-none">
                    <span className={cn(
                      'block text-xs font-semibold leading-tight',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                      {MODE_LABELS[mode]}
                    </span>
                    <span className="mt-1 block text-[10px] leading-tight text-muted-foreground/70 sm:text-center">
                      {description}
                    </span>
                  </span>
                  {isActive && (
                    <Check className="absolute top-2 right-2 h-4 w-4 text-primary" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default HatMenu;
