/**
 * Status Badge Utilities
 * 
 * Shared utilities for rendering status badges consistently across the application.
 * Previously duplicated in 6+ files.
 */

import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, XCircle, Play, Clock, AlertTriangle } from "lucide-react";

/**
 * Get a visual badge for execution status (pipeline, step, etc.)
 * Used in: PipelineExecutionDetail, PipelineExecutions, Monitoring, Dashboard, ScheduleDetail, Executions
 */
export function getStatusBadge(status: string) {
    switch (status.toLowerCase()) {
        case 'completed':
        case 'success':
            return <Badge variant="default" className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="w-3 h-3" />Completed</Badge>;
        case 'failed':
        case 'failure':
            return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Failed</Badge>;
        case 'running':
            return <Badge variant="default" className="bg-blue-100 text-blue-800 gap-1"><Play className="w-3 h-3" />Running</Badge>;
        case 'pending':
            return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
        case 'waiting':
        case 'waiting_async':
        case 'waiting_external_input':
            return <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50 gap-1"><AlertTriangle className="w-3 h-3" />Waiting</Badge>;
        case 'skipped':
            return <Badge variant="secondary">Skipped</Badge>;
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
}

/**
 * Get a visual badge for step-level status (more granular than execution status)
 */
export function getStepStatusBadge(status: string) {
    switch (status.toLowerCase()) {
        case 'success':
            return <Badge variant="default" className="bg-green-100 text-green-800">Success</Badge>;
        case 'failure':
            return <Badge variant="destructive">Failed</Badge>;
        case 'running':
            return <Badge variant="default" className="bg-blue-100 text-blue-800">Running</Badge>;
        case 'skipped':
            return <Badge variant="secondary">Skipped</Badge>;
        case 'pending':
            return <Badge variant="secondary">Pending</Badge>;
        case 'waiting_async':
        case 'waiting_external_input':
            return <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Waiting Approval</Badge>;
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
}

/**
 * Format duration in seconds to a human-readable string
 * e.g. "45s", "3m 25s", "1h 5m 30s"
 */
export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return 'N/A';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m ${secs}s`;
}

/**
 * Get a badge for job/pipeline active status
 */
export function getActiveBadge(isActive: boolean) {
    return isActive
        ? <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>
        : <Badge variant="secondary">Inactive</Badge>;
}

/**
 * Get a badge for priority levels
 */
export function getPriorityBadge(priority: number) {
    switch (priority) {
        case 1:
            return <Badge variant="destructive">P1 - Critical</Badge>;
        case 2:
            return <Badge variant="default" className="bg-orange-100 text-orange-800">P2 - High</Badge>;
        case 3:
            return <Badge variant="secondary">P3 - Normal</Badge>;
        case 4:
            return <Badge variant="outline">P4 - Low</Badge>;
        default:
            return <Badge variant="secondary">P{priority}</Badge>;
    }
}

/**
 * Get a badge for severity levels (alerts, errors)
 */
export function getSeverityBadge(severity: string) {
    switch (severity.toLowerCase()) {
        case 'critical':
            return <Badge variant="destructive">Critical</Badge>;
        case 'high':
        case 'warning':
            return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Warning</Badge>;
        case 'medium':
        case 'info':
            return <Badge variant="secondary">Info</Badge>;
        case 'low':
            return <Badge variant="outline">Low</Badge>;
        default:
            return <Badge variant="secondary">{severity}</Badge>;
    }
}
