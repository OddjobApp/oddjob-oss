"use client";

import { usePathname } from "next/navigation";
import { MODULES } from "../../lib/modules";
import { ProxyLink } from "./ProxyLink";
import { CycleRunButton } from "./CycleRunButton";

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#09090b]/90 backdrop-blur supports-[backdrop-filter]:bg-[#09090b]/70">
      <nav className="max-w-7xl mx-auto flex items-center gap-4 px-4 sm:px-6 h-14">
        {/* Wordmark to home */}
        <ProxyLink
          href="/"
          className="flex items-center gap-2 shrink-0 text-white font-bold tracking-tight hover:opacity-80 transition-opacity"
        >
          <span className="text-[10px] font-bold rounded bg-blue-500/10 text-blue-300 px-1.5 py-1 leading-none">PB</span>
          <span className="hidden sm:inline text-sm">Sales Pipeline</span>
        </ProxyLink>

        {/* Screen tabs, horizontally scrollable on narrow widths */}
        <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {MODULES.map(({ href, icon, short }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <ProxyLink
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span className="text-sm leading-none">{icon}</span>
                  <span>{short}</span>
                </ProxyLink>
              </li>
            );
          })}
        </ul>
        <CycleRunButton />
      </nav>
    </header>
  );
}
