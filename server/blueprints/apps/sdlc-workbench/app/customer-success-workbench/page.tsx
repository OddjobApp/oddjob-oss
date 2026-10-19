"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Customer Success Workbench",
    description: "Account health register persisted in app records. Track health scores, renewals, and lifecycle state.",
    collection: "cs_workbench_accounts",
    statusField: "status",
    statusOrder: ["Onboarding", "Healthy", "At Risk", "Churned"],
    crewPrompt: "Customer health review",
    fields: [
      { key: "account", label: "Account", required: true, placeholder: "Acme Corp" },
      { key: "healthScore", label: "Health score (0–100)", type: "number" },
      { key: "arrUsd", label: "ARR (USD)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Onboarding", "Healthy", "At Risk", "Churned"], required: true },
      { key: "renewalDate", label: "Renewal date", type: "date" },
      { key: "csm", label: "CSM" },
    ],
  }} />;
}
