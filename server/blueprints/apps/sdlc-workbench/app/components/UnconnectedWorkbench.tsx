"use client";
import React, { useState } from 'react';
import { requestCrewInput } from '../../lib/workbench-bridge';
export function UnconnectedWorkbench({ title }: { title: string }) {
  const [status, setStatus] = useState('');
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <p className="mt-4 text-slate-400">No live data source is configured for this workbench. Connect and verify a source before using it operationally.</p>
    <button className="mt-4 rounded border border-teal-500/40 px-4 py-2" disabled={status === 'Waiting for input…'} onClick={async () => {
      setStatus('Waiting for input…');
      try { const response = await requestCrewInput({ kind: 'question', title: `Configure ${title}`, fields: [{ key: 'source', label: 'Which data source and outcome should this workbench use?', required: true }] });
        setStatus(response.status === 'submitted' ? 'Requirements received. A verified adapter still needs to be configured; nothing was connected automatically.' : 'Request cancelled.');
      } catch (error) { setStatus((error as Error).message); }
    }}>Request setup input in CREW</button>
    {status && <p role="status" className="mt-3 text-slate-400">{status}</p>}
  </main>;
}
