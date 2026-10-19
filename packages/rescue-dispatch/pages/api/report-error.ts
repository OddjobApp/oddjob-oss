import type { NextApiRequest, NextApiResponse } from "next";

// Unauthenticated by design (a client-side crash reporter can't hold a credential),
// so treat the body as hostile: cap what reaches the log and never log it raw.
const MAX_FIELD = 500;

const clip = (v: unknown) =>
  typeof v === "string" ? v.slice(0, MAX_FIELD).replace(/[\r\n]+/g, " ") : undefined;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  console.error("[RescueDispatch Error Report]", {
    message: clip(body.message),
    source: clip(body.source),
    stack: clip(body.stack),
  });

  return res.status(200).json({ status: "logged" });
}
