"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { records, missions, integrations, events, telemetry } from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { backlogSteeringModes } from "../../lib/steering-modes";

type Priority = "P0" | "P1" | "P2" | "P3";
type TaskStatus = "pending" | "synced" | "skipped";

interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  status: TaskStatus;
  assignee?: string;
  labels?: string;
  estimatedHours?: number;
  sourceSpec?: string;
  targetSystem?: string;
}

interface SyncLogEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  targetSystem: string;
  externalId?: string;
  timestamp: string;
  status: string;
}

const PRIORITY_STYLES: Record<Priority, { badge: string; border: string }> = {
  P0: { badge: "bg-rose-500/20 text-rose-400", border: "border-l-rose-500" },
  P1: { badge: "bg-amber-500/20 text-amber-400", border: "border-l-amber-500" },
  P2: { badge: "bg-blue-500/20 text-blue-400", border: "border-l-blue-500" },
  P3: { badge: "bg-slate-600 text-slate-400", border: "border-l-slate-600" },
};

const TARGET_SYSTEMS = ["Jira", "Linear", "Asana", "Trello", "GitHub Issues", "Notion", "Manual"];

export default function BacklogProvisionerContent() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // Decomposer
  const [specText, setSpecText] = useState("");
  const [targetSystem, setTargetSystem] = useState("Jira");
  const [decomposing, setDecomposing] = useState(false);

  // Task grid editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Partial<Task>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"sync" | "skip" | "delete" | null>(null);

  // Sync console
  const [cycleIntegrations, setCycleIntegrations] = useState<any[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeTargetSystem, setActiveTargetSystem] = useState("Jira");

  const fetchAll = useCallback(async () => {
    const [t, s, ci] = await Promise.all([
      records.list("task_backlog").catch(() => []),
      records.list("sync_log").catch(() => []),
      records.list("cycle_integrations").catch(() => []),
    ]);
    setTasks(t as Task[]);
    setSyncLog((s as SyncLogEntry[]).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    setCycleIntegrations(ci);
    setLoadingTasks(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = events.subscribe((event) => {
      if (event.type === "mission.completed") fetchAll();
    });
    return unsub;
  }, [fetchAll]);

  // ── Decomposer ────────────────────────────────────────────────────────────

  async function handleDecompose() {
    if (!specText.trim()) return;
    setDecomposing(true);
    try {
      await missions.trigger("Task Decomposition", {
        specification: specText,
        targetSystem,
        triggeredBy: "backlog-provisioner",
      });
      telemetry.emit("spec_decomposed", "info", { targetSystem, specLength: specText.length });
    } finally { setDecomposing(false); }
  }

  // ── Task grid inline editing ──────────────────────────────────────────────

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditBuffer({ title: task.title, description: task.description, priority: task.priority, assignee: task.assignee, estimatedHours: task.estimatedHours });
  }

  async function saveEdit(task: Task) {
    setSavingId(task.id);
    try {
      await records.update("task_backlog", task.id, editBuffer as Record<string, unknown>);
      telemetry.emit("task_updated", "info", { taskId: task.id });
      setEditingId(null);
      await fetchAll();
    } finally { setSavingId(null); }
  }

  async function deleteTask(task: Task) {
    setDeletingId(task.id);
    try {
      await records.update("task_backlog", task.id, { status: "skipped", _deleted: true });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(task.id); return n; });
      await fetchAll();
    } finally { setDeletingId(null); }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map(t => t.id)));
    }
  }

  async function handleBulkSync() {
    const selected = tasks.filter(t => selectedIds.has(t.id) && t.status === "pending");
    for (const task of selected) {
      await syncTask(task);
    }
    setSelectedIds(new Set());
  }

  async function handleBulkSkip() {
    for (const id of selectedIds) {
      await records.update("task_backlog", id, { status: "skipped" }).catch(() => {});
    }
    setSelectedIds(new Set());
    await fetchAll();
  }

  async function handleBulkDelete() {
    for (const id of selectedIds) {
      await records.update("task_backlog", id, { status: "skipped", _deleted: true }).catch(() => {});
    }
    setSelectedIds(new Set());
    await fetchAll();
  }

  // ── Sync logic ────────────────────────────────────────────────────────────

  async function syncTask(task: Task): Promise<void> {
    try {
      let externalId: string | undefined;
      if (activeTargetSystem === "Jira") {
        const res = await integrations.bugs.create({
          title: task.title,
          description: task.description,
          severity: task.priority,
        });
        externalId = (res as any).issueKey;
      } else {
        await records.update("task_backlog", task.id, { status: "synced", targetSystem: activeTargetSystem });
      }
      await records.create("sync_log", {
        taskId: task.id,
        taskTitle: task.title,
        targetSystem: activeTargetSystem,
        externalId,
        timestamp: new Date().toISOString(),
        status: "synced",
      });
    } catch {
      await records.create("sync_log", {
        taskId: task.id,
        taskTitle: task.title,
        targetSystem: activeTargetSystem,
        timestamp: new Date().toISOString(),
        status: "error",
      });
    }
  }

  async function handleSyncAll() {
    const pending = tasks.filter(t => t.status === "pending");
    if (pending.length === 0) return;
    setSyncingAll(true);
    setSyncProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      await syncTask(pending[i]);
      setSyncProgress({ done: i + 1, total: pending.length });
    }
    await fetchAll();
    setSyncingAll(false);
    setSyncProgress(null);
  }

  const pendingTasks = tasks.filter(t => t.status === "pending");
  const hasCycleIntegrations = cycleIntegrations.length > 0;

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Research</span>
          <h1 className="text-2xl font-bold">Action & Backlog Provisioner</h1>
          <span className="text-xs text-slate-500 ml-auto">{tasks.length} tasks · {pendingTasks.length} pending</span>
        </div>

        {/* ── Top: Task Decomposer ────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-300 mb-4">Task Decomposer</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_200px]">
            <textarea
              rows={4}
              value={specText}
              onChange={e => setSpecText(e.target.value)}
              placeholder="Paste a specification, requirement, or document to decompose into tasks…"
              className="w-full bg-slate-900 border border-white/10 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-emerald-500/50"
            />
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase">Target System</label>
                <select
                  value={targetSystem}
                  onChange={e => setTargetSystem(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm"
                >
                  {TARGET_SYSTEMS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <button
                onClick={handleDecompose}
                disabled={decomposing || !specText.trim()}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                {decomposing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                    Decomposing…
                  </span>
                ) : "Decompose with AI"}
              </button>
            </div>
          </div>
          {decomposing && (
            <p className="text-xs text-slate-400 mt-2 animate-pulse">Agent is decomposing your specification…</p>
          )}
        </div>

        {/* ── Middle: Task Grid ──────────────────────────────────────────── */}
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-300">Task Backlog</h2>
            {selectedIds.size > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-400">{selectedIds.size} selected</span>
                <button onClick={handleBulkSync} className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold">Sync Selected</button>
                <button onClick={handleBulkSkip} className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold">Mark Skipped</button>
                <button onClick={handleBulkDelete} className="px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-300 rounded text-xs font-semibold">Delete</button>
              </div>
            )}
          </div>

          {loadingTasks && (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-white/5 rounded animate-pulse" />)}</div>
          )}

          {!loadingTasks && tasks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-slate-500">No tasks yet. Paste a spec above and decompose it with AI.</p>
            </div>
          )}

          {!loadingTasks && tasks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-4 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === tasks.length && tasks.length > 0}
                        onChange={toggleSelectAll}
                        className="accent-emerald-500"
                      />
                    </th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Title</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Description</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Priority</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Status</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Assignee</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Est. h</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => {
                    const pStyle = PRIORITY_STYLES[task.priority as Priority] ?? PRIORITY_STYLES.P3;
                    const isEditing = editingId === task.id;
                    return (
                      <tr
                        key={task.id}
                        className={`border-b border-white/5 border-l-2 ${pStyle.border} ${selectedIds.has(task.id) ? "bg-white/5" : "hover:bg-white/3"}`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelect(task.id)}
                            className="accent-emerald-500"
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {isEditing ? (
                            <input
                              value={editBuffer.title ?? ""}
                              onChange={e => setEditBuffer(b => ({ ...b, title: e.target.value }))}
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs"
                            />
                          ) : (
                            <span className="text-xs text-white">{task.title}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          {isEditing ? (
                            <input
                              value={editBuffer.description ?? ""}
                              onChange={e => setEditBuffer(b => ({ ...b, description: e.target.value }))}
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400 truncate block">{task.description}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <select
                              value={editBuffer.priority ?? task.priority}
                              onChange={e => setEditBuffer(b => ({ ...b, priority: e.target.value as Priority }))}
                              className="bg-slate-900 border border-white/10 rounded px-1 py-1 text-xs"
                            >
                              <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
                            </select>
                          ) : (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pStyle.badge}`}>{task.priority}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-medium ${task.status === "synced" ? "text-emerald-400" : task.status === "skipped" ? "text-slate-500" : "text-amber-400"}`}>
                            {task.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input
                              value={editBuffer.assignee ?? ""}
                              onChange={e => setEditBuffer(b => ({ ...b, assignee: e.target.value }))}
                              className="w-24 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400">{task.assignee ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input
                              type="number" min={0} step={0.5}
                              value={editBuffer.estimatedHours ?? ""}
                              onChange={e => setEditBuffer(b => ({ ...b, estimatedHours: parseFloat(e.target.value) || 0 }))}
                              className="w-14 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400">{task.estimatedHours ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEdit(task)}
                                  disabled={savingId === task.id}
                                  className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-[10px] font-semibold"
                                >
                                  {savingId === task.id ? "…" : "Save"}
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-2 py-0.5 text-slate-400 hover:text-white rounded text-[10px]"
                                >Cancel</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(task)}
                                  className="px-2 py-0.5 text-slate-400 hover:text-white rounded text-[10px] border border-white/5 hover:border-white/15"
                                >Edit</button>
                                <button
                                  onClick={() => deleteTask(task)}
                                  disabled={deletingId === task.id}
                                  className="px-2 py-0.5 text-rose-400 hover:text-rose-300 rounded text-[10px] border border-rose-500/20 hover:border-rose-500/40 disabled:opacity-50"
                                >
                                  {deletingId === task.id ? "…" : "Del"}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Bottom: Sync Console ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: Target Connector */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-300">Target Connector</h2>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 uppercase">Active Target</label>
                <select
                  value={activeTargetSystem}
                  onChange={e => setActiveTargetSystem(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-lg p-2 text-sm"
                >
                  {TARGET_SYSTEMS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5 mt-5">
                <span className={`w-2 h-2 rounded-full ${hasCycleIntegrations ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span className="text-[10px] text-slate-500">{hasCycleIntegrations ? "Connected" : "No integrations"}</span>
              </div>
            </div>

            {cycleIntegrations.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase">Detected Integrations</p>
                {cycleIntegrations.map((ci: any, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-400 bg-white/3 rounded px-2 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {ci.name ?? ci.type ?? "Integration"}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleSyncAll}
              disabled={syncingAll || pendingTasks.length === 0}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              {syncingAll ? "Syncing…" : `Sync All Pending (${pendingTasks.length})`}
            </button>

            {syncProgress && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{syncProgress.done} / {syncProgress.total} synced</span>
                  <span>{Math.round((syncProgress.done / syncProgress.total) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${(syncProgress.done / syncProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right: Sync Log */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-300">Sync Log</h2>
              <button
                onClick={async () => {
                  // Clear by marking all as acknowledged (set a flag)
                  setSyncLog([]);
                  telemetry.emit("sync_log_cleared", "info", {});
                }}
                className="text-[10px] text-slate-500 hover:text-slate-300 border border-white/5 px-2 py-0.5 rounded"
              >
                Clear Log
              </button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {syncLog.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">No sync records yet.</p>
              )}
              {syncLog.map(entry => (
                <div key={entry.id} className="flex items-center gap-2 px-3 py-2 bg-white/3 border border-white/5 rounded-lg">
                  <span className="text-[9px] text-slate-500 flex-shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-xs text-white flex-1 truncate">{entry.taskTitle}</span>
                  <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded flex-shrink-0">{entry.targetSystem}</span>
                  {entry.externalId && (
                    <span className="text-[9px] font-mono text-blue-400 flex-shrink-0">{entry.externalId}</span>
                  )}
                  <span className={`text-[9px] font-bold flex-shrink-0 ${entry.status === "synced" ? "text-emerald-400" : entry.status === "error" ? "text-rose-400" : "text-slate-400"}`}>
                    {entry.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Chat */}
        <div className="max-w-lg">
          <AgentChat
            agentName="Technical Documentation Writer"
            agentRole="Task Planning & Sync"
            steeringModes={backlogSteeringModes}
            defaultGreeting="Hello! I can decompose specifications into structured tasks, suggest priorities and estimates, or help plan your backlog sync. What would you like to work on?"
          />
        </div>
      </div>
    </div>
  );
}
