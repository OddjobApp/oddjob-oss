import type { NextApiRequest, NextApiResponse } from "next";

type Stage = "Lead" | "Qualified" | "Proposal" | "Closed Won" | "Closed Lost";

interface Contact {
  id: string; name: string; company: string; stage: Stage;
  value: number; lastContact: string; email: string; phone?: string;
}

const CONTACTS: Contact[] = [
  { id: "1",  name: "Alex Mercer",    company: "Apex Industrial",  stage: "Qualified",   value: 42000,  lastContact: "Apr 14", email: "alex@apex.io",       phone: "+1 555-0101" },
  { id: "2",  name: "Sara Vance",     company: "Neon Labs",        stage: "Proposal",    value: 95000,  lastContact: "Apr 15", email: "sara@neonlabs.com",  phone: "+1 555-0102" },
  { id: "3",  name: "Tom Brecht",     company: "GridCore",         stage: "Lead",        value: 18000,  lastContact: "Apr 10", email: "tom@gridcore.net" },
  { id: "4",  name: "Priya Nair",     company: "Vertex Systems",   stage: "Closed Won",  value: 130000, lastContact: "Apr 12", email: "priya@vertex.io",    phone: "+1 555-0104" },
  { id: "5",  name: "Luca Fermi",     company: "Helix Tech",       stage: "Closed Lost", value: 55000,  lastContact: "Apr 8",  email: "luca@helix.co" },
  { id: "6",  name: "Dana Kim",       company: "PulseWave",        stage: "Qualified",   value: 27500,  lastContact: "Apr 16", email: "dana@pulsewave.io",  phone: "+1 555-0106" },
  { id: "7",  name: "James Ortega",   company: "Solara Corp",      stage: "Proposal",    value: 78000,  lastContact: "Apr 17", email: "james@solara.co" },
  { id: "8",  name: "Mei Lin",        company: "Tungsten AI",      stage: "Lead",        value: 12000,  lastContact: "Apr 9",  email: "mei@tungstenai.io" },
  { id: "9",  name: "Oliver Brandt",  company: "Cascade Systems",  stage: "Closed Won",  value: 215000, lastContact: "Apr 13", email: "oliver@cascade.io",  phone: "+1 555-0109" },
  { id: "10", name: "Aisha Bakr",     company: "Nova Analytics",   stage: "Qualified",   value: 63000,  lastContact: "Apr 11", email: "aisha@novaai.com",   phone: "+1 555-0110" },
  { id: "11", name: "Chris Nakamura", company: "Zenith Software",  stage: "Proposal",    value: 44000,  lastContact: "Apr 18", email: "chris@zenith.dev" },
  { id: "12", name: "Fatima Hassan",  company: "DataMesh Inc",     stage: "Lead",        value: 8500,   lastContact: "Apr 7",  email: "fatima@datamesh.io" },
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const openStages: Stage[] = ["Lead", "Qualified", "Proposal"];
  const totalPipeline = CONTACTS.filter(c => openStages.includes(c.stage)).reduce((s, c) => s + c.value, 0);
  const wonValue = CONTACTS.filter(c => c.stage === "Closed Won").reduce((s, c) => s + c.value, 0);
  const lostValue = CONTACTS.filter(c => c.stage === "Closed Lost").reduce((s, c) => s + c.value, 0);
  const openDeals = CONTACTS.filter(c => openStages.includes(c.stage)).length;
  const closedCount = CONTACTS.filter(c => c.stage === "Closed Won" || c.stage === "Closed Lost").length;
  const winRate = closedCount > 0 ? Math.round((CONTACTS.filter(c => c.stage === "Closed Won").length / closedCount) * 100) : 0;

  const stageOrder: Stage[] = ["Lead", "Qualified", "Proposal", "Closed Won", "Closed Lost"];
  const stageBreakdown = stageOrder.map(stage => ({
    name: stage,
    count: CONTACTS.filter(c => c.stage === stage).length,
    value: CONTACTS.filter(c => c.stage === stage).reduce((s, c) => s + c.value, 0),
  }));

  const months = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  const wonBase =  [48000, 62000, 55000, 91000, 78000, wonValue];
  const lostBase = [22000, 18000, 35000, 15000, 42000, lostValue];
  const monthlyRevenue = months.map((month, i) => ({ month, won: wonBase[i], lost: lostBase[i] }));

  res.status(200).json({
    contacts: CONTACTS,
    stats: { totalPipeline, wonValue, openDeals, winRate },
    stageBreakdown,
    monthlyRevenue,
  });
}
