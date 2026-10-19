import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try { fs.appendFileSync(path.join(process.cwd(), '.client-errors.log'), JSON.stringify({ ...req.body, ts: new Date().toISOString() }) + '
'); } catch {}
  res.status(204).end();
}
