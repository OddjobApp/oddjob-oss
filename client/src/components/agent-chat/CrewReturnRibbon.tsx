import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

const storageKey = 'crew-return-room';
interface ReturnRoom { href: string; title: string; }
export function readReturnRoom(value: string | null): ReturnRoom | null {
  try {
    const room = JSON.parse(value || 'null');
    if (!room || typeof room.href !== 'string' || typeof room.title !== 'string') return null;
    const url = new URL(room.href, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/workspace\/chat\/[^/]+$/.test(url.pathname)) return null;
    return { href: url.pathname + url.search, title: room.title.slice(0, 180) };
  } catch { return null; }
}

export function CrewReturnRibbon() {
  const [location] = useLocation();
  const [room, setRoom] = useState<ReturnRoom | null>(null);
  const inCrew = /^\/workspace\/chat\/[^/]+$/.test(location.split('?')[0]);
  useEffect(() => {
    try {
      if (inCrew) {
        const origin = { href: window.location.pathname + window.location.search, title: document.querySelector('[data-testid="crew-header"] [title]')?.getAttribute('title') || 'CREW room' };
        sessionStorage.setItem(storageKey, JSON.stringify(origin));
        setRoom(null);
      } else {
        const saved = readReturnRoom(sessionStorage.getItem(storageKey));
        const currentOrg = new URLSearchParams(window.location.search).get('orgId');
        const roomOrg = saved && new URL(saved.href, window.location.origin).searchParams.get('orgId');
        setRoom(currentOrg && roomOrg && currentOrg !== roomOrg ? null : saved);
      }
    } catch { setRoom(null); }
  }, [location, inCrew]);
  if (inCrew || !room || location.startsWith('/auth/')) return null;
  return <nav aria-label="Return to CREW room" className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2 text-sm">
    <a href={room.href} className="min-w-0 truncate font-medium text-primary">← Back to room · {room.title}</a>
    <button type="button" aria-label="Dismiss return-to-room ribbon" className="shrink-0 rounded px-2 py-1 hover:bg-muted" onClick={() => { sessionStorage.removeItem(storageKey); setRoom(null); }}>×</button>
  </nav>;
}
