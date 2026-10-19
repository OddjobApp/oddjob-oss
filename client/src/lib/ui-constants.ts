
export const COMMON_ROUTES = [
    "/dashboard",
    "/jobs",
    "/jobs/:id",
    "/pipelines",
    "/pipelines/:id",
    "/knowledge",
    "/health",
    "/settings"
];

export const SYSTEM_ACTIONS = [
    { value: "user_idle_10s", label: "User Idle (10s)" },
    { value: "input_focus", label: "Input Focus" },
    { value: "click", label: "General Click" },
    { value: "save-button", label: "Save Button Click" },
    { value: "delete-button", label: "Delete Button Click" }
];

export const VECTORS = {
    S: { label: "Symptom", color: "red" },
    C: { label: "Cause", color: "orange" },
    O: { label: "Outcome", color: "blue" },
    R: { label: "Resource", color: "purple" },
    E: { label: "Effect", color: "green" }
};

// === Hierarchy Constants ===

// Level 1: Pages
export const PAGES = [
    { value: "/dashboard", label: "Dashboard" },
    { value: "/jobs", label: "Jobs" },
    { value: "/jobs/:id", label: "Job Detail" },
    { value: "/pipelines", label: "Pipelines" },
    { value: "/pipelines/:id", label: "Pipeline Detail" },
    { value: "/knowledge", label: "Knowledge" },
    { value: "/settings", label: "Settings" },
    { value: "/health", label: "Health" },
    { value: "/health/observability", label: "Observability" },
    { value: "/health/monitoring", label: "Monitoring" },
    { value: "/health/alerts", label: "Alerts" },
    { value: "/platform-maintenance", label: "Platform Maintenance" },
    { value: "/connections", label: "Connections" },
    { value: "/connections/credentials", label: "Credentials" },
    { value: "/forensics", label: "Forensics" },
    { value: "/forms", label: "Forms" },
    { value: "/admin/*", label: "Admin" },
];

// Level 2: Page States
export const PAGE_STATES = [
    { value: "list", label: "List View" },
    { value: "detail", label: "Detail View" },
    { value: "create", label: "Create Mode" },
    { value: "edit", label: "Edit Mode" },
    { value: "report", label: "Report View" },
    { value: "summary", label: "Summary View" },
    { value: "config", label: "Config Mode" },
    { value: "error", label: "Error State" },
];

// Level 2b: Available States by Page (Inferred)
export const AVAILABLE_PAGE_STATES: Record<string, string[]> = {
    // Dashboard & Stats
    "Dashboard": ["summary", "report", "error"],
    "Observability": ["summary", "report", "error"],
    "Platform Maintenance": ["summary", "list", "config", "error"],
    "Forensics": ["summary", "list", "detail", "error"],
    "Health": ["summary", "list", "error"],
    "Cost Analysis": ["summary", "report", "error"],

    // Resource Management (List/Create/Detail generic pattern)
    "Jobs": ["list", "create", "error"],
    "Job Detail": ["detail", "edit", "config", "summary", "error"],
    "Pipelines": ["list", "create", "error"],
    "Pipeline Detail": ["detail", "edit", "config", "summary", "error"],
    "Knowledge": ["list", "create", "detail", "edit", "error"],
    "Connections": ["summary", "list", "config", "error"],
    "Credentials": ["list", "create", "edit", "error"],
    "Events": ["list", "detail", "summary", "error"],
    "Alerts": ["list", "create", "config", "error"],
    "Forms": ["list", "create", "edit", "config", "error"],

    // Config specific
    "Settings": ["config", "edit", "error"],
    "Admin": ["config", "list", "create", "edit", "error"],
};

// Level 3: Cards by Page
export const AVAILABLE_CARDS: Record<string, string[]> = {
    "Dashboard": ["Performance", "Active Jobs", "Recent Activity", "System Health", "Total Spend", "Active Models", "Error Rate"],
    "Jobs": ["Job List", "Create Job", "Job Type Selection", "Job Filters"],
    "Job Detail": ["Overview Tab", "Configuration Tab", "Output Tab", "Schedule Tab", "Execution Log", "Run History", "Connections"],
    "Pipelines": ["Pipeline List", "Pipeline Details", "Execution Steps", "Configuration", "Results"],
    "Pipeline Detail": ["Step Builder", "Execution Log", "Results Tab", "Config Tab"],
    "Knowledge": ["Topics List", "Documents", "Batch Extractions", "Datasets", "Create Topic", "Add Document", "Document Viewer"],
    "Settings": ["General Settings", "AI Settings", "API Keys", "Notification Settings", "System Defaults"],
    "Observability": ["Global AI Token Usage", "Trace Volume", "Error Rate Hotspots", "Token Usage by Model", "Average Latency", "Trace Waterfall"],
    "Platform Maintenance": ["Snapshot Ledger", "Documentation Coverage", "Software Audit", "System Evolution", "Autoresearch", "System Graph"],
    "Credentials": ["API Keys List", "OAuth Connections", "Service Accounts", "Add Credential Form"],
    "Alerts": ["Active Alerts", "Alert History", "Alert Configuration", "Alert Row"],
    "Forensics": ["Forensic Log", "Session Replay", "User Activity", "Event Timeline"],
    "Forms": ["Form Builder", "Form Submissions", "Form Analytics"],
    "Health": ["System Status", "Service Health", "Connection Status", "Queue Health"],
    "Cost Analysis": ["Total Spend", "Cost by Model", "Cost by Job", "Usage Trends"],
    "Events": ["Event Stream", "Event Filters", "Event Details"],
    "Identity": ["Identity Verification", "Job Execution Result"],
};

// Level 4: Element Types
export const ELEMENT_TYPES = [
    { value: "input", label: "Input Field" },
    { value: "button", label: "Button" },
    { value: "link", label: "Link" },
    { value: "select", label: "Dropdown/Select" },
    { value: "checkbox", label: "Checkbox/Toggle" },
    { value: "video", label: "Video Player" },
    { value: "tab", label: "Tab" },
];

// Level 5: Activities by Level
export const ACTIVITIES = {
    page: [
        { value: "page_view", label: "Page View" },
        { value: "time_on_page_30s", label: "Time on Page > 30s" },
        { value: "time_on_page_60s", label: "Time on Page > 60s" },
        { value: "scroll_25", label: "Scroll 25%" },
        { value: "scroll_50", label: "Scroll 50%" },
        { value: "scroll_90", label: "Scroll 90%" },
        { value: "bounce", label: "Bounce (Left Immediately)" },
        { value: "navigate_next", label: "Navigate to Next Page" },
    ],
    pageState: [
        { value: "state_enter", label: "Enter State" },
        { value: "state_transition", label: "State Transition" },
        { value: "modal_open", label: "Modal Opened" },
        { value: "modal_close", label: "Modal Closed" },
        { value: "error_state", label: "Error State" },
        { value: "success_state", label: "Success State" },
        { value: "loading_timeout", label: "Loading Timeout" },
    ],
    card: [
        { value: "impression", label: "Card Impression (Viewed)" },
        { value: "hover_2s", label: "Hover 2+ seconds" },
        { value: "hover_5s", label: "Hover 5+ seconds" },
        { value: "expand", label: "Expand/Accordion" },
        { value: "collapse", label: "Collapse" },
        { value: "internal_scroll", label: "Internal Scroll" },
        { value: "focus", label: "Focus" },
    ],
    element: [
        { value: "input_focus", label: "Input Focus" },
        { value: "input_change", label: "Input Change" },
        { value: "video_play", label: "Video Play" },
        { value: "video_pause", label: "Video Pause" },
        { value: "video_complete", label: "Video Complete" },
        { value: "link_click_internal", label: "Internal Link Click" },
        { value: "link_click_external", label: "External Link Click" },
        { value: "button_click", label: "Button Click" },
        { value: "select_change", label: "Select Change" },
        { value: "cta_click", label: "CTA Click" },
        { value: "field_entry", label: "Field Entry" },
        { value: "nav_click", label: "Navigation Click" },
        { value: "toggle_on", label: "Toggle On" },
        { value: "toggle_off", label: "Toggle Off" },
    ],
};

// Activity Modifiers
export const ACTIVITY_MODIFIERS = [
    { value: "click", label: "Click", multiplier: 1.0 },
    { value: "double_click", label: "Double Click", multiplier: 0.5 },
    { value: "right_click", label: "Right Click", multiplier: 0.8 },
    { value: "change", label: "Value Change", multiplier: 1.5 },
    { value: "paste", label: "Paste", multiplier: 1.3 },
    { value: "submit", label: "Submit", multiplier: 2.0 },
    { value: "drag", label: "Drag", multiplier: 1.2 },
    { value: "drop", label: "Drop", multiplier: 1.5 },
];

// Triggered Action Types
export const TRIGGERED_ACTION_TYPES = {
    ui: [
        { value: "toast", label: "Toast Notification" },
        { value: "tooltip", label: "Tooltip" },
        { value: "modal", label: "Modal Dialog" },
        { value: "inline_help", label: "Inline Help" },
        { value: "highlight", label: "Highlight Element" },
        { value: "badge", label: "Badge/Indicator" },
        { value: "confetti", label: "Confetti Celebration" },
        { value: "progress", label: "Progress Indicator" },
    ],
    application: [
        { value: "concierge_prompt", label: "Concierge Prompt" },
        { value: "auto_expand", label: "Auto-Expand Section" },
        { value: "prefill", label: "Pre-fill Suggestion" },
        { value: "navigate", label: "Navigate/Redirect" },
        { value: "log_event", label: "Log Analytics Event" },
        { value: "send_notification", label: "Send Notification" },
        { value: "trigger_job", label: "Trigger Background Job" },
    ],
};

