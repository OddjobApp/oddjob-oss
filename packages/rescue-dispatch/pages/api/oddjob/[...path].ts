import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Oddjob Platform Proxy
 *
 * Standalone Next.js App proxy for platform operations, with the app's deployment
 * token injected server-side.
 *
 * SECURITY: this handler attaches ODDJOB_APP_TOKEN to whatever it forwards, so it is
 * a credential-lending endpoint reachable by anyone who can load the app. It must
 * therefore forward only the specific calls this app makes — never an arbitrary
 * caller-chosen path or method. Two rules enforce that:
 *
 *   1. Every path segment is validated. `..`, encoded traversal and empty segments
 *      are rejected outright, because `fetch` resolves dot segments and would let a
 *      caller climb out of `platform/app/` into any `/api/*` route with the token.
 *   2. The resolved route must appear in ALLOWED_ROUTES below. Adding a capability
 *      to the app means adding its route here, deliberately.
 */

// method + path prefix (under /api/platform/app/) this deployment is allowed to call.
const ALLOWED_ROUTES: ReadonlyArray<{ methods: readonly string[]; prefix: string }> = [
  { methods: ['GET', 'POST'], prefix: 'datasets' },
  { methods: ['GET'], prefix: 'agents' },
  { methods: ['GET'], prefix: 'events' },
  { methods: ['GET', 'POST'], prefix: 'rescue' },
];

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawSegments = req.query.path;
  const segments = Array.isArray(rawSegments) ? rawSegments : rawSegments ? [rawSegments] : [];

  if (segments.length === 0) {
    return res.status(400).json({ error: 'Missing path' });
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || !SEGMENT.test(seg)) {
      return res.status(400).json({ error: 'Invalid path segment' });
    }
  }

  const method = (req.method || 'GET').toUpperCase();
  const path = segments.join('/');

  const allowed = ALLOWED_ROUTES.some(
    (r) => r.methods.includes(method) && (path === r.prefix || path.startsWith(`${r.prefix}/`)),
  );
  if (!allowed) {
    return res.status(403).json({ error: 'Route not permitted for this app deployment' });
  }

  const token = process.env.ODDJOB_APP_TOKEN;
  if (!token) {
    // Without a token the upstream call is unauthenticated; fail rather than
    // silently forwarding an anonymous request and reporting whatever comes back.
    console.error('[Oddjob Proxy] ODDJOB_APP_TOKEN is not set');
    return res.status(500).json({ error: 'App deployment is not configured' });
  }

  const platformBaseUrl =
    process.env.ODDJOB_API_URL || process.env.ODDJOB_PLATFORM_URL || 'http://localhost:5000';
  const queryIndex = req.url?.indexOf('?') ?? -1;
  const search = queryIndex >= 0 ? req.url!.slice(queryIndex) : '';
  const url = `${platformBaseUrl}/api/platform/app/${path}${search}`;

  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-App-Deployment': process.env.ODDJOB_DEPLOYMENT_ID || 'standalone-rescue-dispatch',
      },
      body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (error: any) {
    // Log detail server-side; do not echo upstream error text or the resolved path
    // back to the caller, since both describe internal topology.
    console.error('[Oddjob Proxy Error]', error);
    res.status(502).json({ error: 'Platform request failed' });
  }
}
