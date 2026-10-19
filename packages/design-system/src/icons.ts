/**
 * Icon Registry - Unified mapping of semantic icons to lucide-react
 *
 * Provides a single source of truth for icon usage across Oddjob.
 * Rather than importing lucide-react icons directly, components should use this registry.
 */

import type { LucideIcon } from "lucide-react";
import {
  // Status icons
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Pause,
  Play,
  RefreshCw,

  // Navigation & UI
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  Menu,
  Settings,
  Home,
  MoreVertical,
  MoreHorizontal,

  // Data & Analysis
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  PieChart,
  LineChart,
  Target,
  Zap,
  Gauge,

  // Execution & Operations
  Play as PlayIcon,
  Pause as PauseIcon,
  Square as Stop,
  SkipForward,
  RotateCcw,
  GitBranch,
  GitCommit,

  // Actions
  Edit,
  Copy,
  Download,
  Upload,
  Share2,
  Trash2,
  Lock,
  Unlock,
  Eye,
  EyeOff,

  // Search & Filter
  Search,
  Filter,
  Sliders,
  ChevronsDown,

  // Time & Calendar
  Calendar,
  CalendarClock,
  Clock3,
  Hourglass,

  // Communication & Alerts
  Bell,
  Send,
  MessageSquare,
  AlertTriangle as WarningIcon,
  Info,
  HelpCircle as Help,

  // Workflow
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  GitMerge,
  Workflow,

  // Execution types
  Bot,
  Users,
  User,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,

  // Process
  Loader2,
  Loader,
  CheckCheck,
  Minus,
  Plus,

  // Mission & Cycle specific
  Briefcase,
  Layers,
  Map,
  Compass,
  Target as GoalIcon,
  Lightbulb,
  Database,
  GitBranch as BranchIcon,
  Workflow as WorkflowIcon,
  Zap as PowerIcon,
  BarChart3 as MetricsIcon,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// ICON REGISTRY - Semantic grouping
// ─────────────────────────────────────────────────────────────────────────────

export const iconRegistry = {
  // Status indicators
  status: {
    completed: CheckCircle2,
    success: CheckCircle2,
    failed: XCircle,
    error: XCircle,
    pending: Clock,
    warning: AlertTriangle,
    paused: Pause,
    running: Activity,
    retrying: RefreshCw,
    recovering: RefreshCw,
    stopped: Stop,
  },

  // Execution strategy specific
  execution: {
    prePlanned: Calendar,
    dynamicAutonomous: Zap,
    rollingWave: Layers,
    humanDriven: Users,
    parallelFanOut: GitBranch,
    reactive: AlertCircle,
  },

  // Navigation & UI chrome
  nav: {
    menu: Menu,
    home: Home,
    settings: Settings,
    back: ChevronLeft,
    forward: ChevronRight,
    up: ChevronUp,
    down: ChevronDown,
    more: MoreVertical,
    moreHorizontal: MoreHorizontal,
    close: X,
  },

  // Cycle/Mission operations
  operations: {
    pause: Pause,
    resume: Play,
    stop: Stop,
    skip: SkipForward,
    undo: RotateCcw,
    reset: RotateCcw,
    save: Download,
    load: Upload,
  },

  // Data visualization
  visualization: {
    trend: TrendingUp,
    down: TrendingDown,
    chart: BarChart3,
    pie: PieChart,
    line: LineChart,
    gauge: Gauge,
    metrics: Activity,
    target: Target,
  },

  // Mission types
  missionType: {
    aiAgent: Bot,
    research: Lightbulb,
    analysis: BarChart3,
    processing: Database,
    coordination: Users,
    verification: CheckCircle2,
    deployment: Zap,
    testing: AlertTriangle,
  },

  // Phase/Wave indicators
  phase: {
    current: Activity,
    completed: CheckCircle2,
    pending: Clock,
    milestone: Target,
    gate: Lock,
  },

  // Workflow/Dependency visualization
  workflow: {
    node: Circle,
    edge: ArrowRight,
    merge: GitMerge,
    branch: GitBranch,
    loop: RefreshCw,
    decision: GitBranch,
  },

  // Economic/Resource indicators
  resources: {
    budget: Gauge,
    cost: TrendingDown,
    tokens: Zap,
    time: Clock,
    efficiency: Target,
  },

  // Actions
  actions: {
    edit: Edit,
    delete: Trash2,
    copy: Copy,
    download: Download,
    upload: Upload,
    share: Share2,
    view: Eye,
    hide: EyeOff,
    lock: Lock,
    unlock: Unlock,
  },

  // Search & Filter
  search: {
    search: Search,
    filter: Filter,
    sliders: Sliders,
    expand: ChevronsDown,
  },

  // Time-related
  time: {
    calendar: Calendar,
    clock: Clock,
    hourglass: Hourglass,
    timer: Clock3,
    scheduled: CalendarClock,
  },

  // Alerts & Communication
  alerts: {
    info: Info,
    warning: AlertTriangle,
    error: AlertCircle,
    success: CheckCircle2,
    notification: Bell,
    message: MessageSquare,
  },

  // Common actions
  common: {
    loading: Loader2,
    help: Help,
    send: Send,
    add: Plus,
    subtract: Minus,
    done: CheckCheck,
    check: CheckCircle2,
  },

  // Zoom/Scale
  zoom: {
    in: ZoomIn,
    out: ZoomOut,
    fit: Maximize2,
    minimize: Minimize2,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ICON ALIASES - Common names that map to semantic icons
// ─────────────────────────────────────────────────────────────────────────────

export const iconAliases: Record<string, LucideIcon> = {
  // Status
  "status.completed": CheckCircle2,
  "status.failed": XCircle,
  "status.running": Activity,
  "status.pending": Clock,
  "status.warning": AlertTriangle,
  "status.paused": Pause,

  // Actions
  "action.play": Play,
  "action.pause": Pause,
  "action.stop": Stop,
  "action.delete": Trash2,
  "action.edit": Edit,
  "action.save": Download,

  // Navigation
  "nav.back": ChevronLeft,
  "nav.forward": ChevronRight,
  "nav.menu": Menu,
  "nav.close": X,

  // Data
  "data.up": TrendingUp,
  "data.down": TrendingDown,
  "data.chart": BarChart3,

  // Time
  "time.calendar": Calendar,
  "time.clock": Clock,

  // Mission
  "mission.ai": Bot,
  "mission.team": Users,
  "mission.research": Lightbulb,
  "mission.deployment": Zap,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get icon by path (e.g., "status.completed")
 */
export function getIcon(path: string): LucideIcon | null {
  const parts = path.split(".");
  let current: any = iconRegistry;

  for (const part of parts) {
    current = current?.[part];
    if (!current) return null;
  }

  return current as LucideIcon;
}

/**
 * Get icon by alias (e.g., "status.completed")
 */
export function getIconByAlias(alias: string): LucideIcon | null {
  return iconAliases[alias] || null;
}

/**
 * Type-safe status icon getter
 */
export function getStatusIcon(status: keyof typeof iconRegistry.status): LucideIcon {
  return iconRegistry.status[status];
}

/**
 * Type-safe execution strategy icon getter
 */
export function getExecutionIcon(strategy: keyof typeof iconRegistry.execution): LucideIcon {
  return iconRegistry.execution[strategy];
}

/**
 * Type-safe mission type icon getter
 */
export function getMissionTypeIcon(type: keyof typeof iconRegistry.missionType): LucideIcon {
  return iconRegistry.missionType[type];
}

export default iconRegistry;
