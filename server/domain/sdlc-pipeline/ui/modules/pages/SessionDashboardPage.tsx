import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Plus } from "lucide-react";
import { useSessionList } from "../hooks/useSessionList.js";
import { MetricCardRow } from "../components/MetricCardRow.js";
import { SessionTable } from "../components/SessionTable.js";
import { SessionCreationForm } from "../components/SessionCreationForm.js";
import type { SessionStatus } from "../types/index.js";

const STATUS_OPTIONS: (SessionStatus | "all")[] = [
  "all", "active", "blocked", "paused", "pending", "completed", "failed", "timed_out", "cancelled",
];

export default function SessionDashboardPage() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: sessions = [], isLoading, isError } = useSessionList(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const blockedCount = sessions.filter((s) => s.status === "blocked").length;
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);

  return (
    <div className="space-y-6 p-6" data-testid="session-dashboard-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Codegen Sessions</h1>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SessionStatus | "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All statuses" : s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-session"><Plus className="mr-1 h-4 w-4" /> New Session</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Generation Session</DialogTitle></DialogHeader>
              <SessionCreationForm
                onCreated={(session) => {
                  setCreateOpen(false);
                  setLocation(`/pipeline/sessions/${session.id}`);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <MetricCardRow activeCount={activeCount} blockedCount={blockedCount} completedCount={completedCount} totalCost={totalCost} />

      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">
          Failed to load sessions. Showing the last known data.
        </div>
      )}

      <SessionTable sessions={sessions} isLoading={isLoading} onRowClick={(id) => setLocation(`/pipeline/sessions/${id}`)} />
    </div>
  );
}
