"use client";
import { RecordsWorkbench } from "../components/RecordsWorkbench";
export default function Page() {
  return <RecordsWorkbench config={{
    title: "HR Workbench",
    description: "People register persisted in app records. Track onboarding through active employment to offboarding.",
    collection: "hr_workbench_employees",
    statusField: "status",
    statusOrder: ["Onboarding", "Active", "Offboarded"],
    crewPrompt: "People review — onboarding posture",
    fields: [
      { key: "name", label: "Name", required: true, placeholder: "Jordan Rivera" },
      { key: "role", label: "Role", placeholder: "Support Engineer" },
      { key: "department", label: "Department" },
      { key: "status", label: "Status", type: "select", options: ["Onboarding", "Active", "Offboarded"], required: true },
      { key: "startDate", label: "Start date", type: "date" },
    ],
  }} />;
}
