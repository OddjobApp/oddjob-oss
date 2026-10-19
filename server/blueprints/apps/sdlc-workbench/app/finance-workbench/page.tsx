"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Finance Workbench",
    description: "Invoice and payables register persisted in app records. Track drafts through approval to payment.",
    collection: "finance_workbench_invoices",
    statusField: "status",
    statusOrder: ["Draft", "Sent", "Approved", "Paid", "Overdue"],
    crewPrompt: "Finance review — payables posture",
    fields: [
      { key: "vendor", label: "Vendor", required: true, placeholder: "AWS Hosting Services" },
      { key: "amountUsd", label: "Amount (USD)", type: "number", required: true },
      { key: "costCenter", label: "Cost center", placeholder: "CC-4100" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Sent", "Approved", "Paid", "Overdue"] },
      { key: "dueDate", label: "Due date", type: "date" },
    ],
  }} />;
}
