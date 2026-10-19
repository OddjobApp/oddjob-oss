/**
 * Job Type Configuration
 * Icons, colors, and metadata for each job type
 */

import {
    Globe,
    Terminal,
    Brain,
    Database,
    UserCheck,
    Settings,
    Code,
    Monitor,
    type LucideIcon,
} from "lucide-react";

export interface JobTypeConfig {
    type: string;
    label: string;
    icon: string; // Icon name for dynamic import
    color: string;
    bgColor: string;
    borderColor: string;
    description: string;
    features: string[];
    category: "integration" | "ai" | "automation" | "data" | "human";
    /** Whether this job type is deprecated and should not be used for new jobs */
    isDeprecated?: boolean;
    /** The job type to use instead of this deprecated type */
    migrateTo?: string;
    /** Reason for deprecation */
    deprecationReason?: string;
}

export const JOB_TYPE_CONFIG: Record<string, JobTypeConfig> = {
    curl: {
        type: "curl",
        label: "HTTP Request",
        icon: "Globe",
        color: "#3b82f6", // blue-500
        bgColor: "#eff6ff", // blue-50
        borderColor: "#93c5fd", // blue-300
        description: "Make HTTP requests to external APIs",
        features: ["Request history", "Replay capability", "Response time tracking"],
        category: "integration",
    },
    api: {
        type: "api",
        label: "API Call (Legacy)",
        icon: "Globe",
        color: "#6b7280",
        bgColor: "#f3f4f6",
        borderColor: "#d1d5db",
        description: "Legacy REST API integration - use HTTP Request instead",
        features: ["Request history", "Auth management", "Rate limiting"],
        category: "integration",
        isDeprecated: true,
        migrateTo: "curl",
        deprecationReason: "Consolidated into HTTP Request (curl) type",
    },
    openapi: {
        type: "openapi",
        label: "OpenAPI",
        icon: "Code",
        color: "#06b6d4", // cyan-500
        bgColor: "#ecfeff",
        borderColor: "#67e8f9",
        description: "OpenAPI specification-based calls",
        features: ["Auto-discovery", "Schema validation", "Request builder"],
        category: "integration",
    },
    ai_agent: {
        type: "ai_agent",
        label: "AI Agent",
        icon: "Brain",
        color: "#8b5cf6", // violet-500
        bgColor: "#f5f3ff",
        borderColor: "#c4b5fd",
        description: "Intelligent AI-powered agent",
        features: ["Token tracking", "Prompt testing", "Streaming output"],
        category: "ai",
    },
    ai_api_call: {
        type: "ai_api_call",
        label: "AI API",
        icon: "Brain",
        color: "#8b5cf6",
        bgColor: "#f5f3ff",
        borderColor: "#c4b5fd",
        description: "Direct LLM API call",
        features: ["Cost estimation", "Token usage", "Model selection"],
        category: "ai",
    },
    dataset: {
        type: "dataset",
        label: "Dataset",
        icon: "Database",
        color: "#10b981", // emerald-500
        bgColor: "#ecfdf5",
        borderColor: "#6ee7b7",
        description: "Data processing and transformation",
        features: ["Data preview", "Schema validation", "Output datasets"],
        category: "data",
    },
    shell: {
        type: "shell",
        label: "Shell Script",
        icon: "Terminal",
        color: "#64748b", // slate-500
        bgColor: "#f8fafc",
        borderColor: "#cbd5e1",
        description: "Execute shell commands",
        features: ["Live output streaming", "Timeout control", "Environment vars"],
        category: "automation",
    },
    script: {
        type: "script",
        label: "Script",
        icon: "Terminal",
        color: "#64748b",
        bgColor: "#f8fafc",
        borderColor: "#cbd5e1",
        description: "Custom script execution",
        features: ["Multi-language support", "Output capture", "Error handling"],
        category: "automation",
    },
    human_approval: {
        type: "human_approval",
        label: "Human Approval",
        icon: "UserCheck",
        color: "#f97316", // orange-500
        bgColor: "#fff7ed",
        borderColor: "#fdba74",
        description: "Human-in-the-loop checkpoint",
        features: ["Escalation rules", "Auto-approval", "Delegation"],
        category: "human",
    },
    computer_use: {
        type: "computer_use",
        label: "Computer Use",
        icon: "Monitor",
        color: "#0ea5e9", // sky-500
        bgColor: "#f0f9ff", // sky-50
        borderColor: "#7dd3fc", // sky-300
        description: "Agent-driven desktop & browser automation via Trycua",
        features: ["Screenshot verification", "Windows / Linux / macOS", "Session lifecycle management"],
        category: "automation",
    },
};

// Icon mapping for dynamic resolution
export const JOB_TYPE_ICONS: Record<string, LucideIcon> = {
    Globe,
    Terminal,
    Brain,
    Database,
    UserCheck,
    Settings,
    Code,
};

export function getJobTypeConfig(type: string): JobTypeConfig {
    return JOB_TYPE_CONFIG[type] || {
        type,
        label: type,
        icon: "Settings",
        color: "#6b7280",
        bgColor: "#f3f4f6",
        borderColor: "#d1d5db",
        description: "Unknown job type",
        features: [],
        category: "automation",
    };
}

export function getJobTypeIcon(type: string): LucideIcon {
    const config = getJobTypeConfig(type);
    return JOB_TYPE_ICONS[config.icon] || Settings;
}

// Health score colors
export const HEALTH_SCORE_COLORS = {
    excellent: { color: "#22c55e", bg: "#dcfce7", label: "Excellent" },
    good: { color: "#84cc16", bg: "#ecfccb", label: "Good" },
    fair: { color: "#eab308", bg: "#fef9c3", label: "Fair" },
    poor: { color: "#f97316", bg: "#ffedd5", label: "Poor" },
    critical: { color: "#ef4444", bg: "#fee2e2", label: "Critical" },
};

export function getHealthScoreStyle(score: number): { color: string; bg: string; label: string } {
    if (score >= 90) return HEALTH_SCORE_COLORS.excellent;
    if (score >= 75) return HEALTH_SCORE_COLORS.good;
    if (score >= 60) return HEALTH_SCORE_COLORS.fair;
    if (score >= 40) return HEALTH_SCORE_COLORS.poor;
    return HEALTH_SCORE_COLORS.critical;
}

// Job status colors
export const JOB_STATUS_COLORS = {
    active: { color: "#10b981", bg: "#ecfdf5" },
    inactive: { color: "#6b7280", bg: "#f3f4f6" },
    error: { color: "#ef4444", bg: "#fef2f2" },
    warning: { color: "#f59e0b", bg: "#fffbeb" },
    running: { color: "#3b82f6", bg: "#eff6ff" },
};
