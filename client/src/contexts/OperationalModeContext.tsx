import { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';

export type OperationalMode = 'agent-chat' | 'feeds-cycles' | 'h3-spatial-watch';

export interface OperationalModeContextValue {
  activeMode: OperationalMode;
  setMode: (mode: OperationalMode) => void;
  previousMode: OperationalMode | null;
  isHatMenuOpen: boolean;
  toggleHatMenu: () => void;
  closeHatMenu: () => void;
}

export const MODE_LABELS: Record<OperationalMode, string> = {
  'agent-chat': 'Agent Chat',
  'feeds-cycles': 'Feeds & Cycles',
  'h3-spatial-watch': 'Signal Studio',
};

/**
 * Where each mode lives. Kept beside the labels so a mode's route, name and
 * identity stay in one place — ModeRouter used to carry its own copy of the
 * labels and HatMenu its own copy of the routes, and they drifted.
 *
 * EVERY mode route MUST live under `/workspace/`. That is not cosmetic: only
 * `/workspace` and `/workspace/:rest*` render ModeRouter, which is what
 * actually shows a mode's panel. `feeds-cycles` used to point at `/dashboard`,
 * with two consequences, both of which looked like the card menu misbehaving:
 *
 *   1. Picking "Feeds & Cycles" navigated OUTSIDE ModeRouter, so the generic
 *      Dashboard rendered and FeedsCyclesPanel was never shown at all.
 *   2. `/dashboard` is an ordinary top-level route with its own sidebar link,
 *      so `modeForPath` claimed it — merely clicking "Dashboard" in the
 *      sidebar flipped the active mode to Feeds & Cycles and PERSISTED it,
 *      leaving the wrong card highlighted. Its `/dashboard/costs` and
 *      `/dashboard/forms` redirects tripped the same prefix match.
 *
 * Keeping the modes inside one namespace they exclusively own is what stops a
 * general app route silently owning a mode.
 */
export const MODE_ROUTES: Record<OperationalMode, string> = {
  'agent-chat': '/workspace/chat',
  'feeds-cycles': '/workspace/feeds',
  'h3-spatial-watch': '/workspace/spatial',
};

/**
 * Where picking a mode card actually takes you.
 *
 * Separate from MODE_ROUTES because those two jobs pull in opposite
 * directions. A mode's IDENTITY route has to be a path the mode exclusively
 * owns, or `modeForPath` claims a general page and merely visiting it switches
 * modes — the bug that made a plain sidebar "Dashboard" click flip the active
 * mode to Feeds & Cycles. A mode's LANDING page has no such constraint: it can
 * be a shared destination like the Launchpad.
 *
 * Defaults to the identity route; only override when a mode should land
 * somewhere it does not own.
 */
export const MODE_LANDING: Record<OperationalMode, string> = {
  ...MODE_ROUTES,
  // Feeds & Cycles opens on the Launchpad. `/launchpad` has its own sidebar
  // entry, so it must NOT become this mode's identity route.
  'feeds-cycles': '/launchpad',
};

/** Where selecting `mode` should navigate. */
export function landingForMode(mode: OperationalMode): string {
  return MODE_LANDING[mode] ?? MODE_ROUTES[mode];
}

/**
 * The mode a path belongs to, or null for a route that is not a mode at all
 * (most of the app). Longest match first so a nested route cannot be captured
 * by a shorter sibling.
 */
export function modeForPath(pathname: string): OperationalMode | null {
  if (pathname.startsWith('/workspace/signals') || pathname.startsWith('/signals')) {
    return 'h3-spatial-watch';
  }
  const match = (Object.entries(MODE_ROUTES) as [OperationalMode, string][])
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, route]) => pathname === route || pathname.startsWith(`${route}/`));
  return match ? match[0] : null;
}

const STORAGE_KEY = 'oddjob:operational-mode';

const VALID_MODES: ReadonlySet<string> = new Set<OperationalMode>([
  'agent-chat',
  'feeds-cycles',
  'h3-spatial-watch',
]);

function isValidMode(value: unknown): value is OperationalMode {
  return typeof value === 'string' && VALID_MODES.has(value);
}

/** Whether the user has ever chosen a mode, so a `defaultMode` prop can defer to them. */
export function hasPersistedMode(): boolean {
  try {
    return isValidMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

function readPersistedMode(): OperationalMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && isValidMode(stored)) {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR, private browsing quota exceeded, etc.)
  }
  return 'agent-chat';
}

function persistMode(mode: OperationalMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

const OperationalModeContext = createContext<OperationalModeContextValue | undefined>(undefined);

export function OperationalModeProvider({ children }: { children: ReactNode }) {
  const [activeMode, setActiveMode] = useState<OperationalMode>(readPersistedMode);
  const [isHatMenuOpen, setIsHatMenuOpen] = useState(false);
  const previousModeRef = useRef<OperationalMode | null>(null);

  const setMode = useCallback((mode: OperationalMode) => {
    if (!isValidMode(mode)) return;
    setActiveMode((current) => {
      if (current === mode) return current;
      previousModeRef.current = current;
      persistMode(mode);
      return mode;
    });
  }, []);

  const toggleHatMenu = useCallback(() => {
    setIsHatMenuOpen((prev) => !prev);
  }, []);

  const closeHatMenu = useCallback(() => {
    setIsHatMenuOpen(false);
  }, []);

  return (
    <OperationalModeContext.Provider value={{
      activeMode,
      setMode,
      previousMode: previousModeRef.current,
      isHatMenuOpen,
      toggleHatMenu,
      closeHatMenu,
    }}>
      {children}
    </OperationalModeContext.Provider>
  );
}

export function useOperationalMode(): OperationalModeContextValue {
  const context = useContext(OperationalModeContext);
  if (!context) {
    throw new Error('useOperationalMode must be used within an OperationalModeProvider');
  }
  return context;
}
