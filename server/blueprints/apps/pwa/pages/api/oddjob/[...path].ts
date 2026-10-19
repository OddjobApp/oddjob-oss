import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const path = (req.query.path as string[]).join('/');
  const qs = req.url?.includes('?') ? '?' + req.url.split('?')[1] : '';
  const url = `${process.env.ODDJOB_API_URL}/api/platform/app/${path}${qs}`;
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'Authorization': `Bearer ${process.env.ODDJOB_APP_TOKEN}`, 'Content-Type': 'application/json' },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: 'Platform proxy error', detail: err.message });
  }
}
