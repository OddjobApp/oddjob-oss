/**
 * Chat Assistant Blueprint v2 - Mach 4 Platform Block Edition
 * Uses self-wiring PlatformAgentChatBlock for SSE streaming — zero fetch/code
 */

// ─── PLATFORM BLOCK IMPORTS ─────────────────────────────────────────────────
// These are auto-wired to Oddjob APIs — zero fetch/state code required
import dynamic from "next/dynamic";
import { IndustrialDashboardHero } from "@domain-ui/packaged/IndustrialDashboardHero";

const PlatformAgentChatBlock = dynamic(
  () => import("@domain-ui/packaged/PlatformAgentChatBlock"),
  { ssr: false }
);

/**
 * ─── SLOT: Domain Configuration ───────────────────────────────────────────────
 * These tokens are injected by the App Forge Architect during Assembly.
 */
const APP_TITLE        = "{{APP_TITLE}}";
const AGENT_ID         = typeof Number("{{AGENT_ID}}") === 'number' && !isNaN(Number("{{AGENT_ID}}")) ? Number("{{AGENT_ID}}") : 1;
const PERSONA_NAME     = "{{PERSONA_NAME}}";

// @ts-ignore - Injected by forge during assembly
const SUGGESTED_PROMPTS: string[] = ["What can you help me with?", "Show telemetry overview"];
// @ts-ignore - Injected by forge during assembly  
const COLLECTION_NAME: string = "{{COLLECTION_NAME}}";
// @ts-ignore
const HERO_STATS      = [];
// @ts-ignore
const HERO_CHART_DATA = [];

export default function ChatAssistant() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans flex flex-col">
      {/* Optional Dashboard Hero for context before chat */}
      <IndustrialDashboardHero 
        title={APP_TITLE}
        subtitle={`Chat with ${PERSONA_NAME}`}
        stats={HERO_STATS}
        data={HERO_CHART_DATA}
      />

      {/* Full Chat Interface - Self-wiring Platform Block */}
      <div className="flex-1 relative mt-4">
        <PlatformAgentChatBlock
          agentId={AGENT_ID}
          personaName={PERSONA_NAME || "AI Assistant"}
          suggestedPrompts={SUGGESTED_PROMPTS || [
            "What can you help me with?",
            "Summarize the key features of this app",
            "How do I get started?",
            "Show me an example"
          ]}
          collectionName={COLLECTION_NAME}
          height="100%"
        />
      </div>
    </div>
  );
}
