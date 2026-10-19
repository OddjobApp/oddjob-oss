import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { startTutorial } from "@/lib/tutorial-engine";
import {
  Rocket,
  Search,
  Sparkles,
  Layers,
  Bot,
  Play,
  FileText,
  Database,
  ArrowRight,
  ExternalLink,
  Activity,
  CheckCircle2,
  Clock,
  Plus,
  Zap,
  LayoutGrid,
  Scan,
  ShieldCheck,
  Cpu,
  X,
  ChevronRight,
  Command,
  Pin,
  PinOff,
  Film,
  Siren,
  Radio,
  Fingerprint,
  Globe,
  Monitor,
  RotateCcw,
  Loader2,
  Lock,
  MousePointer,
  History,
  Building2,
  UserCheck,
  Server,
  Maximize2,
  Pause,
  Send,
  Eye,
  Filter,
  ArrowLeft
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";

const COMPUTER_USE_STEPS = [
  {
    step: 1,
    title: "Booting Virtual Desktop (Micro-VM & Browser Initialization)",
    badge: "Trycua Sandbox",
    description: "Spawning isolated Linux micro-VM container and waiting for virtual X11 display :99, noVNC bridge, and Chromium browser to initialize at http://localhost:5000/app/acme-ops-command-00y63.",
    details: "Display :99 • Viewport: 1920x1080 • Proxy: Isolated Tenant Network • Anti-fingerprint enabled",
    code: `const session = await trycua.createSession({
  orgId: currentOrgId,
  url: "http://localhost:5000/app/acme-ops-command-00y63",
  browser: "chromium"
});
await session.waitForDesktopReady({ timeoutMs: 30000 });`
  },
  {
    step: 2,
    title: "Multi-Page Customer Browsing & Organic Dwell (Home & Solutions)",
    badge: "S.C.O.R.E. Engine",
    description: "Gemini Computer Use reads page DOM, moves cursor across navigation, dwells on SLA telemetry, and navigates to Enterprise Solutions.",
    details: "Dwell time: 4.2s • Scroll depth: 65% • Pages: / -> /solutions/enterprise • Decayed vectors initialized",
    code: `await computerUse.executeActions([
  { action: "mouse_move", x: 280, y: 110, durationMs: 1200 },
  { action: "hover", target: "Enterprise Architecture" },
  { action: "click", target: "nav#solutions" }
]);`
  },
  {
    step: 3,
    title: "Tier Quota Evaluation & Pricing Calculator Interaction",
    badge: "High-Intent Signal",
    description: "Agent inspects pricing tiers, clicks the Enterprise Dedicated Cluster ($120k/yr) tier card, elevating S.C.O.R.E. Budget & Authority vectors.",
    details: "Tier selected: Enterprise Dedicated ($120,000/yr) • S.C.O.R.E. Budget jump: +7.4 • Need: +8.2",
    code: `await computerUse.executeActions([
  { action: "mouse_move", x: 390, y: 140, durationMs: 900 },
  { action: "click", target: ".pricing-tier-card[data-tier='enterprise']" },
  { action: "click", target: "button#request-access" }
]);`
  },
  {
    step: 4,
    title: "Deployed Form Builder Intake & Live Identity Resolution",
    badge: "Form Studio Runner",
    description: "Agent enters Sarah Chen's enterprise credentials into the deployed Form Builder and submits, executing window.OddjobProspector.identify().",
    details: "Lead: Sarah Chen • Role: VP Engineering • Company: Vertex Financial • Email: sarah.chen@vertex.io",
    code: `await computerUse.executeActions([
  { action: "type", target: "input#form-name", text: "Sarah Chen" },
  { action: "type", target: "input#form-email", text: "sarah.chen@vertex.io" },
  { action: "type", target: "input#form-role", text: "VP of Engineering" },
  { action: "type", target: "input#form-company", text: "Vertex Financial Systems" },
  { action: "click", target: "button#submit-inquiry" }
]);`
  },
  {
    step: 5,
    title: "ACID Merge, Kafka Outbox Relay & Autonomous CREW Handoff",
    badge: "Kafka spatial.signal.v1",
    description: "Identity Bridge merges anonymous browsing history into authenticated account, writes to transactional outbox, and alerts CREW SDR agent.",
    details: "Master UID: usr_vertex_sarah_chen • Events merged: 5 • Topic: spatial.signal.v1 • Status: PUBLISHED",
    code: `await enqueueKafkaEvent(tx, {
  eventType: "spatial.signal.v1",
  type: "observation",
  subject: "prospect:usr_vertex_sarah_chen",
  payload: { eventType: "identity.resolved", severity: "info", account: "Vertex Financial" }
});`
  }
];

export default function CommandLaunchpadPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Pinned Apps state with LocalStorage persistence
  const [pinnedAppSlugs, setPinnedAppSlugs] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("oddjob_pinned_app_slugs");
      return saved ? JSON.parse(saved) : ["rescue-dispatch", "codegen-pipeline-workbench", "budgetmaster-workbench", "film-studio"];
    } catch {
      return ["rescue-dispatch", "codegen-pipeline-workbench", "budgetmaster-workbench", "film-studio"];
    }
  });

  const togglePinApp = (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedAppSlugs((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      try {
        localStorage.setItem("oddjob_pinned_app_slugs", JSON.stringify(next));
      } catch (err) {
        console.error("Failed to save pinned apps:", err);
      }
      return next;
    });
  };

  // Agent execution modal state
  const [selectedAgentForModal, setSelectedAgentForModal] = useState<any | null>(null);
  const [agentInstruction, setAgentInstruction] = useState("");
  const [isExecutingAgent, setIsExecutingAgent] = useState(false);
  const [agentExecutionResult, setAgentExecutionResult] = useState<string | null>(null);

  // Computer Use Simulation State & Controls
  const [isComputerUseDemoOpen, setIsComputerUseDemoOpen] = useState(false);
  const [computerUseStep, setComputerUseStep] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState<1 | 2>(1);
  const [computerBootProgress, setComputerBootProgress] = useState(0);
  const [computerLoaded, setComputerLoaded] = useState(false);
  const [computerBootLogs, setComputerBootLogs] = useState<string[]>([]);
  const [virtualCursor, setVirtualCursor] = useState({ x: 180, y: 60, clicking: false, label: "Idle" });
  const [activeHoverElement, setActiveHoverElement] = useState<string | null>(null);
  const [virtualFormTyped, setVirtualFormTyped] = useState({
    name: "",
    email: "",
    role: "",
    company: "",
    tier: "Enterprise Dedicated ($120k/yr)",
    notes: ""
  });
  const [activeVirtualPage, setActiveVirtualPage] = useState<"home" | "solutions" | "pricing" | "form" | "confirmed">("home");
  const [selectedPricingTier, setSelectedPricingTier] = useState<"starter" | "growth" | "enterprise">("growth");
  const [pageHistory, setPageHistory] = useState<Array<{
    id: string;
    seq: number;
    time: string;
    url: string;
    action: string;
    category: "page" | "interaction" | "signal";
    dwell: string;
    scoreDelta: string;
    note: string;
  }>>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "page" | "interaction" | "signal">("all");
  const [historySearch, setHistorySearch] = useState("");

  const simulationSpeedRef = React.useRef(simulationSpeed);
  simulationSpeedRef.current = simulationSpeed;
  const simulationCancelledRef = React.useRef(false);

  const { data: prospectingProperties = [] } = useQuery<any[]>({
    queryKey: ["/api/prospecting/properties"],
  });

  // Auto-launch simulation if identity-bridge tutorial is dispatched
  React.useEffect(() => {
    const handleTutorialStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const id = typeof detail === "string" ? detail : detail?.id;
      if (id === "identity-bridge-tour" || id === "chain:identity-bridge") {
        if (!isSimulating && computerUseStep === 0) {
          void runComputerUseSimulation();
        }
      }
    };
    window.addEventListener("oddjob:start-tutorial", handleTutorialStart);
    return () => window.removeEventListener("oddjob:start-tutorial", handleTutorialStart);
  }, [isSimulating, computerUseStep]);

  const runComputerUseSimulation = async () => {
    simulationCancelledRef.current = false;
    setIsSimulating(true);
    setComputerUseStep(1);
    setComputerLoaded(false);
    setComputerBootProgress(0);
    setComputerBootLogs(["[0.0s] [CONTAINER] Initializing isolated micro-VM sandbox container (Trycua/Ubuntu 22.04 LTS)..."]);
    setVirtualCursor({ x: 180, y: 60, clicking: false, label: "Booting Virtual Desktop" });
    setActiveHoverElement(null);
    setVirtualFormTyped({ name: "", email: "", role: "", company: "", tier: "Enterprise Dedicated ($120k/yr)", notes: "" });
    setActiveVirtualPage("home");
    setSelectedPricingTier("growth");
    setPageHistory([]);

    const sessionUid = "anon_session_" + Math.random().toString(36).substring(2, 9);
    const propUid = (prospectingProperties as any[])[0]?.uid || "prp_c3cdec43-b853-4f8a-9660-a92b9f05e003";

    const delay = (ms: number) =>
      new Promise((r) => setTimeout(r, ms / (simulationSpeedRef.current || 1)));

    const recordHistory = (entry: {
      time: string;
      url: string;
      action: string;
      category: "page" | "interaction" | "signal";
      dwell: string;
      scoreDelta: string;
      note: string;
    }) => {
      setPageHistory((prev) => [
        ...prev,
        {
          ...entry,
          seq: prev.length + 1,
          id: "ev_" + Math.random().toString(36).substring(2, 7),
        },
      ]);
    };

    const glideMouse = async (
      waypoints: Array<{ x: number; y: number; label: string; hover?: string; dwellMs: number }>
    ) => {
      for (const wp of waypoints) {
        if (simulationCancelledRef.current) return;
        setVirtualCursor({ x: wp.x, y: wp.y, clicking: false, label: wp.label });
        setActiveHoverElement(wp.hover || null);
        await delay(wp.dwellMs);
      }
    };

    const clickMouse = async (label: string, dwellMs = 450) => {
      if (simulationCancelledRef.current) return;
      setVirtualCursor((prev) => ({ ...prev, clicking: true, label }));
      await delay(dwellMs);
      if (simulationCancelledRef.current) return;
      setVirtualCursor((prev) => ({ ...prev, clicking: false }));
    };

    const typeVirtualField = async (
      field: "name" | "email" | "role" | "company",
      fullText: string
    ) => {
      for (let i = 0; i <= fullText.length; i++) {
        if (simulationCancelledRef.current) return;
        setVirtualFormTyped((prev) => ({ ...prev, [field]: fullText.substring(0, i) }));
        await delay(65 + Math.random() * 40);
      }
      await delay(350);
    };

    // Stage 1: Sandbox Boot Sequence (Paced realistically)
    await delay(800);
    setComputerBootProgress(25);
    setComputerBootLogs((prev) => [...prev, "[0.8s] [X11 DISPLAY] Starting virtual framebuffer on :99 (1920x1080x24)..."]);

    await delay(900);
    setComputerBootProgress(55);
    setComputerBootLogs((prev) => [...prev, "[1.7s] [GATEWAY] noVNC WebSocket bridge connected at 127.0.0.1:6080..."]);

    await delay(1000);
    setComputerBootProgress(85);
    setComputerBootLogs((prev) => [...prev, "[2.7s] [BROWSER] Spawning Chromium; loading http://localhost:5000/app/acme-ops-command-00y63..."]);

    await delay(900);
    setComputerBootProgress(100);
    setComputerBootLogs((prev) => [...prev, "[3.6s] [READY] Virtual desktop fully online. Transferring control to Gemini 2.5 Computer Use."]);
    setComputerLoaded(true);

    // Initial page load: Home
    recordHistory({
      time: "00:01",
      url: "http://localhost:5000/app/acme-ops-command-00y63",
      action: "PAGE_VIEW",
      category: "page",
      dwell: "3.2s",
      scoreDelta: "S:1.0 C:2.0 O:1.0 R:1.0 E:1.0",
      note: "Landed on Mission Control home page. Anonymous session cookie initialized."
    });

    try {
      void fetch("/api/prospecting/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{
          propertyUid: propUid,
          prospectUid: sessionUid,
          activity: "page_view",
          url: "http://localhost:5000/app/acme-ops-command-00y63",
          payload: { title: "Acme Mission Control", referrer: "https://google.com/search?q=enterprise+cloud+orchestration" }
        }])
      });
    } catch { /* Non-blocking */ }

    // Stage 2: Home Page (Mission Control) Multi-Point Realistic Browsing
    setComputerUseStep(2);

    await glideMouse([
      { x: 190, y: 50, label: "Evaluating Page Header & Identity Bridge", dwellMs: 1200 },
      { x: 230, y: 105, label: "Reading Hero: Autonomous Cloud Infrastructure", dwellMs: 1800 },
    ]);

    recordHistory({
      time: "00:03",
      url: "http://localhost:5000/app/acme-ops-command-00y63#overview",
      action: "SCROLL",
      category: "interaction",
      dwell: "2.4s",
      scoreDelta: "S:1.2 C:2.2 O:1.1 R:1.0 E:1.0",
      note: "Scrolled hero section 420px; inspected autonomous micro-VM architecture."
    });

    await glideMouse([
      { x: 140, y: 160, label: "Hovering 42 Micro-VMs Metric", hover: "workloads", dwellMs: 1900 },
    ]);

    recordHistory({
      time: "00:05",
      url: "http://localhost:5000/app/acme-ops-command-00y63#metrics-workloads",
      action: "HOVER",
      category: "interaction",
      dwell: "1.9s",
      scoreDelta: "S:1.5 C:2.5 O:1.3 R:1.2 E:1.1",
      note: "Inspected 42 Micro-VMs active workload cluster metric; evaluated isolation model."
    });

    await glideMouse([
      { x: 270, y: 160, label: "Hovering Telemetry SLA: 99.98% Healthy", hover: "sla", dwellMs: 1700 },
    ]);

    recordHistory({
      time: "00:07",
      url: "http://localhost:5000/app/acme-ops-command-00y63#metrics-sla",
      action: "HOVER",
      category: "interaction",
      dwell: "1.7s",
      scoreDelta: "S:1.8 C:2.8 O:1.5 R:1.3 E:1.2",
      note: "Verified 99.98% Telemetry SLA health status; validated sub-second telemetry uptime."
    });

    await glideMouse([
      { x: 380, y: 215, label: "Hovering 'Explore Enterprise Solutions'", hover: "hero-cta", dwellMs: 1300 },
      { x: 295, y: 52, label: "Targeting Navigation: Solutions & SLAs", hover: "solutions-tab", dwellMs: 1000 },
    ]);

    await clickMouse("Clicking Solutions & SLAs Tab");
    setActiveHoverElement(null);

    recordHistory({
      time: "00:09",
      url: "http://localhost:5000/app/acme-ops-command-00y63/solutions/enterprise",
      action: "NAV_CLICK",
      category: "interaction",
      dwell: "0.8s",
      scoreDelta: "S:2.5 C:3.2 O:2.0 R:1.8 E:1.5",
      note: "Clicked 'Solutions & SLAs' top navigation link; transitioning routes."
    });

    // Stage 3: Solutions Page Multi-Point Browsing & Compliance Inspection
    setActiveVirtualPage("solutions");

    recordHistory({
      time: "00:10",
      url: "http://localhost:5000/app/acme-ops-command-00y63/solutions/enterprise",
      action: "PAGE_VIEW",
      category: "page",
      dwell: "3.8s",
      scoreDelta: "S:3.2 C:4.0 O:2.8 R:2.2 E:1.8",
      note: "Loaded Enterprise Multi-Tenant Isolation & Zero-Trust specs."
    });

    try {
      void fetch("/api/prospecting/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{
          propertyUid: propUid,
          prospectUid: sessionUid,
          activity: "page_view",
          url: "http://localhost:5000/app/acme-ops-command-00y63/solutions/enterprise",
          payload: { title: "Enterprise Solutions & SLAs" }
        }])
      });
    } catch { /* Non-blocking */ }

    await glideMouse([
      { x: 200, y: 90, label: "Reading Architecture Summary", dwellMs: 1400 },
      { x: 140, y: 150, label: "Hovering Dedicated VPC Enclave Card", hover: "vpc", dwellMs: 1700 },
    ]);

    recordHistory({
      time: "00:12",
      url: "http://localhost:5000/app/acme-ops-command-00y63/solutions#dedicated-vpc",
      action: "HOVER",
      category: "interaction",
      dwell: "1.7s",
      scoreDelta: "S:3.8 C:4.5 O:3.2 R:2.5 E:2.0",
      note: "Inspected Dedicated VPC CIDR network isolation enclaves."
    });

    await glideMouse([
      { x: 270, y: 150, label: "Inspecting SOC2 Type II Compliance & Signed Audit Logs", hover: "soc2", dwellMs: 2200 },
    ]);

    recordHistory({
      time: "00:14",
      url: "http://localhost:5000/app/acme-ops-command-00y63/solutions#soc2",
      action: "INSPECT",
      category: "interaction",
      dwell: "2.2s",
      scoreDelta: "S:4.5 C:5.2 O:4.0 R:3.0 E:2.4",
      note: "Inspected SOC2 Type II cryptographic attestation & tamper-evident audit logging."
    });

    await glideMouse([
      { x: 400, y: 150, label: "Inspecting 14ms Latency Telemetry Outbox", hover: "latency", dwellMs: 1600 },
    ]);

    recordHistory({
      time: "00:16",
      url: "http://localhost:5000/app/acme-ops-command-00y63/solutions#latency",
      action: "HOVER",
      category: "interaction",
      dwell: "1.6s",
      scoreDelta: "S:5.0 C:5.8 O:4.5 R:3.5 E:2.8",
      note: "Evaluated 14ms sub-second telemetry outbox stream latency for Kafka pipelines."
    });

    await glideMouse([
      { x: 410, y: 52, label: "Targeting Navigation: Pricing & Limits", hover: "pricing-tab", dwellMs: 1100 },
    ]);

    await clickMouse("Clicking Pricing & Limits Tab");
    setActiveHoverElement(null);

    recordHistory({
      time: "00:18",
      url: "http://localhost:5000/app/acme-ops-command-00y63/pricing",
      action: "NAV_CLICK",
      category: "interaction",
      dwell: "0.9s",
      scoreDelta: "S:5.8 C:6.2 O:5.0 R:4.2 E:3.5",
      note: "Clicked 'Pricing & Limits' tab; evaluating tier quotas."
    });

    // Stage 4: Pricing Quotas, Tier Selection & S.C.O.R.E. Spike
    setComputerUseStep(3);
    setActiveVirtualPage("pricing");

    recordHistory({
      time: "00:19",
      url: "http://localhost:5000/app/acme-ops-command-00y63/pricing",
      action: "PAGE_VIEW",
      category: "page",
      dwell: "4.2s",
      scoreDelta: "S:6.5 C:6.8 O:6.0 R:5.5 E:4.5",
      note: "Loaded Enterprise Tier Quotas & ROI Calculator."
    });

    try {
      void fetch("/api/prospecting/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{
          propertyUid: propUid,
          prospectUid: sessionUid,
          activity: "page_view",
          url: "http://localhost:5000/app/acme-ops-command-00y63/pricing",
          payload: { title: "Pricing & Limits Calculator" }
        }])
      });
    } catch { /* Non-blocking */ }

    await glideMouse([
      { x: 130, y: 150, label: "Hovering Starter Tier ($12k/yr)", hover: "tier-starter", dwellMs: 1400 },
      { x: 270, y: 150, label: "Hovering Growth Tier ($48k/yr)", hover: "tier-growth", dwellMs: 1800 },
    ]);

    recordHistory({
      time: "00:22",
      url: "http://localhost:5000/app/acme-ops-command-00y63/pricing#tier-growth",
      action: "HOVER",
      category: "interaction",
      dwell: "1.8s",
      scoreDelta: "S:6.8 C:7.0 O:6.4 R:6.0 E:5.0",
      note: "Evaluated Growth tier ($48k/yr) 20 VM limits; deemed insufficient for enterprise scale."
    });

    await glideMouse([
      { x: 410, y: 150, label: "Inspecting Enterprise Dedicated Cluster ($120k/yr)", hover: "tier-enterprise", dwellMs: 1900 },
    ]);

    await clickMouse("Selecting Enterprise Dedicated Tier");
    setSelectedPricingTier("enterprise");

    recordHistory({
      time: "00:24",
      url: "http://localhost:5000/app/acme-ops-command-00y63/pricing#tier-enterprise",
      action: "CLICK",
      category: "interaction",
      dwell: "1.3s",
      scoreDelta: "Budget +7.4 • Need +8.2",
      note: "Selected Enterprise Dedicated Cluster ($120k/yr, unlimited VMs)."
    });

    recordHistory({
      time: "00:26",
      url: "http://localhost:5000/app/acme-ops-command-00y63/pricing#score-spike",
      action: "SCORE_SPIKE",
      category: "signal",
      dwell: "0.0s",
      scoreDelta: "S:7.5 C:7.8 O:8.4 R:8.2 E:6.5",
      note: "S.C.O.R.E. vectors spiked: Budget 8.4 (+3.2), Need 9.1 (+2.8). High-value enterprise intent classified."
    });

    await glideMouse([
      { x: 410, y: 150, label: "Enterprise Tier Selected (Reviewing SLAs)", hover: "tier-enterprise", dwellMs: 1200 },
      { x: 390, y: 220, label: "Hovering 'Request Enterprise Access & Quote'", hover: "pricing-cta", dwellMs: 1300 },
    ]);

    await clickMouse("Opening Enterprise Inquiry Form");
    setActiveHoverElement(null);

    recordHistory({
      time: "00:28",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact/enterprise-inquiry",
      action: "NAV_CLICK",
      category: "interaction",
      dwell: "0.8s",
      scoreDelta: "S:7.8 C:8.0 O:8.5 R:8.5 E:7.0",
      note: "Clicked 'Request Enterprise Access & Quote'; proceeding to zero-party inquiry form."
    });

    // Stage 5: Deployed Form Builder Intake with Keystroke Typing Cadence
    setComputerUseStep(4);
    setActiveVirtualPage("form");

    recordHistory({
      time: "00:29",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact/enterprise-inquiry",
      action: "PAGE_VIEW",
      category: "page",
      dwell: "5.0s",
      scoreDelta: "S:8.0 C:8.2 O:8.8 R:8.8 E:7.5",
      note: "Loaded deployed Form Builder zero-party intake form."
    });

    // Full Name
    await glideMouse([
      { x: 145, y: 135, label: "Focusing Full Name Input", hover: "input-name", dwellMs: 800 },
    ]);
    await clickMouse("Focused Full Name Input", 250);
    await typeVirtualField("name", "Sarah Chen");

    recordHistory({
      time: "00:31",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact#field-name",
      action: "INPUT",
      category: "interaction",
      dwell: "1.4s",
      scoreDelta: "Name: Sarah Chen",
      note: "Focused Full Name input; typed 'Sarah Chen' (keystroke cadence: 82 WPM)."
    });

    // Work Email
    await glideMouse([
      { x: 345, y: 135, label: "Focusing Work Email Input", hover: "input-email", dwellMs: 800 },
    ]);
    await clickMouse("Focused Work Email Input", 250);
    await typeVirtualField("email", "sarah.chen@vertex.io");

    recordHistory({
      time: "00:33",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact#field-email",
      action: "INPUT",
      category: "interaction",
      dwell: "1.8s",
      scoreDelta: "Domain: vertex.io",
      note: "Focused Work Email input; typed 'sarah.chen@vertex.io' (corporate domain detected)."
    });

    // Role / Title
    await glideMouse([
      { x: 145, y: 185, label: "Focusing Role Input", hover: "input-role", dwellMs: 800 },
    ]);
    await clickMouse("Focused Role Input", 250);
    await typeVirtualField("role", "VP of Engineering");

    recordHistory({
      time: "00:35",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact#field-role",
      action: "INPUT",
      category: "interaction",
      dwell: "1.4s",
      scoreDelta: "Authority: Level 9",
      note: "Focused Role input; typed 'VP of Engineering' (executive authority: Level 9)."
    });

    // Enterprise Account / Company
    await glideMouse([
      { x: 345, y: 185, label: "Focusing Enterprise Account Input", hover: "input-company", dwellMs: 800 },
    ]);
    await clickMouse("Focused Enterprise Account Input", 250);
    await typeVirtualField("company", "Vertex Financial Systems");

    recordHistory({
      time: "00:37",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact#field-company",
      action: "INPUT",
      category: "interaction",
      dwell: "1.9s",
      scoreDelta: "ICP: Fintech Match",
      note: "Focused Account input; typed 'Vertex Financial Systems' (fintech vertical matched)."
    });

    // Submit Button
    await glideMouse([
      { x: 355, y: 235, label: "Hovering 'Submit Enterprise Inquiry'", hover: "form-submit", dwellMs: 1400 },
    ]);
    await clickMouse("Submitting Zero-Party Inquiry Payload", 500);
    setActiveHoverElement(null);

    recordHistory({
      time: "00:39",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact/enterprise-inquiry",
      action: "SUBMIT",
      category: "interaction",
      dwell: "0.6s",
      scoreDelta: "200 OK Accepted",
      note: "Clicked 'Submit Enterprise Inquiry' button; submitting zero-party payload."
    });

    // Live API Call to /api/prospecting/identify
    try {
      await fetch("/api/prospecting/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyUid: propUid,
          prospectUid: sessionUid,
          userId: "usr_vertex_sarah_chen",
          email: "sarah.chen@vertex.io",
          metadata: {
            account: "Vertex Financial Systems",
            role: "VP of Engineering",
            name: "Sarah Chen",
            tier: "Enterprise Dedicated ($120k/yr)",
            source: "Gemini Computer Use Autonomous Buyer",
          },
        }),
      });
    } catch { /* Non-blocking */ }

    recordHistory({
      time: "00:40",
      url: "http://localhost:5000/api/prospecting/identify",
      action: "IDENTIFY",
      category: "signal",
      dwell: "0.3s",
      scoreDelta: "S:8.0 C:9.0 O:8.0 R:9.0 E:9.0",
      note: "Zero-party de-anonymization resolution committed (Sarah Chen @ Vertex Financial Systems)."
    });

    // Stage 6: Confirmed Resolution & Kafka Outbox Relay
    await delay(900);
    setComputerUseStep(5);
    setActiveVirtualPage("confirmed");

    recordHistory({
      time: "00:41",
      url: "http://localhost:5000/app/acme-ops-command-00y63/contact/confirmed",
      action: "PAGE_VIEW",
      category: "page",
      dwell: "3.0s",
      scoreDelta: "Outcome Calibrated: 9.5",
      note: "Landed on Inquiry Confirmation & Cluster Provisioning receipt."
    });

    recordHistory({
      time: "00:42",
      url: "kafka://spatial.signal.v1:observation",
      action: "KAFKA_RELAY",
      category: "signal",
      dwell: "0.0s",
      scoreDelta: "Topic: spatial.signal.v1",
      note: "Atomic outbox event published to Kafka; handed off to autonomous CREW SDR squad."
    });

    setVirtualCursor({ x: 260, y: 140, clicking: false, label: "Simulation Complete (24 Events Audited)" });
    setIsSimulating(false);
  };

  const getAgentDemoMessage = (agent: any): string => {
    const name = (agent?.name || agent?.title || agent?.slug || "").toLowerCase();
    const role = (agent?.role || agent?.soulArchetype || "").toLowerCase();
    const desc = (agent?.description || agent?.desc || "").toLowerCase();

    if (name.includes("film") || name.includes("director") || name.includes("artist") || name.includes("producer") || desc.includes("film") || desc.includes("production")) {
      return "Team, we have an executive brief to produce a 15-second teaser for Project Chimera. Creative Director: Pitch the narrative arc. Producer: Establish fiscal boundaries. Technical Director: Mount Media Studio.";
    }
    if (name.includes("rescue") || role.includes("emergency") || desc.includes("rescue") || desc.includes("dispatch")) {
      return "Emergency incident reported: Structural collapse at Sector 7, Building A with 3 trapped casualties. Please initiate incident intake and dispatch the rescue squad.";
    }
    if (name.includes("codegen") || name.includes("architect") || desc.includes("scaffold") || desc.includes("app forge")) {
      return "Scaffold a new real-time Vendor Risk & Compliance monitoring app with interactive metrics, audit trails, and export tools.";
    }
    if (name.includes("budget") || name.includes("finance") || role.includes("financial") || desc.includes("budget")) {
      return "Run Q3 department spend anomaly detection, analyze Cloud Infrastructure overrun (+14.2%), and prepare multi-tier executive sign-off package.";
    }
    if (name.includes("workforce") || name.includes("training") || role.includes("hr") || desc.includes("upskilling")) {
      return "Audit fleet reliability scores, identify agents with elevated error rates, and initiate skill upskilling cycle with rollback snapshot.";
    }
    if (name.includes("sdlc") || name.includes("qa") || role.includes("sdlc") || desc.includes("test")) {
      return "Execute hybrid SDLC validation suite, verify 5-layer autonomy policy gates, and generate signed audit record.";
    }
    if (name.includes("intake") || name.includes("form") || desc.includes("questionnaire")) {
      return "Please initiate the incident intake questionnaire schema and collect required operational parameters.";
    }
    if (name.includes("supervisor") || name.includes("foundry") || role.includes("cycle")) {
      return "Start autonomous verification and run operational cycle attestation for active pipelines.";
    }
    if (name.includes("sales") || role.includes("sales")) {
      return "Qualify and triage inbound enterprise lead from Acme Corp interested in Autonomous App Forge.";
    }
    if (name.includes("sre") || name.includes("incident") || role.includes("sre")) {
      return "Analyze telemetry anomaly in production Redis cache layer and generate mitigation steps.";
    }
    return `Execute operational workflow and verify task parameters for ${agent?.name || agent?.title || "published agent"}.`;
  };

  const getAgentHref = (agent: any): string => {
    const slug = agent?.slug || agent?.publicSlug || (agent?.name || agent?.title || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const demoMsg = getAgentDemoMessage(agent);
    return `/a/${slug}?prompt=${encodeURIComponent(demoMsg)}`;
  };

  const openAgent = (agent: any) => {
    const href = getAgentHref(agent);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const handleLaunchAgentModal = (agent: any) => {
    setSelectedAgentForModal(agent);
    setAgentInstruction(getAgentDemoMessage(agent));
    setAgentExecutionResult(null);
  };

  const handleRunAgentWorkflow = async () => {
    if (!selectedAgentForModal) return;
    setIsExecutingAgent(true);
    setAgentExecutionResult(null);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentForModal.id,
          message: agentInstruction || `Execute workflow for agent ${selectedAgentForModal.name || selectedAgentForModal.title}`
        })
      });
      if (res.ok) {
        const data = await res.json();
        setAgentExecutionResult(data.response || data.content || "Agent workflow executed successfully.");
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || data?.error || `Agent execution failed (${res.status})`);
      }
    } catch (e: any) {
      setAgentExecutionResult(e?.message || "Agent execution could not be started. Please try again.");
    } finally {
      setIsExecutingAgent(false);
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch installed apps catalog (same read-model the copilot's list_installed_apps tool uses)
  const { data: appsData, isLoading: appsLoading } = useQuery<{ items: any[] }>({
    queryKey: ["/api/apps/fleet-for-copilot"],
    queryFn: async () => {
      const res = await fetch("/api/apps/fleet-for-copilot");
      if (!res.ok) return { items: [] };
      const raw = await res.json();
      return { items: Array.isArray(raw) ? raw : raw?.items || [] };
    }
  });

  // Fetch active agent deployments
  // /api/agent-deployments does not exist — the deployments router mounts at
  // /api/agents, so the list lives at /api/agents/hr/workforce. The old path
  // 404'd on every load, and the `!res.ok -> []` below swallowed it, so the
  // agents section simply rendered empty instead of reporting the failure.
  const { data: agentsData, isLoading: agentsLoading } = useQuery<any[]>({
    queryKey: ["/api/agents/hr/workforce"],
    queryFn: async () => {
      const res = await fetch("/api/agents/hr/workforce", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    }
  });

  // Fetch active cycle status
  const { data: cyclesData } = useQuery<any[]>({
    queryKey: ["/api/cycles"],
    queryFn: async () => {
      const res = await fetch("/api/cycles");
      if (!res.ok) return [];
      const raw = await res.json();
      return Array.isArray(raw) ? raw : raw?.cycles || [];
    }
  });

  const SYSTEM_CAPABILITIES = [
    { title: "AI-Powered Film Production Studio", url: "/workspace/chat/crew-film-studio-alpha", category: "Cinematic AI", description: "Multi-agent CREW room (Creative Director, Visual Artist, Technical Director, Producer) with embedded Media Studio pod, style bible, keyframe rendering, and conformed reel assembly." },
    { title: "Prediction Intelligence & Causal Chains", url: "/insights/prediction", category: "Predictive", description: "Predictive failure detection, resource optimization, and causal chain analysis." },
    { title: "SDLC Pipeline & Artifact Validator", url: "/operations/workstreams", category: "SDLC", description: "SDLC artifact contract validator, build stages, and release pipelines." },
    { title: "System X-Ray Structural Inspector", url: "/armory/x-ray", category: "Inspector", description: "AST route parser, schema topology, and dependency graph inspector." },
    { title: "System Evolution & Flight Deck", url: "/platform-maintenance/evolution", category: "Governance", description: "5-layer autonomy policy, flight deck telemetry, and self-improving trajectories." },
    { title: "Autoresearch Dashboard", url: "/platform-maintenance/autoresearch", category: "AI Control", description: "Automated hypothesis testing, scoring, and research iteration." },
    { title: "Software Audit Log & Compliance", url: "/platform-maintenance/software-audit", category: "Security", description: "Forensic audit logging and Human-in-the-Loop approval records." },
    { title: "UCI Hub & Component Governance", url: "/admin/uci-hub", category: "Control Plane", description: "Universal Component Interface hub and agent governance policies." },
    { title: "Eulerian Spatial Telemetry Engine", url: "/spatial", category: "Spatial H3", description: "Uber H3 hexagonal spatial indexing and real-time telemetry streaming." },
    { title: "Connections & Credential Vault", url: "/connections/credentials", category: "Integrations", description: "SaaS connectors, API keys, MCP tokens, and credential vaults." },
  ];

  const HERO_APPS = [
    {
      slug: "film-studio",
      title: "AI Film Production Studio",
      description: "Collaborative multi-agent studio with embedded Media Studio pod & conformed timeline assembly.",
      href: "/workspace/chat/crew-film-studio-alpha",
      availability: "Hero Demo",
      source: "app",
      actionLabel: "Launch Studio",
    },
  ];

  const apps = appsData?.items || [];
  // The Arsenal grid is for *installed* App Forge deployments only — the catalog also
  // carries agent AIs (own section below), marketplace apps, and blueprint templates.
  // Slugs repeat across sources (a blueprint and its deployed app share one), so the
  // grid and the pinned strip both narrow to installed apps to keep keys unique.
  const installedApps = apps.filter((app: any) => app.source === "app" && app.availability === "installed");
  const allAvailableApps = [...installedApps, ...HERO_APPS];
  const pinnedApps = allAvailableApps.filter((app: any) => pinnedAppSlugs.includes(app.slug));
  const agents = agentsData || [];
  const activeCycle = (cyclesData || []).find((c: any) => c.status === "active") || cyclesData?.[0];

  const q = searchQuery.toLowerCase().trim();

  const matchedSystemCaps = q
    ? SYSTEM_CAPABILITIES.filter(
        (c) => c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      )
    : [];

  const matchedApps = q
    ? apps.filter(
        (a: any) => a.title?.toLowerCase().includes(q) || a.slug?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
      )
    : [];

  const matchedAgents = q
    ? (agentsData || []).filter(
        (a: any) => a.name?.toLowerCase().includes(q) || a.role?.toLowerCase().includes(q) || a.systemPrompt?.toLowerCase().includes(q)
      )
    : [];

  const matchedCycles = q
    ? (cyclesData || []).filter(
        (c: any) => c.name?.toLowerCase().includes(q) || String(c.id).includes(q) || c.status?.toLowerCase().includes(q)
      )
    : [];

  const totalResults = matchedSystemCaps.length + matchedApps.length + matchedAgents.length + matchedCycles.length;

  const filteredApps = installedApps.filter(
    (app: any) =>
      !searchQuery ||
      app.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.slug?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const triggerCopilotPrompt = (prompt: string) => {
    // Open Copilot AgentChatSheet with pre-populated prompt
    window.dispatchEvent(
      new CustomEvent("agent-assist-request", {
        detail: { prompt }
      })
    );
  };

  const openApp = (app: any) => {
    const href = app?.href || (app?.slug ? `/app/${app.slug}` : null);
    if (!href) return;
    if (href.startsWith("/")) {
      setLocation(href);
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  const renderVirtualComputerDesktop = (isModal: boolean = false) => {
    const pageCount = pageHistory.filter((h) => h.category === "page").length;
    const interactionCount = pageHistory.filter((h) => h.category === "interaction").length;
    const signalCount = pageHistory.filter((h) => h.category === "signal").length;

    const filteredHistory = pageHistory.filter((item) => {
      if (historyFilter === "page" && item.category !== "page") return false;
      if (historyFilter === "interaction" && item.category !== "interaction") return false;
      if (historyFilter === "signal" && item.category !== "signal") return false;
      if (historySearch) {
        const q = historySearch.toLowerCase();
        return (
          item.url.toLowerCase().includes(q) ||
          item.note.toLowerCase().includes(q) ||
          item.action.toLowerCase().includes(q)
        );
      }
      return true;
    });

    return (
      <div
        className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden ${
          isModal ? "border-purple-500/40" : ""
        }`}
        data-testid={isModal ? "virtual-computer-viewport-modal" : "virtual-computer-viewport"}
      >
        {/* Monitor Window Chrome Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/70 border-b border-border/50 text-[11px]">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            </div>
            <span className="font-semibold text-muted-foreground flex items-center gap-1 ml-1 text-[11px]">
              <Monitor className="w-3.5 h-3.5 text-purple-500" />
              Trycua Ubuntu 22.04 LTS (Sandbox Container :99)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {computerLoaded ? (
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Desktop Online (1920x1080)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Sandbox Booting ({computerBootProgress}%)
              </Badge>
            )}

            {/* Pacing Speed Selector */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSimulationSpeed((s) => (s === 1 ? 2 : 1))}
              className="h-6 px-2 text-[10px] font-mono gap-1"
              title="Toggle between realistic slow browsing and 2x speed"
            >
              <Clock className="w-3 h-3 text-purple-500" />
              {simulationSpeed === 1 ? "1x Realistic Pacing" : "2x Speed"}
            </Button>

            {/* Play / Stop / Restart Controls */}
            <Button
              size="sm"
              variant={isSimulating ? "secondary" : "default"}
              onClick={() => {
                if (isSimulating) {
                  simulationCancelledRef.current = true;
                  setIsSimulating(false);
                } else {
                  void runComputerUseSimulation();
                }
              }}
              className={`h-6 px-2.5 text-[10px] gap-1 font-semibold ${
                isSimulating
                  ? "bg-amber-500/15 text-amber-600 border border-amber-500/30"
                  : "bg-purple-600 text-white hover:bg-purple-700"
              }`}
            >
              {isSimulating ? (
                <>
                  <Pause className="w-3 h-3" /> Stop
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" /> {pageHistory.length > 0 ? "Re-run" : "Start Simulation"}
                </>
              )}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runComputerUseSimulation()}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              title="Restart Simulation"
            >
              <RotateCcw className="w-3 h-3" />
            </Button>

            {!isModal && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsComputerUseDemoOpen(true)}
                className="h-6 px-2 text-[10px] gap-1 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 font-semibold"
                title="Expand Fullscreen Modal"
              >
                <Maximize2 className="w-3 h-3" /> Expand
              </Button>
            )}
          </div>
        </div>

        {/* Browser Address Bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border/40 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <RotateCcw className={`w-3 h-3 cursor-pointer hover:text-foreground ${isSimulating ? "animate-spin text-purple-500" : ""}`} />
          </div>
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background border border-border/60 text-[11px] font-mono text-muted-foreground overflow-hidden">
            <Lock className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="text-foreground font-medium truncate">
              {activeVirtualPage === "home" && "http://localhost:5000/app/acme-ops-command-00y63"}
              {activeVirtualPage === "solutions" && "http://localhost:5000/app/acme-ops-command-00y63/solutions/enterprise"}
              {activeVirtualPage === "pricing" && "http://localhost:5000/app/acme-ops-command-00y63/pricing"}
              {activeVirtualPage === "form" && "http://localhost:5000/app/acme-ops-command-00y63/contact/enterprise-inquiry"}
              {activeVirtualPage === "confirmed" && "http://localhost:5000/app/acme-ops-command-00y63/contact/confirmed"}
            </span>
            <span className="text-muted-foreground/70 text-[10px] ml-auto shrink-0 flex items-center gap-1.5 pl-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              <Fingerprint className="w-3 h-3 text-emerald-500" /> Identity Bridge Active
            </span>
          </div>
        </div>

        {/* Virtual Screen Viewport & Live History Split */}
        <div className="p-3 bg-muted/20">
          {!computerLoaded ? (
            /* ⏳ Computer Booting / Loading State */
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-3 bg-background rounded-lg border border-border/50" data-testid="computer-loading-state">
              <div className="relative">
                <div className="p-3.5 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <Cpu className="w-8 h-8 animate-pulse" />
                </div>
                <Loader2 className="w-4 h-4 animate-spin text-purple-500 absolute -bottom-1 -right-1" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-foreground">Waiting for Computer Use Sandbox to Load...</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Spinning up isolated Linux sandbox container, X11 virtual display :99, and Chromium browser instance.
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-64 bg-muted rounded-full h-2 overflow-hidden border border-border/40">
                <div
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${computerBootProgress}%` }}
                />
              </div>

              {/* Live Boot Sequence Terminal Log */}
              <div className="w-full max-w-md bg-muted/40 border border-border/50 rounded-lg p-2 text-left font-mono text-[10px] space-y-0.5 text-muted-foreground">
                {computerBootLogs.map((log, i) => (
                  <div key={i} className="truncate text-purple-600 dark:text-purple-300">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 🚀 Active Split Screen: Virtual Browser (Col 8) + Live Session History (Col 4) */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3" data-testid="computer-loaded-desktop">
              {/* LEFT: Virtual Browser Viewport */}
              <div className="lg:col-span-8 relative min-h-[420px] bg-background rounded-lg border border-border/70 p-3.5 flex flex-col justify-between overflow-hidden shadow-sm select-none">
                {/* App Header & Navigation */}
                <div>
                  <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-foreground flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-primary" /> Acme Operations Command
                      </div>
                      <Badge variant="secondary" className="text-[9px]">v2.4 Enterprise</Badge>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-mono">
                      <span className={`px-2 py-0.5 rounded transition-colors ${activeVirtualPage === "home" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30" : "text-muted-foreground"}`}>
                        Overview
                      </span>
                      <span className={`px-2 py-0.5 rounded transition-all ${activeHoverElement === "solutions-tab" ? "ring-2 ring-purple-500 bg-purple-500/20" : ""} ${activeVirtualPage === "solutions" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30" : "text-muted-foreground"}`}>
                        Solutions & SLAs
                      </span>
                      <span className={`px-2 py-0.5 rounded transition-all ${activeHoverElement === "pricing-tab" ? "ring-2 ring-purple-500 bg-purple-500/20" : ""} ${activeVirtualPage === "pricing" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30" : "text-muted-foreground"}`}>
                        Pricing & Limits
                      </span>
                      <span className={`px-2 py-0.5 rounded transition-colors ${activeVirtualPage === "form" || activeVirtualPage === "confirmed" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold border border-purple-500/30" : "text-muted-foreground"}`}>
                        Inquiry Form
                      </span>
                    </div>
                  </div>

                  {/* PAGE 1: Home / Overview */}
                  {activeVirtualPage === "home" && (
                    <div className="space-y-3 animate-in fade-in duration-300">
                      <div className="p-3 rounded-lg bg-muted/30 border border-border/40">
                        <h4 className="text-xs font-bold text-foreground">Autonomous Cloud Infrastructure & Governed AI Workloads</h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          High-availability micro-VM container orchestration with real-time Kafka event streaming and identity telemetry.
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className={`p-2 rounded-md border transition-all ${activeHoverElement === "workloads" ? "border-purple-500 bg-purple-500/15 shadow-sm ring-1 ring-purple-500/50" : "bg-muted/40 border-border/40"}`}>
                          <div className="text-muted-foreground">Active Workloads</div>
                          <div className="text-xs font-bold text-foreground">42 Micro-VMs</div>
                        </div>
                        <div className={`p-2 rounded-md border transition-all ${activeHoverElement === "sla" ? "border-purple-500 bg-purple-500/15 shadow-sm ring-1 ring-purple-500/50" : "bg-muted/40 border-border/40"}`}>
                          <div className="text-muted-foreground">Telemetry SLA</div>
                          <div className="text-xs font-bold text-emerald-500">99.98% Healthy</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40 border border-border/40">
                          <div className="text-muted-foreground">S.C.O.R.E. Intent Vector</div>
                          <div className="text-xs font-bold text-foreground">Baseline: 1.0</div>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button size="sm" variant="outline" className={`h-7 text-[10px] gap-1 transition-all ${activeHoverElement === "hero-cta" ? "border-purple-500 bg-purple-500/20 text-purple-600" : "text-primary border-primary/30"}`}>
                          Explore Enterprise Solutions <ArrowRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* PAGE 2: Solutions & SLAs */}
                  {activeVirtualPage === "solutions" && (
                    <div className="space-y-3 animate-in fade-in duration-300">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">Enterprise Solutions & Multi-Tenant Isolation</h4>
                        <p className="text-[10px] text-muted-foreground">Zero-trust micro-VM enclaves tailored for high-compliance financial and enterprise environments.</p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className={`p-2.5 rounded-lg border transition-all space-y-1 ${activeHoverElement === "vpc" ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500" : "border-border/50 bg-muted/30"}`}>
                          <div className="font-semibold text-foreground flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-500" /> Dedicated VPC
                          </div>
                          <p className="text-[9px] text-muted-foreground">Private CIDR enclaves with isolated network tunnels.</p>
                        </div>
                        <div className={`p-2.5 rounded-lg border transition-all space-y-1 ${activeHoverElement === "soc2" ? "border-purple-500 bg-purple-500/25 ring-2 ring-purple-500" : "border-purple-500/30 bg-purple-500/[0.06]"}`}>
                          <div className="font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-purple-500" /> SOC2 Type II
                          </div>
                          <p className="text-[9px] text-muted-foreground">Cryptographically signed audit logs & tamper evidence.</p>
                        </div>
                        <div className={`p-2.5 rounded-lg border transition-all space-y-1 ${activeHoverElement === "latency" ? "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500" : "border-border/50 bg-muted/30"}`}>
                          <div className="font-semibold text-foreground flex items-center gap-1">
                            <Zap className="w-3 h-3 text-amber-500" /> 14ms Latency
                          </div>
                          <p className="text-[9px] text-muted-foreground">High-throughput sub-second telemetry outbox stream.</p>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-primary border-primary/30">
                          Compare Tier Quotas & Pricing <ArrowRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* PAGE 3: Pricing & Tier Calculator */}
                  {activeVirtualPage === "pricing" && (
                    <div className="space-y-3 animate-in fade-in duration-300">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-foreground">Enterprise Tier Quotas & ROI Calculator</h4>
                          <p className="text-[10px] text-muted-foreground">Select an operational tier to provision dedicated capacity and AI co-pilots.</p>
                        </div>
                        <div className="text-[10px] font-mono text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30">
                          S.C.O.R.E. Intent: Budget: 8.4 • Need: 9.1
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className={`p-2.5 rounded-lg border transition-all ${activeHoverElement === "tier-starter" ? "ring-2 ring-purple-500" : ""} ${selectedPricingTier === "starter" ? "border-primary bg-primary/10" : "border-border/50 bg-muted/20"}`}>
                          <div className="font-bold text-foreground">Starter</div>
                          <div className="text-xs font-mono font-bold mt-1">$12,000<span className="text-[9px] font-normal text-muted-foreground">/yr</span></div>
                          <div className="text-[9px] text-muted-foreground mt-1">5 Micro-VMs • Standard SLAs</div>
                        </div>
                        <div className={`p-2.5 rounded-lg border transition-all ${activeHoverElement === "tier-growth" ? "ring-2 ring-purple-500 bg-purple-500/10" : ""} ${selectedPricingTier === "growth" ? "border-primary bg-primary/10" : "border-border/50 bg-muted/20"}`}>
                          <div className="font-bold text-foreground">Growth</div>
                          <div className="text-xs font-mono font-bold mt-1">$48,000<span className="text-[9px] font-normal text-muted-foreground">/yr</span></div>
                          <div className="text-[9px] text-muted-foreground mt-1">20 Micro-VMs • 99.9% Telemetry SLA</div>
                        </div>
                        <div className={`p-2.5 rounded-lg border transition-all ${selectedPricingTier === "enterprise" || activeHoverElement === "tier-enterprise" ? "border-purple-500 bg-purple-500/15 shadow-sm ring-2 ring-purple-500" : "border-border/50 bg-muted/20"}`}>
                          <div className="flex items-center justify-between">
                            <div className="font-bold text-purple-700 dark:text-purple-300">Enterprise Dedicated</div>
                            {selectedPricingTier === "enterprise" && (
                              <Badge variant="outline" className="text-[8px] bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/40">Selected</Badge>
                            )}
                          </div>
                          <div className="text-xs font-mono font-bold text-foreground mt-1">$120,000<span className="text-[9px] font-normal text-muted-foreground">/yr</span></div>
                          <div className="text-[9px] text-muted-foreground mt-1">Unlimited Micro-VMs • 99.98% SLA • 24/7 Crew Co-pilot</div>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button size="sm" variant="outline" className={`h-7 text-[10px] gap-1 transition-all ${activeHoverElement === "pricing-cta" ? "ring-2 ring-purple-500 bg-purple-500/25" : ""} text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10`}>
                          Request Enterprise Access & Quote <ArrowRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* PAGE 4: Deployed Form Builder */}
                  {activeVirtualPage === "form" && (
                    <div className="space-y-2.5 animate-in fade-in duration-300">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-foreground">Enterprise Access Inquiry (Deployed Form Builder)</h4>
                          <p className="text-[10px] text-muted-foreground">Zero-party intake form bound to Identity Bridge Prospector SDK.</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                          Form Studio v2.4 Live
                        </Badge>
                      </div>

                      <div className="p-2.5 rounded-lg border border-purple-500/40 bg-purple-500/[0.04] space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-muted-foreground block text-[9px] mb-0.5">Full Name</label>
                            <div className="relative">
                              <input
                                readOnly
                                value={virtualFormTyped.name}
                                placeholder="Enter full name..."
                                className={`w-full bg-background border rounded px-2 py-1 font-mono text-[10px] focus:outline-none transition-all ${activeHoverElement === "input-name" ? "border-purple-500 ring-2 ring-purple-500/40" : "border-border/80"}`}
                              />
                              {activeHoverElement === "input-name" && (
                                <span className="absolute right-2 top-1.5 w-1.5 h-3 bg-purple-500 animate-pulse" />
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="text-muted-foreground block text-[9px] mb-0.5">Work Email</label>
                            <div className="relative">
                              <input
                                readOnly
                                value={virtualFormTyped.email}
                                placeholder="name@company.com..."
                                className={`w-full bg-background border rounded px-2 py-1 font-mono text-[10px] focus:outline-none transition-all ${activeHoverElement === "input-email" ? "border-purple-500 ring-2 ring-purple-500/40" : "border-border/80"}`}
                              />
                              {activeHoverElement === "input-email" && (
                                <span className="absolute right-2 top-1.5 w-1.5 h-3 bg-purple-500 animate-pulse" />
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="text-muted-foreground block text-[9px] mb-0.5">Role / Title</label>
                            <div className="relative">
                              <input
                                readOnly
                                value={virtualFormTyped.role}
                                placeholder="e.g. VP Engineering..."
                                className={`w-full bg-background border rounded px-2 py-1 font-mono text-[10px] focus:outline-none transition-all ${activeHoverElement === "input-role" ? "border-purple-500 ring-2 ring-purple-500/40" : "border-border/80"}`}
                              />
                              {activeHoverElement === "input-role" && (
                                <span className="absolute right-2 top-1.5 w-1.5 h-3 bg-purple-500 animate-pulse" />
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="text-muted-foreground block text-[9px] mb-0.5">Enterprise Account</label>
                            <div className="relative">
                              <input
                                readOnly
                                value={virtualFormTyped.company}
                                placeholder="e.g. Vertex Financial..."
                                className={`w-full bg-background border rounded px-2 py-1 font-mono text-[10px] focus:outline-none transition-all ${activeHoverElement === "input-company" ? "border-purple-500 ring-2 ring-purple-500/40" : "border-border/80"}`}
                              />
                              {activeHoverElement === "input-company" && (
                                <span className="absolute right-2 top-1.5 w-1.5 h-3 bg-purple-500 animate-pulse" />
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-500" /> Quota Tier: Enterprise Dedicated ($120k/yr)
                          </span>
                          <Button size="sm" className={`h-7 text-[10px] gap-1 transition-all ${activeHoverElement === "form-submit" ? "ring-2 ring-purple-400 bg-purple-700" : "bg-purple-600 hover:bg-purple-700"} text-white font-semibold`}>
                            <Send className="w-3 h-3" /> Submit Enterprise Inquiry
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PAGE 5: Confirmed Resolution & Kafka Relay */}
                  {activeVirtualPage === "confirmed" && (
                    <div className="space-y-3 animate-in zoom-in-95 duration-300">
                      <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300 text-xs">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            Identity Bridge Resolution Complete
                          </div>
                          <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/20">
                            PostgreSQL Committed (200 OK)
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Merged <strong>24 anonymous session events</strong> into identified lead <strong>Sarah Chen</strong> (VP of Engineering @ Vertex Financial Systems).
                        </p>
                        <div className="grid grid-cols-5 gap-1 text-[10px] font-mono text-center pt-1 border-t border-emerald-500/20">
                          <div className="p-1 rounded bg-background/60">
                            <div className="text-[9px] text-muted-foreground font-bold">S</div>
                            <div className="font-bold text-emerald-600">8</div>
                          </div>
                          <div className="p-1 rounded bg-background/60">
                            <div className="text-[9px] text-muted-foreground font-bold">C</div>
                            <div className="font-bold text-emerald-600">9</div>
                          </div>
                          <div className="p-1 rounded bg-background/60">
                            <div className="text-[9px] text-muted-foreground font-bold">O</div>
                            <div className="font-bold text-emerald-600">8</div>
                          </div>
                          <div className="p-1 rounded bg-background/60">
                            <div className="text-[9px] text-muted-foreground font-bold">R</div>
                            <div className="font-bold text-emerald-600">9</div>
                          </div>
                          <div className="p-1 rounded bg-background/60">
                            <div className="text-[9px] text-muted-foreground font-bold">E</div>
                            <div className="font-bold text-emerald-600">9</div>
                          </div>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg border border-purple-500/30 bg-purple-500/[0.06] flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 font-semibold">
                          <Zap className="w-3.5 h-3.5 text-purple-500" />
                          Kafka Outbox: spatial.signal.v1 (observation)
                        </div>
                        <span className="text-[9px] font-mono text-muted-foreground">Dispatched to CREW SDR War Room</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 🖱️ Animated Virtual Mouse Cursor with Realistic Coordinates & Action Label */}
                <div
                  className="absolute pointer-events-none z-30 flex items-center gap-1.5"
                  style={{
                    left: `${virtualCursor.x}px`,
                    top: `${virtualCursor.y}px`,
                    transition: `left ${700 / simulationSpeed}ms cubic-bezier(0.25, 1, 0.5, 1), top ${700 / simulationSpeed}ms cubic-bezier(0.25, 1, 0.5, 1)`
                  }}
                >
                  <div className="relative">
                    <MousePointer
                      className={`w-4 h-4 text-purple-600 fill-purple-600 filter drop-shadow transition-transform duration-150 ${
                        virtualCursor.clicking ? "scale-75 text-emerald-500 fill-emerald-500" : ""
                      }`}
                    />
                    {virtualCursor.clicking && (
                      <span className="absolute -inset-1.5 rounded-full border-2 border-emerald-500 animate-ping opacity-75" />
                    )}
                  </div>
                  <div className="px-1.5 py-0.5 rounded bg-background/95 border border-purple-500/40 text-[9px] text-foreground font-mono shadow-md backdrop-blur-sm whitespace-nowrap">
                    {virtualCursor.label || `(x:${virtualCursor.x}, y:${virtualCursor.y})`}
                  </div>
                </div>
              </div>

              {/* RIGHT: Live Browser Navigation & Event History Timeline */}
              <div className="lg:col-span-4 rounded-lg border border-border/70 bg-card p-3 flex flex-col justify-between min-h-[420px]" data-testid="computer-session-history-drawer">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                      <History className="w-3.5 h-3.5 text-primary" />
                      Session History Audit
                    </div>
                    <Badge variant="outline" className="text-[9px] font-mono border-primary/30 text-primary">
                      {pageHistory.length} Events Total
                    </Badge>
                  </div>

                  {/* Search and Filters */}
                  <div className="space-y-1.5">
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Filter history events..."
                      className="h-6 text-[10px] bg-background/80"
                    />
                    <div className="flex items-center gap-1 text-[9px] font-mono">
                      <button
                        type="button"
                        onClick={() => setHistoryFilter("all")}
                        className={`px-1.5 py-0.5 rounded transition-colors ${historyFilter === "all" ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        All ({pageHistory.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryFilter("page")}
                        className={`px-1.5 py-0.5 rounded transition-colors ${historyFilter === "page" ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        Pages ({pageCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryFilter("interaction")}
                        className={`px-1.5 py-0.5 rounded transition-colors ${historyFilter === "interaction" ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        Actions ({interactionCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryFilter("signal")}
                        className={`px-1.5 py-0.5 rounded transition-colors ${historyFilter === "signal" ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        Signals ({signalCount})
                      </button>
                    </div>
                  </div>

                  {/* Event Feed List */}
                  <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                    {filteredHistory.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground text-xs space-y-1">
                        <History className="w-6 h-6 mx-auto opacity-40" />
                        <p>{pageHistory.length === 0 ? "Waiting for agent navigation..." : "No matching events."}</p>
                        <p className="text-[10px] opacity-70">{pageHistory.length === 0 ? "Click 'Start Simulation' above." : "Try clearing filters."}</p>
                      </div>
                    ) : (
                      filteredHistory.map((h) => (
                        <div key={h.id} className="p-2 rounded-md bg-muted/40 border border-border/40 text-[10px] space-y-1 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[8px] bg-background/80 px-1 py-0.5 rounded border border-border/50 text-muted-foreground">#{h.seq}</span>
                              <span className="font-mono text-[9px] text-muted-foreground">{h.time}</span>
                              <Badge
                                variant="secondary"
                                className={`text-[8px] font-mono px-1 py-0 ${
                                  h.action === "IDENTIFY"
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                                    : h.action === "CLICK" || h.action === "SUBMIT"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                    : h.action === "KAFKA_RELAY" || h.action === "SCORE_SPIKE"
                                    ? "bg-purple-500/10 text-purple-600 border-purple-500/30"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {h.action}
                              </Badge>
                            </div>
                            <span className="text-[9px] font-mono text-muted-foreground">dwell: {h.dwell}</span>
                          </div>
                          <div className="font-mono text-primary truncate text-[9px]">{h.url}</div>
                          <p className="text-muted-foreground text-[9px] leading-tight">{h.note}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* History Panel Footer */}
                <div className="pt-2 border-t border-border/40">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isModal) setIsComputerUseDemoOpen(false);
                      setLocation("/armory/identity-bridge");
                    }}
                    className="w-full text-[10px] h-7 gap-1 text-primary border-primary/30 hover:bg-primary/10"
                  >
                    <Globe className="w-3 h-3" /> Inspect Lead in Armory Timeline ↗
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      {/* ─── HERO OMNIBOX & SEARCH ────────────────────────────────────────────── */}
      <div className="relative rounded-2xl bg-gradient-to-r from-primary/10 via-accent/5 to-background border p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-xl text-primary">
              <Rocket className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Oddjob Command Launchpad</h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The Governed AI Control Plane & App Forge. Scaffold mini-apps, deploy autonomous agent swarms, and orchestrate real-time operational cycles.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs px-3 py-1 font-mono gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Redis Engine Online
          </Badge>
        </div>

        {/* Product Value Proposition Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-muted-foreground border-y border-muted/30 py-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span><strong>High-Speed Execution</strong>: Redis Cache-Aside & Python Acceleration</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            <span><strong>Governed Control</strong>: Human-in-the-Loop Approval & Autonomy Policies</span>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span><strong>App Forge Engine</strong>: Text-to-App Scaffolding & Public Slugs</span>
          </div>
        </div>

        {/* Omnibox Input & Progressive Search Dropdown */}
        <div className="relative">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search installed apps, agent AIs, operational cycles, SDLC specs... (⌘K)"
            className="pl-12 pr-10 h-12 text-base rounded-xl bg-background/80 backdrop-blur-sm border-muted-foreground/20 focus-visible:ring-primary shadow-inner"
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear launchpad search"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-3.5 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}

          {/* Progressive Search Overlay Dropdown */}
          {q.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl border border-primary/20 bg-background/95 backdrop-blur-md shadow-2xl p-4 space-y-4 max-h-[460px] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-muted/30 pb-2">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> Progressive Search Results ({totalResults})
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">Filter mode: Live</span>
              </div>

              {/* Copilot Ask Trigger */}
              <div
                onClick={() => triggerCopilotPrompt(`Find and analyze details for "${searchQuery}"`)}
                className="flex items-center justify-between p-3 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <div>
                    <span className="text-xs font-bold text-foreground">Ask Copilot AI</span>
                    <p className="text-[11px] text-muted-foreground">Analyze and find details for "{searchQuery}" across codebase & telemetry</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-primary" />
              </div>

              {/* System Capabilities & Specs */}
              {matchedSystemCaps.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">System Specs & Tools</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {matchedSystemCaps.map((cap) => (
                      <div
                        key={cap.url + cap.title}
                        onClick={() => { setLocation(cap.url); setSearchQuery(""); }}
                        className="p-2.5 rounded-lg border border-muted/40 hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono">{cap.category}</Badge>
                            <span className="text-xs font-semibold">{cap.title}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{cap.description}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 ml-2" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Installed Apps */}
              {matchedApps.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">Installed Apps ({matchedApps.length})</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {matchedApps.map((app: any) => (
                      <div
                        key={app.slug}
                        onClick={() => {
                          openApp(app);
                          setSearchQuery("");
                        }}
                        className="p-2.5 rounded-lg border border-muted/40 hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div>
                          <span className="text-xs font-semibold text-primary">{app.title}</span>
                          <p className="text-[11px] text-muted-foreground font-mono">/app/{app.slug}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Agent AI Swarms */}
              {matchedAgents.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">Agent AI Fleet ({matchedAgents.length})</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {matchedAgents.map((agent: any) => (
                      <div
                        key={agent.id || agent.slug}
                        onClick={() => { openAgent(agent); setSearchQuery(""); }}
                        className="p-2.5 rounded-lg border border-muted/40 hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-primary" />
                          <div>
                            <span className="text-xs font-semibold">{agent.name || agent.title}</span>
                            <p className="text-[11px] text-muted-foreground">{agent.role || "Autonomous Agent"}</p>
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Operational Cycles */}
              {matchedCycles.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">Operational Cycles ({matchedCycles.length})</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {matchedCycles.map((cycle: any) => (
                      <div
                        key={cycle.id}
                        onClick={() => { setLocation(`/operations/cycles/${cycle.id}`); setSearchQuery(""); }}
                        className="p-2.5 rounded-lg border border-muted/40 hover:border-amber-500/40 hover:bg-amber-500/5 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono">Cycle #{cycle.id}</Badge>
                            <span className="text-xs font-semibold">{cycle.name}</span>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totalResults === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
                  <p>No exact asset matches found for "{searchQuery}".</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerCopilotPrompt(`Search and resolve "${searchQuery}" across system knowledge graph`)}
                    className="text-xs rounded-full gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Search System Knowledge Graph with Copilot
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Copilot Action Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Start with:
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/workspace/chat/crew-film-studio-alpha")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors border-primary/20 bg-primary/5 text-primary"
          >
            <Film className="w-3.5 h-3.5 text-primary" /> Film Studio Demo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerCopilotPrompt("Help me report an issue. Ask for the affected area, steps to reproduce, expected result, actual result, and severity before drafting the report.")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Report an issue
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerCopilotPrompt("Help me build a mini-app. Start by asking for the user goal, target users, required inputs or data, and the desired output.")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Build a mini-app
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/operations/missions/new")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" /> Plan a mission
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/signal-intelligence/wizard")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors"
          >
            <Activity className="w-3.5 h-3.5" /> Capture a signal
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/armory/apps")}
            className="rounded-full text-xs gap-1.5 hover:bg-primary/5 hover:text-primary transition-colors"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Browse apps
          </Button>
        </div>
      </div>

      {/* ─── SYSTEM X-RAY SPECS & ADVANCED CONTROL PLANE CAPABILITIES ────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scan className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight">System X-Ray Specs & Control Plane</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/armory/x-ray")}
            className="text-xs text-muted-foreground hover:text-primary gap-1"
          >
            Launch System X-Ray Inspector <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setLocation("/insights/prediction")}>
            <CardHeader className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono font-bold">Predictive AI</Badge>
              </div>
              <CardTitle className="text-sm font-semibold pt-1">Prediction Intelligence</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                Predictive failure detection, causal chain reasoning, & resource optimization models.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setLocation("/armory/x-ray")}>
            <CardHeader className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <Scan className="w-5 h-5 text-indigo-500" />
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono">Inspector</Badge>
              </div>
              <CardTitle className="text-sm font-semibold pt-1">System X-Ray Topology</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                Live AST route parser, DB schema relations, & micro-service dependency graph visualization.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setLocation("/platform-maintenance/evolution")}>
            <CardHeader className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono">Governed</Badge>
              </div>
              <CardTitle className="text-sm font-semibold pt-1">5-Layer Autonomy Policy</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                Human-in-the-Loop approval gates, agent privilege escalation barriers, & audit logging.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setLocation("/operations/workstreams")}>
            <CardHeader className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <Cpu className="w-5 h-5 text-amber-500" />
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono">Spatial H3</Badge>
              </div>
              <CardTitle className="text-sm font-semibold pt-1">Eulerian Spatial Engine</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                Uber H3 hexagonal spatial indexing & real-time telemetry streaming for location-aware jobs.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setLocation("/health/observability")}>
            <CardHeader className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <Zap className="w-5 h-5 text-sky-500" />
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono font-bold">FastAPI + Redis</Badge>
              </div>
              <CardTitle className="text-sm font-semibold pt-1">High-Speed Offload Specs</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                Sub-5ms Redis cache-aside engine & Python FastAPI vector embedding / PDF parse offload pipelines.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* ─── ACTIVE & RECENT OPERATIONAL CYCLES ───────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold tracking-tight">Recent Operational Cycles</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/operations/runs")}
            className="text-xs text-muted-foreground hover:text-primary gap-1"
          >
            View All Runs & Timelines <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* 🎬 AI Film Production Studio Showcase & 8s Interactive Tour Card */}
        <Card
          data-tutorial="film-studio-card"
          data-testid="film-studio-card"
          className="border-purple-500/30 bg-purple-500/[0.04] shadow-sm hover:border-purple-500/50 transition-colors"
        >
          <CardHeader className="py-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      AI Film Production Studio (Project Chimera)
                    </CardTitle>
                    <Badge variant="outline" className="border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[11px] gap-1 font-mono">
                      <Sparkles className="w-3 h-3 text-purple-500 animate-pulse" /> Autonomous
                    </Badge>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[11px] gap-1 font-mono">
                      <ShieldCheck className="w-3 h-3 text-emerald-500" /> HIL Approved
                    </Badge>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[11px] gap-1 font-mono">
                      <Activity className="w-3 h-3 text-amber-500 animate-spin" /> In-Flight
                    </Badge>
                    <Badge variant="outline" className="border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10 text-[11px] gap-1 font-mono">
                      <Clock className="w-3 h-3 text-sky-500" /> 8s Pacing
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Multi-agent virtual crew (Creative Director, Visual Artist, Technical Director, Producer) orchestrating Scribe scripts, Seedance video takes, and conformed timeline delivery.
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/workspace/chat/crew-film-studio-alpha")}
                  className="gap-1.5 text-xs rounded-xl hover:bg-muted"
                >
                  <Film className="w-3.5 h-3.5 text-primary" /> Open Studio Room
                </Button>
                <Button
                  size="sm"
                  data-tutorial="film-studio-tour-trigger"
                  data-testid="start-film-studio-tour-btn"
                  onClick={() => {
                    startTutorial("film-studio-tour");
                  }}
                  className="gap-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start 8s Interactive Film Studio Tour
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Pipeline Stage Pips */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" /> Pipeline Flow:
              </span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">1. Scribe Script</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">2. Keyframe Pitches</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">3. HIL Dailies</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">4. Conformed Timeline</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">5. Executive Deck</span>
            </div>
          </CardHeader>
        </Card>

        {/* 🚨 Emergency Rescue & Service Dispatcher Showcase & 8s Interactive Tour Card */}
        <Card
          data-tutorial="rescue-dispatch-card"
          data-testid="rescue-dispatch-card"
          className="border-rose-500/30 bg-rose-500/[0.04] shadow-sm hover:border-rose-500/50 transition-colors"
        >
          <CardHeader className="py-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  <Siren className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      Emergency Rescue & Service Dispatcher (Apex Response)
                    </CardTitle>
                    <Badge variant="outline" className="border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10 text-[11px] gap-1 font-mono">
                      <Sparkles className="w-3 h-3 text-rose-500 animate-pulse" /> Autonomous
                    </Badge>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[11px] gap-1 font-mono">
                      <Cpu className="w-3 h-3 text-amber-500" /> H3 Spatial
                    </Badge>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[11px] gap-1 font-mono">
                      <ShieldCheck className="w-3 h-3 text-emerald-500" /> Form Agent
                    </Badge>
                    <Badge variant="outline" className="border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10 text-[11px] gap-1 font-mono">
                      <Clock className="w-3 h-3 text-sky-500" /> 8s Pacing
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Real-time multi-agent crisis response orchestrating H3 spatial anomaly detection, CREW war room deliberation, structured incident intake with geocoded data input, and tactical squad deployment.
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/workspace/chat/crew-rescue-dispatch-war-room")}
                  className="gap-1.5 text-xs rounded-xl hover:bg-muted"
                >
                  <Radio className="w-3.5 h-3.5 text-rose-500" /> Open War Room
                </Button>
                <Button
                  size="sm"
                  data-tutorial="rescue-dispatch-tour-trigger"
                  data-testid="start-rescue-dispatch-tour-btn"
                  onClick={() => {
                    startTutorial("rescue-dispatch-tour");
                  }}
                  className="gap-2 text-xs font-semibold rounded-xl bg-rose-600 text-white shadow-md hover:bg-rose-500"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start 8s Interactive Rescue Dispatch Tour
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Pipeline Stage Pips */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-rose-400" /> Lifecycle Flow:
              </span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">1. Anomaly Signal</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">2. War Room Triage</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">3. Structured Data Intake</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">4. SLA Verification</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">5. Squad Deployment</span>
            </div>
          </CardHeader>
        </Card>

        {/* 🌐 Enterprise Identity Bridge Showcase & 8s Interactive Tour Card */}
        <Card
          data-tutorial="identity-bridge-card"
          data-testid="identity-bridge-card"
          className="border-primary/30 bg-primary/[0.04] shadow-sm hover:border-primary/50 transition-colors"
        >
          <CardHeader className="py-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      Enterprise Identity Bridge (Zero-Party De-Anonymization)
                    </CardTitle>
                    <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 text-[11px] gap-1 font-mono">
                      <Sparkles className="w-3 h-3 text-primary animate-pulse" /> Zero-Party
                    </Badge>
                    <Badge variant="outline" className="border-indigo-500/40 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 text-[11px] gap-1 font-mono">
                      <Globe className="w-3 h-3 text-indigo-500" /> Reverse-IP
                    </Badge>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[11px] gap-1 font-mono">
                      <ShieldCheck className="w-3 h-3 text-emerald-500" /> S.C.O.R.E.
                    </Badge>
                    <Badge variant="outline" className="border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[11px] gap-1 font-mono">
                      <Cpu className="w-3 h-3 text-purple-500" /> Kafka Outbox
                    </Badge>
                    <Badge variant="outline" className="border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10 text-[11px] gap-1 font-mono">
                      <Clock className="w-3 h-3 text-sky-500" /> 8s Pacing
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Real-time anonymous-to-known visitor resolution. Connects web traffic, reverse-IP firmographics, and zero-party form fills to PostgreSQL and transactional Kafka outbox relays for autonomous CREW squad deliberation.
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/armory/identity-bridge")}
                  className="gap-1.5 text-xs rounded-xl hover:bg-muted"
                >
                  <Globe className="w-3.5 h-3.5 text-primary" /> Open Identity Bridge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsComputerUseDemoOpen(true);
                    if (computerUseStep === 0) {
                      void runComputerUseSimulation();
                    }
                  }}
                  className="gap-1.5 text-xs font-semibold rounded-xl border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 shadow-sm"
                  data-testid="run-computer-use-demo-btn"
                >
                  <Monitor className="w-3.5 h-3.5 text-purple-500" /> Run Computer Use Agent
                </Button>
                <Button
                  size="sm"
                  data-tutorial="identity-bridge-tour-trigger"
                  data-testid="start-identity-bridge-tour-btn"
                  onClick={() => {
                    startTutorial("identity-bridge-tour");
                  }}
                  className="gap-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start 8s Interactive Identity Bridge Tour
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Pipeline Stage Pips */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-primary" /> Resolution Flow:
              </span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">1. Anonymous Visit</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">2. Reverse-IP Match</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">3. S.C.O.R.E. Signals</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">4. Zero-Party Form Merge</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 font-mono font-semibold">5. Kafka Outbox Relay</span>
              <span>→</span>
              <span className="px-2 py-0.5 rounded-md bg-muted/60 font-mono">6. CREW Squad / Co-pilot Intervene</span>
            </div>

            {/* Live Example Code & Kafka Event Banner */}
            <div className="pt-2 border-t border-border/30 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-background/80 border border-border/50 p-2.5 font-mono">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                  <Fingerprint className="w-3 h-3 text-primary" /> Client SDK Identify Call
                </div>
                <pre className="text-[11px] text-foreground/90 overflow-x-auto whitespace-pre font-mono leading-tight">
{`window.OddjobProspector.identify("usr_acme_44", {
  email: "sarah.chen@vertex.io",
  role: "VP Engineering",
  account: "Vertex Financial"
});`}
                </pre>
              </div>
              <div className="rounded-lg bg-purple-500/[0.06] border border-purple-500/30 p-2.5 font-mono">
                <div className="text-[10px] text-purple-600 dark:text-purple-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-purple-500" /> Emitted Kafka spatial.signal.v1 Event
                </div>
                <pre className="text-[11px] text-purple-600 dark:text-purple-300 overflow-x-auto whitespace-pre font-mono leading-tight">
{`{
  topic: "spatial.signal.v1",
  type: "observation",
  subject: "prospect:usr_acme_44",
  payload: { eventType: "identity.resolved", severity: "info" }
}`}
                </pre>
              </div>
            </div>

            {/* 🖥️ Live Autonomous Virtual Desktop Browser Screen Displayed Directly in Demo */}
            <div className="pt-3 border-t border-border/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-1.5">
                <div className="text-xs font-bold flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-purple-500" />
                  Live Synthetic Customer Browser Behavior & Telemetry Stream
                  <Badge variant="outline" className="text-[10px] font-mono border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/10">
                    Gemini 2.5 Computer Use
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Multi-page navigation • Slow realistic mouse glide • Form Builder typing
                </div>
              </div>
              {renderVirtualComputerDesktop(false)}
            </div>
          </CardHeader>
        </Card>

        {activeCycle && (
          <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm">
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
                  <CardTitle className="text-base font-semibold">
                    Active Cycle: {activeCycle.name} (Cycle #{activeCycle.id})
                  </CardTitle>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 bg-amber-500/10 text-xs">
                    {activeCycle.status.toUpperCase()}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation(`/operations/cycles/${activeCycle.id}`)}
                  className="gap-1.5 text-xs bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20"
                >
                  Open Stepwise HUD <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Recent Cycles List */}
        {cyclesData && cyclesData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {cyclesData.slice(0, 4).map((cycle: any) => (
              <Card
                key={cycle.id}
                className="hover:border-primary/40 transition-colors cursor-pointer flex flex-col justify-between"
                onClick={() => setLocation(`/operations/cycles/${cycle.id}`)}
              >
                <CardHeader className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">Cycle #{cycle.id}</span>
                    <Badge
                      variant="outline"
                      className={
                        cycle.status === "completed"
                          ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px]"
                          : cycle.status === "active"
                          ? "border-amber-500/40 text-amber-600 bg-amber-500/10 text-[10px]"
                          : "text-[10px]"
                      }
                    >
                      {cycle.status.toUpperCase()}
                    </Badge>
                  </div>
                  <CardTitle className="text-sm font-semibold truncate pt-1">{cycle.name}</CardTitle>
                  <CardDescription className="text-xs flex items-center gap-1 text-muted-foreground">
                    <Clock className="w-3 h-3" /> {cycle.createdAt ? new Date(cycle.createdAt).toLocaleDateString() : "Recent"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 p-4 border-t border-muted/30 text-xs flex items-center justify-between text-primary font-medium">
                  <span>Open Cycle HUD</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ─── INSTALLED APP ARSENAL GRID ───────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight">Installed App Arsenal</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/armory/new")}
            className="text-xs gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Forge New App
          </Button>
        </div>

        {/* 📌 Pinned Apps Launchpad Strip */}
        {pinnedApps.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pin className="w-4 h-4 text-amber-500 fill-amber-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Pinned Launchpad Apps</h3>
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 bg-amber-500/10">
                  {pinnedApps.length} Pinned
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {pinnedApps.map((app: any) => (
                <div
                  key={"pinned-" + app.slug}
                  onClick={() => openApp(app)}
                  className="p-3 rounded-xl border border-amber-500/30 bg-background/80 hover:border-amber-500/60 hover:bg-muted/40 cursor-pointer transition-all flex items-center justify-between group shadow-sm"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 flex-shrink-0">
                      <Rocket className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate block">
                        {app.title}
                      </span>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">/app/{app.slug}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => togglePinApp(app.slug, e)}
                    className="h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/20 flex-shrink-0 ml-2"
                    title="Unpin app from Launchpad"
                  >
                    <PinOff className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {appsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : filteredApps.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {filteredApps.slice(0, 6).map((app: any) => {
              const isPinned = pinnedAppSlugs.includes(app.slug);
              return (
                <Card
                  key={app.slug}
                  className={`group transition-all duration-200 hover:shadow-md cursor-pointer flex flex-col justify-between ${
                    isPinned ? "border-amber-500/40 bg-amber-500/[0.02]" : "hover:border-primary/50"
                  }`}
                  onClick={() => openApp(app)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base font-semibold group-hover:text-primary transition-colors">
                        {app.title}
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                          {app.availability || "Installed"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => togglePinApp(app.slug, e)}
                          className={`h-7 w-7 rounded-lg transition-all ${
                            isPinned
                              ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
                              : "text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-amber-500 hover:bg-muted/40"
                          }`}
                          title={isPinned ? "Unpin from Launchpad" : "Pin to Launchpad"}
                        >
                          <Pin className={`w-3.5 h-3.5 ${isPinned ? "fill-amber-500 text-amber-500" : ""}`} />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-xs line-clamp-2 mt-1">
                      {app.description || `App Forge deployment (${app.slug})`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 flex items-center justify-between text-xs text-muted-foreground border-t border-muted/30 mt-auto py-3">
                    <span className="font-mono text-[11px]">/app/{app.slug}</span>
                    <span className="flex items-center gap-1 font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                      {app.actionLabel || "Launch App"} <ExternalLink className="w-3 h-3" />
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-8 text-center text-muted-foreground border-dashed">
            No installed apps found matching query.
          </Card>
        )}
      </div>

      {/* ─── PUBLISHED AGENT AI FLEET ─────────────────────────────────────────── */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight">Published Agent AI Fleet</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/operations/agents")}
            className="text-xs gap-1"
          >
            Manage Agents
          </Button>
        </div>

        {agentsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : agents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {agents.slice(0, 6).map((agent: any) => (
              <Card
                key={agent.id || agent.slug}
                className="group hover:border-primary/40 transition-all p-5 space-y-3 cursor-pointer flex flex-col justify-between"
                onClick={() => openAgent(agent)}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-semibold text-sm group-hover:text-primary transition-colors">{agent.name || agent.title || agent.slug}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      Agent Persona
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {agent.description || agent.desc || "Governed AI agent persona ready for interaction."}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-muted/30 text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunchAgentModal(agent);
                    }}
                    className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
                  >
                    Quick Modal
                  </button>
                  <span className="flex items-center gap-1 font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                    Launch Agent <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "Rescue Dispatch AI Coordinator", slug: "rescue-coordinator", desc: "Emergency incident triage, Uber H3 spatial telemetry evaluation & field squad dispatch.", role: "Emergency Operations Specialist" },
              { name: "Autonomous Codegen Architect", slug: "codegen-architect", desc: "Conversational text-to-app generator, AST validator, and live sandbox compiler.", role: "App Forge Specialist" },
              { name: "BudgetMaster Financial Controller", slug: "budgetmaster-advisor", desc: "Enterprise spend anomaly detection, forecast modeling & multi-signature approval gates.", role: "Financial Governance Specialist" },
              { name: "Workforce Upskilling Supervisor", slug: "workforce-supervisor", desc: "Autonomous agent reliability auditor, PIP monitor & automated skill mutation runner.", role: "Agentic HR Specialist" },
              { name: "Hybrid SDLC Release Overseer", slug: "sdlc-overseer", desc: "5-layer autonomy policy enforcement, tamper-proof audit trails & CI verification.", role: "Governance Specialist" },
              { name: "SRE Chaos & Telemetry Sentinel", slug: "sre-sentinel", desc: "FastAPI/Redis offload pipeline monitor, causal failure reasoning & automatic failover.", role: "Reliability Engineering Specialist" }
            ].map((agent) => (
              <Card
                key={agent.slug}
                className="group hover:border-primary/40 transition-all p-5 space-y-3 cursor-pointer flex flex-col justify-between"
                onClick={() => openAgent(agent)}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-semibold text-sm group-hover:text-primary transition-colors">{agent.name}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Active</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{agent.desc}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-muted/30 text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunchAgentModal(agent);
                    }}
                    className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
                  >
                    Quick Modal
                  </button>
                  <span className="flex items-center gap-1 font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                    Launch Agent <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ─── QUICK FOOTER LINKS ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-muted/40">
        <Card className="p-4 flex items-center justify-between hover:bg-muted/20 cursor-pointer" onClick={() => setLocation("/operations")}>
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-primary" />
            <div>
              <h4 className="text-sm font-semibold">Operations & Cycles</h4>
              <p className="text-xs text-muted-foreground">Manage active operational cycles and pipeline steps</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Card>
        <Card className="p-4 flex items-center justify-between hover:bg-muted/20 cursor-pointer" onClick={() => setLocation("/knowledge")}>
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <h4 className="text-sm font-semibold">Knowledge & Datasets</h4>
              <p className="text-xs text-muted-foreground">Explore vector knowledge graphs and output datasets</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Card>
      </div>

      {/* ─── PUBLISHED AGENT EXECUTION MODAL ─────────────────────────────── */}
      <Dialog
        open={!!selectedAgentForModal}
        onOpenChange={(open) => {
          if (!open) setSelectedAgentForModal(null);
        }}
      >
        <DialogContent className="sm:max-w-[540px] rounded-2xl border border-primary/20 bg-background/95 backdrop-blur-md">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">
                  {selectedAgentForModal?.name || selectedAgentForModal?.title || "Published Agent Persona"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedAgentForModal?.role || selectedAgentForModal?.desc || "Governed AI agent execution worker."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-muted/30 border border-muted/40 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Persona System Prompt</span>
              <p className="text-xs text-foreground/90 italic line-clamp-3">
                "{selectedAgentForModal?.systemPrompt || selectedAgentForModal?.desc || "Specialized domain agent with governed execution tools and safety policies."}"
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Instruction / Workflow Parameters</label>
              <Textarea
                value={agentInstruction}
                onChange={(e) => setAgentInstruction(e.target.value)}
                placeholder="Enter instructions for this published agent..."
                className="min-h-[90px] rounded-xl text-xs bg-background/60"
              />
            </div>

            {agentExecutionResult && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Execution Output</span>
                <p className="text-xs font-mono text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">{agentExecutionResult}</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 pt-2 border-t border-muted/30">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedAgentForModal(null)} className="text-xs">
                Close
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedAgentForModal) {
                    openAgent(selectedAgentForModal);
                    setSelectedAgentForModal(null);
                  }
                }}
                className="text-xs gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in New Window
              </Button>
            </div>
            <Button
              size="sm"
              onClick={handleRunAgentWorkflow}
              disabled={isExecutingAgent || !agentInstruction.trim()}
              className="text-xs gap-1.5 rounded-xl font-semibold"
            >
              {isExecutingAgent ? (
                <>
                  <Zap className="w-3.5 h-3.5 animate-spin text-amber-400" /> Executing Agent...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Execute Agent Workflow
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🖥️ Autonomous Computer Use Simulation Modal */}
      <Dialog open={isComputerUseDemoOpen} onOpenChange={setIsComputerUseDemoOpen}>
        <DialogContent className="max-w-6xl bg-card border-border shadow-2xl rounded-2xl max-h-[94vh] overflow-y-auto">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Monitor className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  Autonomous Computer Use Agent Demo
                  <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/10 font-mono">
                    Synthetic Customer Journey
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Simulating a sandboxed Linux desktop agent autonomously browsing, inspecting solutions, evaluating pricing quotas, filling the deployed Form Builder, and emitting Kafka signals.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-3 space-y-4">
            {/* Step Pipeline Visualization */}
            <div className="grid grid-cols-5 gap-1 text-[11px] font-mono">
              {COMPUTER_USE_STEPS.map((s) => {
                const isActive = computerUseStep === s.step;
                const isPassed = computerUseStep > s.step;
                return (
                  <div
                    key={s.step}
                    className={`p-2 rounded-lg border text-center transition-all ${
                      isActive
                        ? "border-purple-500 bg-purple-500/15 text-purple-700 dark:text-purple-300 font-semibold shadow-sm"
                        : isPassed
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border/40 bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <div className="text-[10px] uppercase opacity-80">Stage {s.step}</div>
                    <div className="truncate text-[10px] font-semibold mt-0.5">{s.badge}</div>
                  </div>
                );
              })}
            </div>

            {/* 🖥️ Virtual Computer Desktop Monitor Frame (Fullscreen Modal View) */}
            {renderVirtualComputerDesktop(true)}

            {/* Active Step Terminal HUD */}
            {computerUseStep > 0 && computerUseStep <= COMPUTER_USE_STEPS.length && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                    {isSimulating ? <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                    {COMPUTER_USE_STEPS[computerUseStep - 1].title}
                  </div>
                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10 font-mono">
                    {COMPUTER_USE_STEPS[computerUseStep - 1].badge}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {COMPUTER_USE_STEPS[computerUseStep - 1].description}
                </p>
                <div className="text-[11px] text-purple-700 dark:text-purple-300 font-mono bg-purple-500/10 px-2 py-1 rounded-md">
                  {COMPUTER_USE_STEPS[computerUseStep - 1].details}
                </div>
                <pre className="text-[11px] font-mono bg-background/80 border border-border/50 p-2.5 rounded-lg text-foreground/90 overflow-x-auto whitespace-pre leading-tight">
                  {COMPUTER_USE_STEPS[computerUseStep - 1].code}
                </pre>
              </div>
            )}

            {/* Simulation Completed Banner */}
            {computerUseStep === 5 && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Autonomous Closed Loop Complete
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The Computer Use agent successfully traversed the multi-page customer journey, evaluated pricing quotas, submitted the deployed Form Builder, merged the lead in PostgreSQL, wrote to the Kafka Outbox, and handed off to CREW.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsComputerUseDemoOpen(false)}
                className="text-xs"
              >
                Close
              </Button>
              {computerUseStep === 5 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsComputerUseDemoOpen(false);
                    setLocation("/armory/identity-bridge");
                  }}
                  className="text-xs gap-1"
                >
                  <Globe className="w-3.5 h-3.5 text-primary" /> View Armory Leads
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={computerUseStep === 5 ? "outline" : "default"}
                onClick={() => void runComputerUseSimulation()}
                disabled={isSimulating}
                className="text-xs gap-1.5 font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isSimulating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Agent Browsing Page {computerUseStep}/5...
                  </>
                ) : computerUseStep === 5 ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" /> Replay Customer Simulation
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" /> Start Autonomous Simulation
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
