import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Oddjob Platform Proxy
 * 
 * Forged apps use this route to proxy requests to the Oddjob platform.
 * Auth is handled via ODDJOB_APP_TOKEN injected at container runtime.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const path = (req.query.path as string[])?.join('/') || '';
  
  // Support both /api/oddjob/datasets and /api/platform/app/datasets style paths
  const platformPath = path.startsWith('platform/') ? path : `platform/app/${path}`;
  const platformBaseUrl = process.env.ODDJOB_API_URL || process.env.ODDJOB_PLATFORM_URL || 'http://localhost:5000';
  const url = `${platformBaseUrl}/api/${platformPath}${req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
  
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 
        'Authorization': `Bearer ${process.env.ODDJOB_APP_TOKEN}`, 
        'Content-Type': 'application/json',
        'X-App-Deployment': process.env.ODDJOB_DEPLOYMENT_ID || 'unknown',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (error: any) {
    console.error('[Oddjob Proxy Error]', error);
    res.status(502).json({ 
      error: 'Platform request failed', 
      message: error.message,
      path: platformPath 
    });
  }
}
