import { useEffect, useRef } from "react";

/**
 * Asking the mounted Media Studio to go somewhere, from anywhere on the page: the
 * configuration rail beside the chat, an empty state inside a tab, an error's quick
 * action. The studio and the rail are siblings with no shared parent state, so this is
 * a window event rather than a prop threaded through the room.
 */

export type StudioTab = "create" | "story" | "storyboard" | "characters" | "shots" | "film";

export interface StudioLocation {
  tab: StudioTab;
  /** The production the target belongs to; a studio showing another one ignores it. */
  productionId?: number;
  /** On Film, the scene to show. */
  sceneId?: number;
  /** On Film, the shot to put on screen. */
  shotId?: number;
}

const NAVIGATE_EVENT = "media-studio:navigate";

export function openInMediaStudio(location: StudioLocation): void {
  window.dispatchEvent(new CustomEvent<StudioLocation>(NAVIGATE_EVENT, { detail: location }));
}

/** Calls the handler whenever something asks the studio to go somewhere. */
export function useStudioNavigation(handler: (location: StudioLocation) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<StudioLocation>).detail;
      if (detail?.tab) latest.current(detail);
    };
    window.addEventListener(NAVIGATE_EVENT, listener);
    return () => window.removeEventListener(NAVIGATE_EVENT, listener);
  }, []);
}

/**
 * The other direction: the studio saying what is selected, so a rail beside the chat can
 * inspect it. Same reasoning as navigation — siblings with no shared parent — and the
 * same shape, so the two read as one bridge rather than two mechanisms.
 *
 * Published on selection and on mount; a subscriber that arrives later asks for it with
 * `requestStudioSelection()` rather than waiting for the next click.
 */

export interface StudioSelection {
  productionId: number;
  sceneId: number;
  /** The shot on screen, or null when the scene has none. */
  shotId: number | null;
  shotNumber: number | null;
  /** Scene keys and titles, for a rail that has not loaded the production. */
  sceneKey?: string;
}

const SELECTION_EVENT = "media-studio:selection";
const SELECTION_REQUEST_EVENT = "media-studio:selection-request";

/** The studio announces what is selected. */
export function publishStudioSelection(selection: StudioSelection | null): void {
  window.dispatchEvent(new CustomEvent<StudioSelection | null>(SELECTION_EVENT, { detail: selection }));
}

/** A rail that just mounted asks what is selected now. */
export function requestStudioSelection(): void {
  window.dispatchEvent(new Event(SELECTION_REQUEST_EVENT));
}

/** Calls the handler whenever the studio's selection changes. */
export function useStudioSelection(handler: (selection: StudioSelection | null) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: Event) => latest.current((event as CustomEvent<StudioSelection | null>).detail ?? null);
    window.addEventListener(SELECTION_EVENT, listener);
    requestStudioSelection();
    return () => window.removeEventListener(SELECTION_EVENT, listener);
  }, []);
}

/** The studio answers a request for the current selection. */
export function useStudioSelectionRequests(respond: () => void): void {
  const latest = useRef(respond);
  latest.current = respond;
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(SELECTION_REQUEST_EVENT, listener);
    return () => window.removeEventListener(SELECTION_REQUEST_EVENT, listener);
  }, []);
}
