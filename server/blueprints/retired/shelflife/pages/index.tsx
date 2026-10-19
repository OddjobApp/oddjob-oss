import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Shield, Zap, AlertTriangle, Coffee } from 'lucide-react';
import { 
  IndustrialDashboardHero, 
  MetricGrid, 
  StatusTimeline, 
  MissionControlTable 
} from '../../../../domain/core/ui/components/packaged/index.js';

/**
 * ─── SHELFLIFE FLAGSHIP DASHBOARD (MACH 4.0 ASSEMBLY) ──────────────────────
 * Engineered for Deterministic Wow Performance.
 */

const APP_TITLE = "ShelfLife";
const APP_SUBTITLE = "The kinetic command center for your kitchen.";

export default function ShelfLifeDashboard() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  // Mock Data (Hydrated via Assembly Tokens in real Forge Run)
  const stats = [
    { label: "Fridge Health", value: "88%", change: 5, trend: 'up', icon: 'shield' },
    { label: "Food Saved", value: "$124", change: 12, trend: 'up', icon: 'zap' },
    { label: "Expiring Soon", value: "4 Items", change: -2, trend: 'down', icon: 'activity' }
  ];

  const chartData = [
    { name: 'Mon', value: 400 }, { name: 'Tue', value: 300 }, { name: 'Wed', value: 600 },
    { name: 'Thu', value: 800 }, { name: 'Fri', value: 500 }, { name: 'Sat', value: 900 },
    { name: 'Sun', value: 1100 },
  ];

  const metrics = [
    { label: "Milk", value: "1 Day Remaining", status: "error" },
    { label: "Spinach", value: "Today", status: "error" },
    { label: "Eggs", value: "4 Days Remaining", status: "success" },
    { label: "Greek Yogurt", value: "2 Days Remaining", status: "warning" }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-12 space-y-12 animate-pulse">
        <div className="h-64 bg-white/5 rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white/5 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="min-h-screen bg-[#0a0a0f] text-white p-6 md:p-12 space-y-12 selection:bg-emerald-500/30"
      >
        {/* Main Command Hero */}
        <IndustrialDashboardHero 
          title={APP_TITLE}
          subtitle={APP_SUBTITLE}
          stats={stats}
          data={chartData}
        />

        {/* Heat Map Visualization */}
        <motion.section 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
          <div className="flex items-center space-x-2">
             <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
             <h2 className="text-sm font-black tracking-[0.2em] text-white/40 uppercase">Critical Expiration Telemetry</h2>
          </div>
          
          <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.05] p-1 rounded-2xl">
            <MetricGrid metrics={metrics} columns={4} />
          </div>
        </motion.section>

        {/* Inventory & Event Logging */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-2"
          >
             <MissionControlTable 
               title="Food Inventory (Postgres Live)"
               collection="food_inventory"
               columns={[
                 { field: 'name', header: 'Resource' },
                 { field: 'expiry_date', header: 'SLA / Expiry' },
                 { field: 'location', header: 'Storage Node' },
                 { field: 'status', header: 'Health' }
               ]}
             />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
          >
            <StatusTimeline 
              title="Operational Event Log"
              events={[
                { time: "09:00 AM", event: "Milk telemetry: Expiry threshold breached.", status: "error" },
                { time: "11:32 AM", event: "Inventory Update: +12 Eggs (Node: Fridge)", status: "info" }
              ]}
            />
          </motion.div>
        </div>

        {/* Technical Footer */}
        <footer className="pt-12 border-t border-white/[0.05] flex justify-between items-center text-[10px] font-mono text-white/20 uppercase tracking-widest">
           <div>Engine: Mach 4.0 Assembly</div>
           <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> System Nominal</span>
              <span>ShelfLife v1.0.4-Alpha</span>
           </div>
        </footer>
      </motion.div>
    </AnimatePresence>
  );
}
