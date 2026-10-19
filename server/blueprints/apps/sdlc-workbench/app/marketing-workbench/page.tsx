"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "Marketing Workbench",
    description: "Campaign register persisted in app records. Plan, launch, and pause campaigns across channels.",
    collection: "marketing_workbench_campaigns",
    statusField: "status",
    statusOrder: ["Draft", "Active", "Paused", "Complete"],
    crewPrompt: "Marketing campaign review",
    fields: [
      { key: "name", label: "Campaign", required: true, placeholder: "Q4 launch push" },
      { key: "channel", label: "Channel", type: "select", options: ["Email", "Paid Search", "Social", "Webinar", "Content", "Events"], required: true },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Active", "Paused", "Complete"] },
      { key: "budgetUsd", label: "Budget (USD)", type: "number" },
      { key: "startDate", label: "Start date", type: "date" },
    ],
  }} />;
}
