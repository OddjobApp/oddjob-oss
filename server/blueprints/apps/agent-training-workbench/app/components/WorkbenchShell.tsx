'use client';

import React from 'react';
import { Home, ShieldCheck, Terminal, LayoutGrid } from 'lucide-react';

interface WorkbenchShellProps {
  children: React.ReactNode;
  title: string;
  tagline: string;
  badge?: string;
}

export function WorkbenchShell({ children, title, tagline, badge }: WorkbenchShellProps) {
  return (
    <div className="min-h-screen bg-[#070b12] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#070b12] to-[#04060b] text-white flex flex-col antialiased">
      {/* Platform Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Unified Logo Icon Wrapper */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-[1px] shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all duration-300">
              <div className="w-full h-full rounded-xl bg-slate-950 flex items-center justify-center">
                <LayoutGrid className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            
            {/* Divider */}
            <div className="h-6 w-[1px] bg-slate-800/60" />

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wide text-slate-200">{title}</span>
                {badge && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/25">
                    {badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">{tagline}</span>
            </div>
          </div>

          {/* Quick Navigation Links */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-lg transition-all duration-200" title="Home">
              <Home className="w-4 h-4" />
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-lg transition-all duration-200" title="Terminal">
              <Terminal className="w-4 h-4" />
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-lg transition-all duration-200" title="Governance">
              <ShieldCheck className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex-1 flex flex-col bg-slate-950/20 border border-slate-800/40 rounded-2xl overflow-hidden backdrop-blur-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
