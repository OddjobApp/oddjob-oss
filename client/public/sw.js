/**
 * Oddjob service worker: push notifications only.
 *
 * HISTORY: an earlier build shipped a cache-first worker that pre-cached `/` and
 * `/index.html`. After a dev-server restart the cached shell pointed at module
 * URLs that no longer existed and the app hung on the boot spinner. This file
 * then became a kill-switch that purged caches and unregistered itself.
 *
 * It still purges every cache on activate, so a browser carrying that old worker
 * is cleaned up exactly as before. What changed: it no longer unregisters, because
 * it now receives push messages (registered by the notification settings when a
 * person turns push on).
 *
 * It deliberately has NO fetch handler. It never intercepts or caches a request,
 * so it cannot bring the stale-shell failure back. Do not add one without an
 * explicit cache-busting strategy.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();

      // Only when something was purged: those tabs may be running a shell the old
      // worker served from cache, so reload them onto live assets.
      if (keys.length > 0) {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          if ('navigate' in client) client.navigate(client.url);
        }
      }
    })()
  );
});

/** Only same-origin paths may be opened from a notification. */
function safePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Oddjob';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: safePath(data.url) },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          try {
            // Throws for a tab this worker does not control yet.
            await client.navigate(target);
            return;
          } catch {
            break;
          }
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
