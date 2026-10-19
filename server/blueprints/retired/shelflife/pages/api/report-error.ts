import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { error, context } = req.body;
  console.error(`[TELEMETRY_ERROR] ${error}`, context);
  
  // In production, this would pipe to Sentry or the Oddjob Audit Log
  return res.status(200).json({ success: true, missionId: context?.missionId });
}
