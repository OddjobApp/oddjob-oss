"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Sales Workbench",
    description: "Opportunity pipeline persisted in app records. Track deals from first touch to close.",
    collection: "sales_workbench_opportunities",
    statusField: "stage",
    statusOrder: ["Prospect", "Qualified", "Proposal", "Negotiation", "Won", "Lost"],
    crewPrompt: "Sales pipeline review",
    fields: [
      { key: "name", label: "Opportunity", required: true, placeholder: "Acme expansion" },
      { key: "account", label: "Account", placeholder: "Acme Corp" },
      { key: "amountUsd", label: "Amount (USD)", type: "number" },
      { key: "stage", label: "Stage", type: "select", options: ["Prospect", "Qualified", "Proposal", "Negotiation", "Won", "Lost"], required: true },
      { key: "closeDate", label: "Close date", type: "date" },
    ],
  }} />;
}
