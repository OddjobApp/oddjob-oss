
import React, { useEffect, useState, useRef } from 'react';
import { Card } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Loader2, Shield, AlertTriangle, CheckCircle, XCircle, Brain, Gavel, Search, History, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Vote {
    agent: string;
    confidence: number;
    reasoning: string;
    timestamp: number;
}

interface Proposal {
    id: string;
    command: string;
    context: any;
    votes: Record<string, Vote>;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    startTime: number;
    decisionReason?: string;
}

interface GovernorTraceProps {
    sessionId: string;
    className?: string;
}

const AGENT_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
    'W-0': { label: 'Sovereign', icon: Terminal, color: 'text-muted-foreground' },
    'W-1': { label: 'Strategist', icon: Brain, color: 'text-blue-400' },
    'W-2': { label: 'Critic', icon: Shield, color: 'text-red-400' },
    'W-3': { label: 'Explorer', icon: Search, color: 'text-yellow-400' },
    'W-4': { label: 'Auditor', icon: History, color: 'text-green-400' },
};

export const GovernorTrace: React.FC<GovernorTraceProps> = ({ sessionId, className }) => {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [connected, setConnected] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!sessionId) return;

        console.log(`[GovernorTrace] Connecting to stream for ${sessionId}`);
        const eventSource = new EventSource(`/api/governor/trace/${sessionId}`);

        eventSource.onopen = () => setConnected(true);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleEvent(data);
            } catch (e) {
                console.error("Error parsing SSE data", e);
            }
        };

        eventSource.onerror = (err) => {
            console.error("SSE Error", err);
            setConnected(false);
            eventSource.close();
            // Retry logic could go here, but EventSource usually auto-retries
        };

        return () => {
            eventSource.close();
        };
    }, [sessionId]);

    const handleEvent = (event: any) => {
        const { type, payload, timestamp, id } = event;

        setProposals(prev => {
            const newProposals = [...prev];

            if (type === 'PROPOSAL') {
                // Check if exists
                if (!newProposals.find(p => p.id === id)) {
                    newProposals.unshift({ // Add to top
                        id,
                        command: payload.command,
                        context: payload.context,
                        votes: {},
                        status: 'PENDING',
                        startTime: timestamp
                    });
                }
            } else if (type === 'VOTE') {
                const proposalIndex = newProposals.findIndex(p => p.id === payload.proposalId);
                if (proposalIndex !== -1) {
                    const proposal = { ...newProposals[proposalIndex] };
                    proposal.votes = { ...proposal.votes, [payload.agent]: payload };
                    newProposals[proposalIndex] = proposal;
                }
            } else if (type === 'DECISION') {
                const proposalIndex = newProposals.findIndex(p => p.id === payload.proposalId);
                if (proposalIndex !== -1) {
                    const proposal = { ...newProposals[proposalIndex] };
                    proposal.status = payload.approved ? 'APPROVED' : 'REJECTED';
                    proposal.decisionReason = payload.reason;
                    newProposals[proposalIndex] = proposal;
                }
            }

            // Keep only last 10
            return newProposals.slice(0, 10);
        });
    };

    return (
        <Card className={cn("flex flex-col h-full bg-background border-border", className)}>
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/50">
                <div className="flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">Pentagonal Consensus</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", connected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                    <span className="text-xs text-muted-foreground">{connected ? "Live" : "Disconnected"}</span>
                </div>
            </div>

            <ScrollArea className="flex-1 p-3">
                <div className="space-y-4">
                    {proposals.length === 0 && (
                        <div className="text-center text-muted-foreground text-sm py-8">
                            No governance events recorded.
                        </div>
                    )}

                    {proposals.map(proposal => (
                        <ProposalCard key={proposal.id} proposal={proposal} />
                    ))}
                </div>
            </ScrollArea>
        </Card>
    );
};

const ProposalCard = ({ proposal }: { proposal: Proposal }) => {
    return (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="flex items-start justify-between p-3 bg-muted/30">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <Terminal className="w-3 h-3 text-muted-foreground" />
                        <code className="text-xs text-primary font-mono truncate block max-w-[200px]" title={proposal.command}>
                            {proposal.command}
                        </code>
                    </div>
                </div>
                <StatusBadge status={proposal.status} />
            </div>

            {/* Votes Grid */}
            <div className="p-2 grid grid-cols-2 gap-2 border-t border-border">
                {['W-1', 'W-2', 'W-3', 'W-4'].map(agentId => (
                    <AgentVote key={agentId} agentId={agentId} vote={proposal.votes[agentId]} />
                ))}
            </div>

            {proposal.decisionReason && (
                <div className={cn(
                    "px-3 py-1.5 text-xs border-t",
                    proposal.status === 'APPROVED' ? "bg-green-950/20 border-green-900/30 text-green-400" : "bg-red-950/20 border-red-900/30 text-red-400"
                )}>
                    reason: {proposal.decisionReason}
                </div>
            )}
        </div>
    );
};

const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
        case 'APPROVED':
            return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"><CheckCircle className="w-3 h-3 mr-1" /> Allowed</Badge>;
        case 'REJECTED':
            return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800"><XCircle className="w-3 h-3 mr-1" /> Blocked</Badge>;
        default:
            return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Voting</Badge>;
    }
}

const AgentVote = ({ agentId, vote }: { agentId: string, vote?: Vote }) => {
    const config = AGENT_CONFIG[agentId] || { label: agentId, icon: Brain, color: 'text-muted-foreground' };
    const Icon = config.icon;

    if (!vote) {
        return (
            <div className="flex items-center gap-2 p-1.5 rounded bg-muted/50 opacity-50">
                <Icon className={cn("w-3 h-3", config.color)} />
                <span className="text-[10px] text-muted-foreground">{config.label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">...</span>
            </div>
        );
    }

    // High confidence = Bright, Low = Dim/Red if critic
    const isVeto = agentId === 'W-2' && vote.confidence < 0.1;

    return (
        <div className={cn(
            "flex items-center gap-2 p-1.5 rounded transition-all",
            isVeto ? "bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-900/50" : "bg-muted/50",
            vote.confidence > 0.8 && "bg-primary/10"
        )} title={vote.reasoning}>
            <Icon className={cn("w-3 h-3", config.color)} />
            <div className="flex flex-col leading-none">
                <span className="text-[10px] text-muted-foreground">{config.label}</span>
                <span className={cn("text-[10px] font-mono", isVeto ? "text-red-500 font-bold" : "text-foreground/80")}>
                    {(vote.confidence * 100).toFixed(0)}%
                </span>
            </div>
        </div>
    );
}

export default GovernorTrace;
