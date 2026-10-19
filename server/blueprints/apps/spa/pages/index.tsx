import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { IndustrialDashboardHero } from "@domain-ui/packaged/IndustrialDashboardHero";

// ── Layout shell — AI will replace with app-specific sidebar + pages ──────────

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Settings', href: '/settings' },
];

/**
 * ─── INDUSTRIAL ASSEMBLY SLOTS ────────────────────────────────────────────────
 * These tokens are injected by the App Forge Assembly Engine.
 */
// @ts-ignore
const APP_TITLE       = "{{APP_TITLE}}";
// @ts-ignore
const APP_SUBTITLE    = "{{APP_SUBTITLE}}";
// @ts-ignore
const HERO_STATS      = {{HERO_STATS}};
// @ts-ignore
const HERO_CHART_DATA = {{HERO_CHART_DATA}};

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} transition-all duration-200 flex flex-col bg-white/5 border-r border-white/10`}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          {sidebarOpen && <span className="font-bold text-sm tracking-wide">App</span>}
          <button onClick={() => setSidebarOpen(p => !p)} className="text-white/40 hover:text-white text-xs">☰</button>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(item => (
            <Link key={item.href} href={item.href} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors">
              {sidebarOpen && item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {/* Industrial Dashboard Hero Injected Layer */}
          <div className="mb-8">
            <IndustrialDashboardHero 
              title={APP_TITLE}
              subtitle={APP_SUBTITLE}
              stats={HERO_STATS}
              data={HERO_CHART_DATA}
            />
          </div>

          <h1 className="text-3xl font-black tracking-tight mb-2">Welcome</h1>
          <p className="text-white/50 text-sm mb-8">Your application content goes here.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['Feature A', 'Feature B', 'Feature C'].map((f, i) => (
              <motion.div key={f} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="font-bold mb-1">{f}</h3>
                <p className="text-white/40 text-xs">Placeholder section — AI will populate this.</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
