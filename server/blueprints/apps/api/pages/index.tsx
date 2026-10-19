import React, { useState } from 'react';
import { motion } from 'framer-motion';

// ── Headless API blueprint — AI will generate domain-specific routes ───────────
// This index.tsx is a lightweight API Explorer / docs UI.
// The real value of this blueprint is in pages/api/*.ts — NOT this page.

interface RouteDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  body?: string;
  response?: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  POST:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PUT:    'bg-amber-500/20 text-amber-400 border-amber-500/30',
  DELETE: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  PATCH:  'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const EXAMPLE_ROUTES: RouteDoc[] = [
  { method: 'GET',    path: '/api/items',       description: 'List all items',             response: '{ items: Item[] }' },
  { method: 'POST',   path: '/api/items',       description: 'Create a new item',          body: '{ name, description }', response: '{ item: Item }' },
  { method: 'GET',    path: '/api/items/[id]',  description: 'Get a single item by ID',    response: '{ item: Item }' },
  { method: 'PUT',    path: '/api/items/[id]',  description: 'Update an item',             body: '{ name?, description? }', response: '{ item: Item }' },
  { method: 'DELETE', path: '/api/items/[id]',  description: 'Delete an item',             response: '{ success: true }' },
];

export default function ApiExplorer() {
  const [selected, setSelected] = useState<RouteDoc | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const runTest = async (route: RouteDoc) => {
    if (route.method !== 'GET') { setTestResult('Only GET requests can be tested from the explorer.'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(route.path.replace('/[id]', '/1'));
      const data = await res.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-mono">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black tracking-tight">API Explorer</h1>
          <p className="text-xs text-white/40 mt-0.5">Platform-native REST API</p>
        </div>
        <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">Live</span>
      </header>
      <div className="flex h-[calc(100vh-65px)]">
        <aside className="w-72 border-r border-white/10 overflow-y-auto p-4 space-y-1">
          {EXAMPLE_ROUTES.map((r, i) => (
            <motion.button key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              onClick={() => { setSelected(r); setTestResult(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${selected === r ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${METHOD_COLORS[r.method]}`}>{r.method}</span>
              <span className="text-xs text-white/70 truncate">{r.path}</span>
            </motion.button>
          ))}
        </aside>
        <main className="flex-1 p-8 overflow-y-auto">
          {selected ? (
            <motion.div key={selected.path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 max-w-2xl">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black px-2 py-1 rounded border ${METHOD_COLORS[selected.method]}`}>{selected.method}</span>
                <code className="text-white font-bold">{selected.path}</code>
              </div>
              <p className="text-white/60 text-sm">{selected.description}</p>
              {selected.body && (
                <div><p className="text-xs text-white/40 uppercase tracking-widest mb-2">Request Body</p>
                  <pre className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-emerald-400">{selected.body}</pre></div>
              )}
              <div><p className="text-xs text-white/40 uppercase tracking-widest mb-2">Response</p>
                <pre className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-blue-400">{selected.response}</pre></div>
              <button onClick={() => runTest(selected)} disabled={testing}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors">
                {testing ? 'Testing…' : 'Run Test'}
              </button>
              {testResult && <pre className="bg-black/40 border border-white/10 rounded-xl p-4 text-xs text-white/70 whitespace-pre-wrap">{testResult}</pre>}
            </motion.div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/20 text-sm">Select a route to inspect</div>
          )}
        </main>
      </div>
    </div>
  );
}
