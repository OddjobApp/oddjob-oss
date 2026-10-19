"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";

// ─── Module definitions ─────────────────────────────────────────────────────────

const MODULES = [
  {
    href: "/ingestion-hub",
    icon: "🔬",
    label: "Ingestion Hub",
    accent: "text-blue-400",
    activeBg: "bg-blue-500/15 border-blue-500/40 text-blue-300",
  },
  {
    href: "/decision-panel",
    icon: "⚖️",
    label: "Decision Panel",
    accent: "text-violet-400",
    activeBg: "bg-violet-500/15 border-violet-500/40 text-violet-300",
  },
  {
    href: "/draft-sandbox",
    icon: "✍️",
    label: "Draft Sandbox",
    accent: "text-slate-200",
    activeBg: "bg-white/10 border-white/30 text-white",
  },
  {
    href: "/memory-library",
    icon: "🗄️",
    label: "Memory Library",
    accent: "text-teal-400",
    activeBg: "bg-teal-500/15 border-teal-500/40 text-teal-300",
  },
  {
    href: "/backlog-provisioner",
    icon: "📋",
    label: "Backlog Provisioner",
    accent: "text-amber-400",
    activeBg: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  },
];

// ─── Layout Shell ───────────────────────────────────────────────────────────────

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const [basePath, setBasePath] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const match = window.location.pathname.match(/^(\/app\/[a-z0-9][a-z0-9-]*[a-z0-9])/i);
      if (match) {
        setBasePath(match[1]);
      }
    }
  }, []);

  const resolveHref = (moduleHref: string) => `${basePath}${moduleHref}`;

  const relativePath = basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;

  return (
    <div className="flex flex-col min-h-screen bg-[#090d16] text-white">
      {/* Top Navigation Tab Bar */}
      <header className="sticky top-0 z-40 bg-[#0b0f1a]/95 backdrop-blur-md border-b border-white/10 px-4 py-2 flex items-center justify-between gap-3 overflow-x-auto shrink-0">
        {/* Home / Brand Link */}
        <Link
          href={resolveHref("/")}
          className="flex items-center gap-2 px-2 py-1 rounded-lg text-white font-bold text-xs hover:bg-white/5 shrink-0 transition-colors"
          title="Research Platform Home"
        >
          <span className="text-base">🔭</span>
          <span className="text-xs font-bold text-white tracking-wide">Research Platform</span>
        </Link>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none">
          {MODULES.map((mod) => {
            const isActive = relativePath === mod.href || relativePath.startsWith(mod.href + "/");

            return (
              <Link
                key={mod.href}
                href={resolveHref(mod.href)}
                title={mod.label}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-all duration-150 border ${
                  isActive
                    ? `${mod.activeBg} shadow-sm`
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}
              >
                <span className="text-sm leading-none">{mod.icon}</span>
                <span>{mod.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full min-w-0">
        {children}
      </main>
    </div>
  );
}
