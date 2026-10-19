import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { 
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { 
    Video,
    StopCircle,
    Loader2,
    Trash2,
    MousePointer,
    Type,
    CheckCircle,
    Circle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface SeleniumLiveRecorderProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobId: number;
}

export default function SeleniumLiveRecorder({ open, onOpenChange, jobId }: SeleniumLiveRecorderProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordedEvents, setRecordedEvents] = useState<any[]>([]);
    const [deletedEventIds, setDeletedEventIds] = useState<Set<number>>(new Set());

    const startCaptureMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/jobs/${jobId}/selenium-start-capture`);
            if (!res.ok) throw new Error("Failed to start capture");
            return res.json();
        },
        onSuccess: (data) => {
            setIsRecording(true);
            setRecordedEvents(data.events || []);
        }
    });

    const stopCaptureMutation = useMutation({
        mutationFn: async () => {
            const eventsToImport = recordedEvents.filter(e => !deletedEventIds.has(e.id));
            const res = await apiRequest("POST", `/api/jobs/${jobId}/selenium-stop-capture`, { events: eventsToImport });
            if (!res.ok) throw new Error("Failed to stop capture");
            return res.json();
        },
        onSuccess: () => {
            setIsRecording(false);
            setRecordedEvents([]);
            setDeletedEventIds(new Set());
            onOpenChange(false);
        }
    });

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'click': return <MousePointer className="w-3 h-3" />;
            case 'type': return <Type className="w-3 h-3" />;
            case 'navigate': return <CheckCircle className="w-3 h-3" />;
            default: return <Video className="w-3 h-3" />;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Video className="w-5 h-5 text-red-600" />
                        Selenium Live Recorder
                    </DialogTitle>
                    <DialogDescription>
                        Record browser interactions to generate automation steps.
                    </DialogDescription>
                </DialogHeader>

                {!isRecording ? (
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg">
                            <div className="text-center space-y-2">
                                <Video className="w-12 h-12 text-muted-foreground mx-auto" />
                                <p className="font-medium">Ready to Record</p>
                                <p className="text-sm text-muted-foreground">
                                    Start recording to capture browser interactions
                                </p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button 
                                onClick={() => startCaptureMutation.mutate()}
                                disabled={startCaptureMutation.isPending}
                                className="gap-2"
                            >
                                {startCaptureMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Circle className="w-4 h-4 fill-red-600 animate-pulse" />
                                )}
                                Start Recording
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between">
                            <Badge variant="destructive" className="gap-1">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                </span>
                                Recording
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                                {recordedEvents.length} events captured
                            </span>
                        </div>

                        <div className="border rounded-lg h-[300px]">
                            <ScrollArea className="h-full p-4">
                                {recordedEvents.length > 0 ? (
                                    <div className="space-y-2">
                                        {recordedEvents.map((event, index) => (
                                            <div 
                                                key={event.id}
                                                className={`group flex items-center gap-3 p-2 rounded border ${deletedEventIds.has(event.id) ? 'opacity-50 line-through' : 'bg-background'}`}
                                            >
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    {getEventIcon(event.type)}
                                                    <span className="text-xs font-mono">#{index + 1}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{event.description}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{event.selector}</p>
                                                </div>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeletedEventIds(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(event.id)) {
                                                                next.delete(event.id);
                                                            } else {
                                                                next.add(event.id);
                                                            }
                                                            return next;
                                                        });
                                                    }}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                        Navigate, click, or Ctrl+Right-click to record.
                                    </div>
                                )}
                            </ScrollArea>
                        </div>

                        <DialogFooter>
                            <Button
                                variant="destructive"
                                onClick={() => stopCaptureMutation.mutate()}
                                disabled={stopCaptureMutation.isPending}
                                className="gap-2"
                            >
                                {stopCaptureMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <StopCircle className="w-4 h-4" />
                                )}
                                Stop & Import Steps
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
