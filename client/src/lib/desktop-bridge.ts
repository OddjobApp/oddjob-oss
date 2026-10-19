/**
 * The Electron desktop shell (desktop/src/preload.cjs) exposes this object on
 * window. In a plain browser it is absent, so every caller must handle null.
 */
export interface OddjobDesktopBridge {
  isDesktop: true;
  /** Native notification; clicking it opens `url`, a same-origin path. */
  notify(title: string, body: string, url: string): void;
  /** Pending-items count for the taskbar/dock; 0 clears it. */
  setBadge(count: number): void;
}

declare global {
  interface Window {
    oddjobDesktop?: OddjobDesktopBridge;
  }
}

export function getDesktopBridge(): OddjobDesktopBridge | null {
  return typeof window !== 'undefined' && window.oddjobDesktop?.isDesktop ? window.oddjobDesktop : null;
}
