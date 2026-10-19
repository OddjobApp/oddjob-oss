"use client";
import { useEffect, useState } from 'react';
import { records } from '../../lib/platform-client';
export default function DevOpsWorkbench() {
  const [data, setData] = useState<Record<string, any[]>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try { const collections = ['deployments', 'incidents', 'qa_workbench_quality_gates'];
      const results = await Promise.all(collections.map(async name => [name, await records.list(name)] as const));
      setData(Object.fromEntries(results));
    } catch (error) { setData({}); setError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><h1 className="text-2xl font-semibold">DevOps Workbench</h1>
    <p className="mt-3 text-slate-400">Persisted app records only. Repository health and deployment controls require a verified adapter.</p>
    <button disabled={loading} onClick={refresh} className="mt-3 rounded border px-3 py-2">{loading ? 'Loading…' : 'Refresh records'}</button>
    {error && <p role="alert">Records unavailable: {error}</p>}
    {Object.entries(data).map(([name, rows]) => <section key={name} className="mt-5 rounded border border-white/10 p-4"><h2>{name}</h2>
      {!rows.length ? <p>No records returned.</p> : rows.map((row, i) => <pre key={row._recordId ?? row.id ?? i} className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ id: row._recordId ?? row.id, status: row.status ?? row.result, commitSha: row.commitSha, timestamp: row.timestamp ?? row._createdAt }, null, 2)}</pre>)}
    </section>)}
  </main>;
}
