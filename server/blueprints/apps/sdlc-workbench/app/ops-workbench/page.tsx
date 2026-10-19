"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Operations Workbench",
    description: "Live incident register shared with the VSM dashboard. Declare, triage, and drive incidents to resolution.",
    collection: "incidents",
    statusField: "status",
    statusOrder: ["Open", "Investigating", "Mitigated", "Resolved"],
    crewPrompt: "Operations review — incident posture",
    fields: [
      { key: "title", label: "Title", required: true, placeholder: "Payment gateway latency spike" },
      { key: "severity", label: "Severity", type: "select", options: ["SEV-1", "SEV-2", "SEV-3"], required: true },
      { key: "component", label: "Component", placeholder: "payments-api" },
      { key: "commander", label: "Incident commander" },
      { key: "status", label: "Status", type: "select", options: ["Open", "Investigating", "Mitigated", "Resolved"] },
    ],
  }} />;
}
