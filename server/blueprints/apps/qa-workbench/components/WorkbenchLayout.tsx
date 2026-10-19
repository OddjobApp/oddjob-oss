import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Activity, Laptop } from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
}

interface WorkbenchLayoutProps {
  children: React.ReactNode;
  title: string;
  section: string;
  activeTab: string;
  onTabChange: (id: any) => void;
  navItems: readonly NavItem[] | NavItem[];
  embedded?: boolean;
  missionName?: string;
  rightHeaderActions?: React.ReactNode;
}

export function WorkbenchLayout({
  children,
  title,
  section,
  activeTab,
  onTabChange,
  navItems,
  embedded,
  missionName,
  rightHeaderActions,
}: WorkbenchLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[var(--background)] text-[var(--foreground)] font-sans antialiased flex flex-col">
      {/* Platform Header */}
      <header className="h-16 border-b border-white/5 bg-zinc-950/40 backdrop-blur px-4 md:px-6 flex items-center justify-between z-40 sticky top-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase tracking-wider">
              {section}
            </span>
            <span className="text-zinc-600 font-mono text-xs">/</span>
            <h1 className="text-sm font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {rightHeaderActions}
          
          {embedded && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-[10px] text-emerald-400 font-mono">
              <Laptop className="w-3.5 h-3.5" />
              <span>EMBEDDED MODE</span>
            </div>
          )}
        </div>
      </header>

      {/* Embedded Mission Context Bar */}
      {embedded && missionName && (
        <div className="bg-rose-500/5 border-b border-rose-500/10 px-4 py-2 text-xs flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
          <span className="text-zinc-400">Linked to Mission:</span>
          <span className="text-white font-mono font-medium">{missionName}</span>
        </div>
      )}

      {/* Main Workspace Frame */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Navigation Sidebar Drawer */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="absolute inset-y-0 left-0 w-[min(240px,85vw)] border-r border-white/5 bg-zinc-950/95 backdrop-blur-sm flex flex-col z-30 shrink-0 overflow-y-auto md:relative md:bg-zinc-950/20"
            >
              <nav className="p-3 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                        isActive
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-lg shadow-rose-500/5"
                          : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Core Canvas Area */}
        <main className="min-w-0 flex-1 p-4 md:p-6 overflow-y-auto max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
