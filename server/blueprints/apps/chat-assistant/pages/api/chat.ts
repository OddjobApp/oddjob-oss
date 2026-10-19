import { NextApiRequest, NextApiResponse } from "next";

const ODDJOB_API = process.env.ODDJOB_API_URL || "http://host.docker.internal:5000";
const ODDJOB_API_KEY = process.env.ODDJOB_API_KEY || "";
const APP_SLUG = process.env.ODDJOB_APP_SLUG || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    const missionRes = await fetch(`${ODDJOB_API}/api/missions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ODDJOB_API_KEY}`,
      },
      body: JSON.stringify({
        name: `Chat: ${message.slice(0, 40)}`,
        objective: message,
        blackboard: { viaAppSlug: APP_SLUG, userMessage: message },
      }),
    });

    if (!missionRes.ok) {
      const err = await missionRes.text();
      return res.status(502).json({ error: err });
    }

    const mission = await missionRes.json();
    res.json({ reply: mission.objective || "Mission started.", missionId: mission.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
