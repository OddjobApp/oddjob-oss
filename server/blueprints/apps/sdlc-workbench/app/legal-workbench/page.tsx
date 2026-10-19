"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Legal Workbench",
    description: "Contract register persisted in app records. Track agreements from draft through signature to expiry.",
    collection: "legal_workbench_contracts",
    statusField: "status",
    statusOrder: ["Draft", "In Review", "Signed", "Expired"],
    crewPrompt: "Legal review — contract posture",
    fields: [
      { key: "title", label: "Contract", required: true, placeholder: "Acme MSA 2026" },
      { key: "counterparty", label: "Counterparty", required: true, placeholder: "Acme Corp" },
      { key: "valueUsd", label: "Value (USD)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "In Review", "Signed", "Expired"], required: true },
      { key: "expiryDate", label: "Expiry date", type: "date" },
    ],
  }} />;
}
