import React, { useState } from "react";
import { Clock, AlertCircle, CheckCircle2, XCircle, Search, HelpCircle, Activity } from "lucide-react";

export type EventSeverity = "info" | "warning" | "error" | "critical";
export type HypothesisConfidence = "low" | "medium" | "high" | "confirmed" | "disproved";

export interface ForensicEvent {
    id: string;
    timestamp: string;
    severity: EventSeverity;
    source: string;
    description: string;
    turnIndex?: number;
    hypothesis?: {
        statement: string;
        confidence: HypothesisConfidence;
        supportingAgents?: string[];
    };
}

interface CrewForensicTimelineRailProps {
    incidentTitle?: string;
    events: ForensicEvent[];
    onSelectEvent?: (event: ForensicEvent) => void;
    onDiscussInChat?: (context: string) => void;
    className?: string;
}

export const CrewForensicTimelineRail: React.FC<CrewForensicTimelineRailProps> = ({
    incidentTitle = "System Incident Forensic Timeline",
    events,
    onSelectEvent,
    onDiscussInChat,
    className = "",
}) => {
    const [selectedEventId, setSelectedEventId] = useState<string>(events[0]?.id || "");

    const selectedEvent = events.find((e) => e.id === selectedEventId) || events[0];

    const getSeverityDot = (severity: EventSeverity) => {
        switch (severity) {
            case "critical":
                return "bg-red-500 ring-4 ring-red-500/20 animate-pulse";
            case "error":
                return "bg-orange-500 ring-3 ring-orange-500/20";
            case "warning":
                return "bg-amber-400";
            case "info":
            default:
                return "bg-sky-400";
        }
    };

    const getConfidenceBadge = (confidence: HypothesisConfidence) => {
        switch (confidence) {
            case "confirmed":
                return <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Confirmed RCA</span>;
            case "high":
                return <span className="bg-amber-500/20 text-amber-500 border border-amber-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> High Prob</span>;
            case "disproved":
                return <span className="bg-red-500/20 text-red-500 border border-red-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold line-through flex items-center gap-1"><XCircle className="w-2.5 h-2.5" /> Disproved</span>;
            case "medium":
            case "low":
            default:
                return <span className="bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"><HelpCircle className="w-2.5 h-2.5" /> Investigating</span>;
        }
    };

    // Extract all pinned hypotheses across events
    const hypotheses = events.filter((e) => e.hypothesis);

    return (
        <div
            data-testid="crew-forensic-timeline-rail"
            className={`flex flex-col gap-3 rounded-xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-md font-sans text-xs text-foreground ${className}`}
        >
            {/* Header: Title & Incident Telemetry */}
            <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-cyan-500 dark:text-cyan-400 font-bold uppercase tracking-wider text-[11px]">
                        <Clock className="w-4 h-4" />
                        <span>Forensic RCA Timeline</span>
                    </div>
                    <h3 className="font-bold text-sm text-foreground truncate" title={incidentTitle}>
                        {incidentTitle}
                    </h3>
                </div>

                <div className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-full border border-border">
                    <Activity className="w-3 h-3 text-cyan-400" />
                    <span className="font-bold text-[11px] font-mono text-foreground">
                        {events.length} Events
                    </span>
                </div>
            </div>

            {/* Pinned Hypotheses Quick Callout */}
            {hypotheses.length > 0 && (
                <div className="flex flex-col gap-1.5 p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-500">
                        Root Cause Hypotheses ({hypotheses.length}):
                    </span>
                    <div className="flex flex-col gap-1">
                        {hypotheses.map((h, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="font-medium text-foreground truncate">{h.hypothesis?.statement}</span>
                                {h.hypothesis && getConfidenceBadge(h.hypothesis.confidence)}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Chronological Event Ribbon */}
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Event Sequence:
                </span>
                
                <div className="relative flex flex-col gap-3 pl-4 pt-1 max-h-60 overflow-y-auto before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {events.map((evt) => {
                        const isSelected = evt.id === selectedEventId;
                        return (
                            <button
                                key={evt.id}
                                onClick={() => {
                                    setSelectedEventId(evt.id);
                                    onSelectEvent?.(evt);
                                }}
                                className={`relative flex flex-col gap-1 p-2 rounded-lg border text-left transition-all ${
                                    isSelected
                                        ? "border-cyan-500/80 bg-cyan-500/10 shadow-xs"
                                        : "border-border/60 bg-muted/30 hover:bg-muted/60"
                                }`}
                            >
                                {/* Dot on the vertical line */}
                                <div
                                    className={`absolute -left-[19px] top-3.5 w-2.5 h-2.5 rounded-full ${getSeverityDot(evt.severity)}`}
                                />

                                <div className="flex items-center justify-between gap-2 text-[10px]">
                                    <span className="font-mono font-bold text-muted-foreground">{evt.timestamp}</span>
                                    <span className="font-semibold text-cyan-500">{evt.source}</span>
                                </div>
                                <div className="font-medium text-foreground line-clamp-2">
                                    {evt.description}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Selected Event Details & Chat Focus */}
            {selectedEvent && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-foreground">Symptom Context:</span>
                        <span className="font-mono text-muted-foreground">{selectedEvent.timestamp}</span>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border border-border/40 text-[11px] text-muted-foreground">
                        {selectedEvent.description}
                    </div>

                    <button
                        onClick={() => onDiscussInChat?.(`Regarding incident event at ${selectedEvent.timestamp} on ${selectedEvent.source}: "${selectedEvent.description}" - let's analyze root cause.`)}
                        className="w-full px-3 py-1.5 bg-background hover:bg-muted border border-border rounded text-foreground font-semibold flex items-center justify-center gap-1.5 text-xs transition-colors"
                    >
                        <Search className="w-3.5 h-3.5 text-cyan-500" />
                        Investigate Event in Chat
                    </button>
                </div>
            )}
        </div>
    );
};

export default CrewForensicTimelineRail;
