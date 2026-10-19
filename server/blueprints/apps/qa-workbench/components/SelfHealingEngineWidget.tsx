import React, { useState } from 'react';
import { Bot, CheckCircle2, XCircle, AlertTriangle, Play, Sparkles } from 'lucide-react';

interface FlakyTest {
  id: string;
  testName: string;
  filePath: string;
  failureRate: number;
  lastError: string;
  status: 'detecting' | 'analyzing' | 'fix_ready' | 'healed';
  diff?: { original: string; proposed: string };
}

export function SelfHealingEngineWidget() {
  const [tests, setTests] = useState<FlakyTest[]>([
    {
      id: "t1",
      testName: "should render the user profile dashboard",
      filePath: "tests/e2e/profile.spec.ts",
      failureRate: 34,
      lastError: "Timeout exceeding 5000ms waiting for locator('.user-avatar')",
      status: 'fix_ready',
      diff: {
        original: "await expect(page.locator('.user-avatar')).toBeVisible();",
        proposed: "// Healer: Avatar loads async after API call, increased timeout\nawait expect(page.locator('.user-avatar')).toBeVisible({ timeout: 15000 });"
      }
    },
    {
      id: "t2",
      testName: "API /v1/checkout returns 200",
      filePath: "tests/api/checkout.spec.ts",
      failureRate: 12,
      lastError: "Expected 200 but received 429 Too Many Requests",
      status: 'analyzing'
    }
  ]);

  const [activeTest, setActiveTest] = useState<string | null>("t1");

  const healTest = (id: string) => {
    setTests(tests.map(t => t.id === id ? { ...t, status: 'healed' } : t));
  };

  return (
    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h3 className="text-lg font-bold text-slate-200">Self-Healing Test Engine</h3>
        </div>
        <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold rounded uppercase tracking-widest">
          Active Watch
        </span>
      </div>
      
      <p className="text-xs text-indigo-200/70 mb-4">
        The QA agent monitors test runs for flakiness, analyzes DOM/API changes, and proposes automated fixes to assertions.
      </p>

      <div className="space-y-3">
        {tests.map(test => (
          <div key={test.id} className="bg-[#050707] border border-white/5 rounded-lg overflow-hidden">
            <button 
              onClick={() => setActiveTest(activeTest === test.id ? null : test.id)}
              className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                {test.status === 'healed' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : test.status === 'fix_ready' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                ) : (
                  <Bot className="w-5 h-5 text-blue-400 animate-pulse" />
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-200">{test.testName}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{test.filePath}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-slate-500">Failure Rate</div>
                <div className="text-sm font-bold text-amber-400">{test.failureRate}%</div>
              </div>
            </button>
            
            {activeTest === test.id && (
              <div className="px-4 pb-4 border-t border-white/5 pt-3 bg-white/[0.02]">
                <div className="mb-3 text-xs">
                  <span className="text-slate-500 font-semibold uppercase tracking-wider">Latest Error:</span>
                  <div className="text-rose-400 font-mono mt-1 p-2 bg-rose-500/10 rounded border border-rose-500/20">
                    {test.lastError}
                  </div>
                </div>

                {test.status === 'analyzing' && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 p-2 bg-blue-500/10 rounded">
                    <Bot className="w-4 h-4 animate-spin" /> QA Agent analyzing test logs and recent commits...
                  </div>
                )}

                {test.diff && test.status !== 'healed' && (
                  <div>
                    <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px] mb-1 block">Proposed Patch</span>
                    <div className="text-[10px] font-mono whitespace-pre overflow-x-auto bg-[#0d1117] border border-white/10 rounded-lg p-3">
                      <div className="text-rose-300 bg-rose-500/10 border-l-2 border-rose-500 pl-2">- {test.diff.original}</div>
                      {test.diff.proposed.split('\n').map((line, i) => (
                        <div key={i} className="text-emerald-300 bg-emerald-500/10 border-l-2 border-emerald-500 pl-2">+ {line}</div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button 
                        onClick={() => healTest(test.id)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-indigo-900/20 transition-colors flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Apply Self-Healing Patch
                      </button>
                    </div>
                  </div>
                )}
                
                {test.status === 'healed' && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 p-2 bg-emerald-500/10 rounded border border-emerald-500/20">
                    <CheckCircle2 className="w-4 h-4" /> Patch successfully applied to repository. Test will run in next CI cycle.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
