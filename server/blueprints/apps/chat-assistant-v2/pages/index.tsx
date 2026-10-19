import React, { useState } from 'react';
import { AIAgentChat } from '../../../../domain/core/ui/components/packaged/index.js';
import { ShieldCheck, Sparkles, Users } from 'lucide-react';

/**
 * ─── CHAT ASSEMBLY SLOTS ──────────────────────────────────────────────────────
 */
// @ts-ignore
const AGENT_NAME       = "{{AGENT_NAME}}";
// @ts-ignore
const INITIAL_MSG      = {{INITIAL_MESSAGES}};
// @ts-ignore
const SUGGESTED_PROMPTS = {{SUGGESTED_PROMPTS}};

/**
 * Glassmorphism surface: a translucent layer that adapts gracefully across
 * light and dark themes with glowing backdrop accents.
 */
const GLASSMORPHISM_SURFACE =
  "bg-card/70 dark:bg-white/[0.06] backdrop-blur-2xl backdrop-saturate-150 " +
  "border border-border/40 dark:border-white/10 ring-1 ring-inset ring-foreground/5 " +
  "shadow-[0_8px_40px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.45)] rounded-3xl";

export default function ChatAssistantPage() {
  const [activePersona, setActivePersona] = useState<string>(
    typeof AGENT_NAME === 'string' && !AGENT_NAME.startsWith('{{') ? AGENT_NAME : 'Governed Intelligence AI'
  );

  return (
    <div className="relative min-h-screen bg-background dark:bg-[#0a0a0f] text-foreground flex flex-col items-center justify-center p-4 md:p-6 overflow-hidden">
      {/* Dynamic ambient backdrops */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-primary/20 dark:bg-indigo-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-24 h-[32rem] w-[32rem] rounded-full bg-accent/20 dark:bg-fuchsia-500/20 blur-3xl"
      />

      {/* Governed Header Pill */}
      <header className="relative mb-4 flex items-center gap-3 px-4 py-1.5 rounded-full bg-muted/60 border border-border/50 text-xs font-medium text-muted-foreground backdrop-blur-md">
        <span className="flex items-center gap-1.5 text-primary font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          Swiss-Cheese Guardrail 5-Layer Active
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5 text-blue-500" />
          CREW Multi-Agent Ready
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Bayesian Trajectory Monitored
        </span>
      </header>

      {/* Main Glassmorphism Chat Container */}
      <main className={`relative w-full max-w-4xl p-4 md:p-6 ${GLASSMORPHISM_SURFACE}`}>
        <AIAgentChat
          personaName={activePersona}
          initialMessages={typeof INITIAL_MSG === 'object' ? INITIAL_MSG : undefined}
          suggestedPrompts={Array.isArray(SUGGESTED_PROMPTS) ? SUGGESTED_PROMPTS : undefined}
        />
      </main>
    </div>
  );
}

