/**
 * AgentMail Thread Panel
 * 
 * Displays linked AgentMail email thread for mission steering.
 * Shows:
 * - Linked thread status
 * - Email participants
 * - Reply history (steering commands)
 * - Quick actions
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { 
    Mail, 
    Send, 
    Reply, 
    CheckCircle2, 
    Clock, 
    AlertCircle,
    User,
    Link2,
    Unlink,
    ExternalLink,
    MoreHorizontal,
    ChevronDown,
    ChevronUp
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { LoadingSkeleton } from "@domain-ui/core/ui/components/ui/loading-skeleton";
import { 
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { 
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@domain-ui/core/ui/components/ui/collapsible";

interface EmailThreadPanelProps {
    missionRunId: number;
    missionContext?: any;
}

interface EmailReply {
    id: string;
    from: string;
    subject: string;
    body: string;
    receivedAt: string;
    intent: 'steer' | 'approve' | 'reject' | 'unknown';
    applied: boolean;
}

interface ThreadLink {
    threadId: string;
    participants: string[];
    linkedAt: string;
    replyCount: number;
    lastReplyAt?: string;
}

export function EmailThreadPanel({ missionRunId, missionContext }: EmailThreadPanelProps) {
    const { toast } = useToast();
    const [newEmail, setNewEmail] = useState("");
    const [isExpanded, setIsExpanded] = useState(true);

    // Extract thread info from mission context
    const threadId = missionContext?.emailThreadId;
    const linkedAt = missionContext?.emailLinkedAt;
    const participant = missionContext?.emailParticipant;

    // Fetch thread details
    const { data: threadDetails, isLoading } = useQuery<ThreadLink | null>({
        queryKey: [`/api/mission-runs/${missionRunId}/email-thread`],
        queryFn: async () => {
            if (!threadId) return null;
            try {
                const res = await apiRequest("GET", `/api/agentmail/threads/${threadId}`);
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        },
        enabled: !!threadId,
    });

    // Fetch reply history
    const { data: replies, isLoading: repliesLoading } = useQuery<EmailReply[]>({
        queryKey: [`/api/mission-runs/${missionRunId}/email-replies`],
        queryFn: async () => {
            if (!threadId) return [];
            try {
                const res = await apiRequest("GET", `/api/agentmail/threads/${threadId}/messages`);
                if (!res.ok) return [];
                const data = await res.json();
                return data.messages?.slice(0, 10) || [];
            } catch {
                return [];
            }
        },
        enabled: !!threadId,
        refetchInterval: 30000, // Poll every 30s for new replies
    });

    const sendHilEmail = useMutation({
        mutationFn: async (email: string) => {
            const res = await apiRequest("POST", `/api/mission-runs/${missionRunId}/send-hil-email`, {
                to: email,
                subject: `Mission #${missionRunId} - Action Required`,
            });
            if (!res.ok) throw new Error("Failed to send email");
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "HIL Email Sent",
                description: "The participant will receive an email with approval instructions",
            });
            setNewEmail("");
        },
        onError: () => {
            toast({
                title: "Failed to Send",
                description: "Could not send HIL email. Check AgentMail configuration.",
                variant: "destructive",
            });
        },
    });

    const unlinkThread = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/mission-runs/${missionRunId}/unlink-email`, {});
            if (!res.ok) throw new Error("Failed to unlink");
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Thread Unlinked",
                description: "Email thread is no longer connected to this mission",
            });
        },
    });

    // No thread linked - show setup UI
    if (!threadId) {
        return (
            <Card className="border-dashed">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Mail className="w-5 h-5 text-muted-foreground" />
                        <CardTitle className="text-lg">Email Steering</CardTitle>
                    </div>
                    <CardDescription>
                        Link an email thread to enable steering via email replies
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="text-sm text-muted-foreground space-y-2">
                        <p>When linked:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Send HIL approval emails to participants</li>
                            <li>Participants can reply with STEER commands</li>
                            <li>Email thread context is preserved in mission</li>
                        </ul>
                    </div>
                    
                    <div className="flex gap-2">
                        <Input 
                            placeholder="participant@example.com"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            type="email"
                        />
                        <Button 
                            className="gap-2 shrink-0"
                            onClick={() => sendHilEmail.mutate(newEmail)}
                            disabled={!newEmail || sendHilEmail.isPending}
                        >
                            <Send className="w-4 h-4" />
                            {sendHilEmail.isPending ? "Sending..." : "Send HIL Email"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <Card>
                <div className="h-48"><LoadingSkeleton /></div>
            </Card>
        );
    }

    const hasNewReplies = replies?.some(r => !r.applied);

    return (
        <Card>
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Mail className="w-5 h-5 text-primary" />
                                {hasNewReplies && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                                )}
                            </div>
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    Email Thread Linked
                                    {hasNewReplies && (
                                        <Badge variant="destructive" className="text-xs">
                                            New Replies
                                        </Badge>
                                    )}
                                </CardTitle>
                                <CardDescription className="font-mono text-xs">
                                    Thread: {threadId?.substring(0, 20)}...
                                </CardDescription>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-1">
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    {isExpanded ? (
                                        <ChevronUp className="w-4 h-4" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4" />
                                    )}
                                </Button>
                            </CollapsibleTrigger>
                            
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem 
                                        className="text-destructive"
                                        onClick={() => unlinkThread.mutate()}
                                        disabled={unlinkThread.isPending}
                                    >
                                        <Unlink className="w-4 h-4 mr-2" />
                                        Unlink Thread
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </CardHeader>

                <CollapsibleContent>
                    <CardContent className="space-y-4 pt-0">
                        {/* Participants */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium text-muted-foreground">Participants</h4>
                            <div className="flex flex-wrap gap-2">
                                {participant && (
                                    <Badge variant="secondary" className="gap-1">
                                        <User className="w-3 h-3" />
                                        {participant}
                                    </Badge>
                                )}
                                {threadDetails?.participants?.map((email: string) => (
                                    <Badge key={email} variant="outline" className="gap-1">
                                        <Mail className="w-3 h-3" />
                                        {email}
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        {/* Linked Info */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <Link2 className="w-3 h-3" />
                                Linked {linkedAt ? new Date(linkedAt).toLocaleString() : 'Unknown'}
                            </div>
                            {replies && (
                                <div className="flex items-center gap-1">
                                    <Reply className="w-3 h-3" />
                                    {replies.length} replies
                                </div>
                            )}
                        </div>

                        {/* Reply History */}
                        {replies && replies.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                    <Reply className="w-4 h-4" />
                                    Reply History
                                </h4>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {replies.map((reply, idx) => (
                                        <div 
                                            key={reply.id || idx} 
                                            className={`p-3 rounded-lg border ${
                                                reply.applied 
                                                    ? 'bg-muted/50 border-muted' 
                                                    : 'bg-blue-500/5 border-blue-500/20'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <User className="w-4 h-4 text-muted-foreground" />
                                                    <span className="text-sm font-medium">{reply.from}</span>
                                                    {reply.intent === 'steer' && (
                                                        <Badge variant="outline" className="text-xs">Steer</Badge>
                                                    )}
                                                    {reply.intent === 'approve' && (
                                                        <Badge variant="default" className="text-xs bg-green-500">Approve</Badge>
                                                    )}
                                                    {reply.intent === 'reject' && (
                                                        <Badge variant="destructive" className="text-xs">Reject</Badge>
                                                    )}
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(reply.receivedAt).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            
                                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                                {reply.body?.substring(0, 200)}...
                                            </p>
                                            
                                            <div className="flex items-center gap-2 mt-2">
                                                {reply.applied ? (
                                                    <Badge variant="outline" className="text-xs gap-1 text-green-600">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        Applied
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-xs gap-1 text-blue-600">
                                                        <Clock className="w-3 h-3" />
                                                        Pending
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quick Actions */}
                        <div className="flex gap-2 pt-2 border-t">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2"
                                onClick={() => sendHilEmail.mutate(participant || '')}
                                disabled={sendHilEmail.isPending}
                            >
                                <Send className="w-4 h-4" />
                                Send Follow-up
                            </Button>
                            
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="gap-2"
                                onClick={() => window.open(`https://agentmail.to/inbox/${threadId}`, '_blank')}
                            >
                                <ExternalLink className="w-4 h-4" />
                                Open in AgentMail
                            </Button>
                        </div>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

export default EmailThreadPanel;
