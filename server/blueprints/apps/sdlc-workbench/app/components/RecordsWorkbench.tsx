"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { records, type AppRecord } from "../../lib/platform-client";
import { requestCrewInput } from "../../lib/crew-sdk";

export interface WorkbenchField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export interface RecordsWorkbenchConfig {
  title: string;
  description: string;
  /** app_records collection this workbench reads and writes. */
  collection: string;
  /** Fields rendered in the create form; also used as table columns. */
  fields: WorkbenchField[];
  /** Field that carries the record's workflow state (e.g. "stage", "status"). */
  statusField?: string;
  /** Ordered states — renders an "Advance" action that moves a record forward. */
  statusOrder?: string[];
  /** Question asked of CREW when the user chooses "Discuss in CREW". */
  crewPrompt: string;
}

function cellValue(record: AppRecord, key: string): string {
  const value = record[key];
  if (value == null || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RecordsWorkbench({ config }: { config: RecordsWorkbenchConfig }) {
  const [rows, setRows] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [crewStatus, setCrewStatus] = useState("");
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await records.list(config.collection)); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [config.collection]);

  useEffect(() => { void refresh(); }, [refresh]);

  const statusCounts = useMemo(() => {
    if (!config.statusField) return [] as Array<[string, number]>;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const status = cellValue(row, config.statusField);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const order = config.statusOrder ?? [];
    return [...counts.entries()].sort((a, b) => {
      const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0]);
      if (ai === -1 && bi === -1) return b[1] - a[1];
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    });
  }, [rows, config.statusField, config.statusOrder]);

  const nextStatus = (record: AppRecord): string | null => {
    if (!config.statusField || !config.statusOrder?.length) return null;
    const idx = config.statusOrder.indexOf(cellValue(record, config.statusField));
    if (idx === -1) return config.statusOrder[0];
    return idx < config.statusOrder.length - 1 ? config.statusOrder[idx + 1] : null;
  };

  const advance = async (record: AppRecord) => {
    const next = nextStatus(record);
    if (!next || !config.statusField) return;
    setAdvancingId(String(record.id)); setError(null);
    try {
      await records.update(config.collection, String(record.id), {
        [config.statusField]: next,
        updatedAt: new Date().toISOString(),
      });
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setAdvancingId(null); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const data: Record<string, unknown> = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      for (const field of config.fields) {
        const raw = (draft[field.key] ?? "").trim();
        if (field.required && !raw) throw new Error(`${field.label} is required`);
        if (!raw) continue;
        data[field.key] = field.type === "number" ? Number(raw) : raw;
      }
      if (config.statusField && data[config.statusField] == null && config.statusOrder?.length) {
        data[config.statusField] = config.statusOrder[0];
      }
      await records.create(config.collection, data);
      setDraft({}); setShowForm(false);
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };

  const discuss = async () => {
    setCrewStatus("Waiting for input…");
    try {
      const response = await requestCrewInput({
        kind: "question",
        title: config.crewPrompt,
        fields: [{ key: "question", label: "What should the crew investigate or decide?", required: true }],
      });
      setCrewStatus(response.status === "submitted" ? "Sent to CREW." : "Request cancelled.");
    } catch (err) { setCrewStatus((err as Error).message); }
  };

  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{config.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{config.description}</p>
      </div>
      <div className="flex gap-2">
        <button className="rounded border border-white/10 px-3 py-1.5 text-sm" disabled={loading} onClick={() => void refresh()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button className="rounded border border-teal-500/40 px-3 py-1.5 text-sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close form" : "New record"}
        </button>
        <button className="rounded border border-teal-500/40 px-3 py-1.5 text-sm" onClick={() => void discuss()}>
          Discuss in CREW
        </button>
      </div>
    </div>

    {crewStatus && <p role="status" className="mt-2 text-xs text-slate-400">{crewStatus}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-400">Records unavailable: {error}</p>}

    <div className="mt-4 flex flex-wrap gap-3">
      <div className="rounded border border-white/10 px-4 py-2">
        <div className="text-xl font-semibold">{loading ? "…" : rows.length}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">records</div>
      </div>
      {statusCounts.map(([status, count]) => <div key={status} className="rounded border border-white/10 px-4 py-2">
        <div className="text-xl font-semibold">{count}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{status}</div>
      </div>)}
    </div>

    {showForm && <form onSubmit={(e) => void submit(e)} className="mt-4 grid max-w-3xl grid-cols-1 gap-3 rounded border border-teal-500/30 p-4 sm:grid-cols-2">
      {config.fields.map((field) => <label key={field.key} className="flex flex-col gap-1 text-xs text-slate-400">
        {field.label}{field.required ? " *" : ""}
        {field.type === "select"
          ? <select className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100" value={draft[field.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}>
              <option value="">—</option>
              {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          : <input className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100" type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} step={field.type === "number" ? "any" : undefined} placeholder={field.placeholder} value={draft[field.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))} />}
      </label>)}
      <div className="sm:col-span-2">
        <button type="submit" disabled={saving} className="rounded border border-teal-500/40 px-4 py-1.5 text-sm">
          {saving ? "Saving…" : `Save to ${config.collection}`}
        </button>
      </div>
    </form>}

    <section className="mt-5 overflow-x-auto rounded border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            {config.fields.map((field) => <th key={field.key} className="px-3 py-2">{field.label}</th>)}
            <th className="px-3 py-2">Updated</th>
            {config.statusOrder ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {!loading && !rows.length && <tr><td colSpan={config.fields.length + 2} className="px-3 py-6 text-center text-slate-500">
            No records in <code>{config.collection}</code> yet — create the first one above.
          </td></tr>}
          {rows.map((row, i) => {
            const next = nextStatus(row);
            return <tr key={String(row.id ?? row._recordId ?? i)} className="border-b border-white/5 hover:bg-white/5">
              {config.fields.map((field) => <td key={field.key} className="px-3 py-2">
                {field.key === config.statusField
                  ? <span className="rounded border border-teal-500/30 px-2 py-0.5 text-xs">{cellValue(row, field.key)}</span>
                  : cellValue(row, field.key)}
              </td>)}
              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{String(row._updatedAt ?? row.updatedAt ?? "—").slice(0, 10)}</td>
              {config.statusOrder ? <td className="px-3 py-2">
                {next && <button className="rounded border border-white/10 px-2 py-0.5 text-xs disabled:opacity-40" disabled={advancingId === String(row.id)} onClick={() => void advance(row)}>
                  {advancingId === String(row.id) ? "…" : `→ ${next}`}
                </button>}
              </td> : null}
            </tr>;
          })}
        </tbody>
      </table>
    </section>
  </main>;
}
