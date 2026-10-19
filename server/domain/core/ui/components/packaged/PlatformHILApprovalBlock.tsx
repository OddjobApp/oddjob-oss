import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Clock, AlertTriangle, User, MessageSquare, FileText, ExternalLink, Loader2, Shield, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';
import { Textarea } from '../ui/textarea.js';
import { ScrollArea } from '../ui/scroll-area.js';

interface ApprovalRequest {
  id: number;
  type: "task" | "pipeline_step" | "agent_action" | "deployment";
  title: string;
  description?: string;
  requester: {
    id: number;
    name: string;
    avatar?: string;
  };
  context?: {
    pipelineName?: string;
    stepName?: string;
    agentName?: string;
    action?: string;
    parameters?: Record<string, any>;
  };
  createdAt: string;
  expiresAt?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  priority: "low" | "medium" | "high" | "critical";
}

interface PlatformHILApprovalBlockProps {
  title?: string;
  filter?: "pending" | "all" | "approved" | "rejected";
  showHistory?: boolean;
  maxItems?: number;
  pollingIntervalMs?: number;
  onApprove?: (request: ApprovalRequest, comment?: string) => void;
  onReject?: (request: ApprovalRequest, comment?: string) => void;
}

export default function PlatformHILApprovalBlock({
  title = "Human-in-the-Loop",
  filter = "pending",
  showHistory = true,
  maxItems = 10,
  pollingIntervalMs = 5000,
  onApprove,
  onReject,
}: PlatformHILApprovalBlockProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/approval-requests?status=${filter}&limit=${maxItems}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : (data.requests ?? data.items ?? []));
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [filter, maxItems]);

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(fetchRequests, pollingIntervalMs);
    return () => clearInterval(interval);
  }, [fetchRequests, pollingIntervalMs]);

  const handleApprove = async () => {
    if (!selectedRequest) return;
    
    setActionLoading(true);
    try {
      const res = await fetch(`/api/approval-requests/${selectedRequest.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      onApprove?.(selectedRequest, comment);
      setSelectedRequest(null);
      setComment("");
      fetchRequests();
    } catch (e: any) {
      setError(e.message || "Failed to approve");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    setActionLoading(true);
    try {
      const res = await fetch(`/api/approval-requests/${selectedRequest.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      onReject?.(selectedRequest, comment);
      setSelectedRequest(null);
      setComment("");
      fetchRequests();
    } catch (e: any) {
      setError(e.message || "Failed to reject");
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30";
      case "approved": return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
      case "rejected": return "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30";
      case "expired": return "bg-foreground/10 text-foreground/40 border-foreground/20";
      default: return "bg-foreground/10 text-foreground/40 border-foreground/20";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-rose-500 text-foreground";
      case "high": return "bg-amber-500 text-background";
      case "medium": return "bg-blue-500 text-foreground";
      default: return "bg-foreground/20 text-foreground/70";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "pipeline_step": return <FileText className="h-4 w-4" />;
      case "agent_action": return <MessageSquare className="h-4 w-4" />;
      case "deployment": return <ExternalLink className="h-4 w-4" />;
      default: return <Shield className="h-4 w-4" />;
    }
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;

  if (loading) {
    return (
      <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-foreground/5" />
          {Array(3).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full bg-foreground/5" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-amber-400" />
          <CardTitle className="text-xl font-bold text-foreground">{title}</CardTitle>
          {pendingCount > 0 && (
            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 animate-pulse">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={fetchRequests} className="text-foreground/30 hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {requests.length === 0 ? (
          <div className="text-center py-12 text-foreground/30">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No {filter !== "all" ? filter : ""} approval requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {requests.map((request, index) => (
                <motion.div
                  key={request.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => request.status === "pending" && setSelectedRequest(request)}
                  className={`p-4 rounded-lg border ${
                    request.status === "pending" 
                      ? "bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 cursor-pointer" 
                      : "bg-foreground/5 border-foreground/10"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getTypeIcon(request.type)}
                        <h4 className="font-medium text-foreground truncate">{request.title}</h4>
                        <Badge className={`text-xs ${getPriorityColor(request.priority)}`}>
                          {request.priority}
                        </Badge>
                      </div>
                      
                      {request.description && (
                        <p className="text-sm text-foreground/50 line-clamp-2 mb-2">{request.description}</p>
                      )}

                      {request.context && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {request.context.pipelineName && (
                            <Badge variant="outline" className="text-xs bg-foreground/5 text-foreground/50 border-foreground/10">
                              <FileText className="h-3 w-3 mr-1" /> {request.context.pipelineName}
                            </Badge>
                          )}
                          {request.context.agentName && (
                            <Badge variant="outline" className="text-xs bg-foreground/5 text-foreground/50 border-foreground/10">
                              <MessageSquare className="h-3 w-3 mr-1" /> {request.context.agentName}
                            </Badge>
                          )}
                          {request.context.action && (
                            <Badge variant="outline" className="text-xs bg-foreground/5 text-foreground/50 border-foreground/10">
                              {request.context.action}
                            </Badge>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-3 text-xs text-foreground/30">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {request.requester.name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {new Date(request.createdAt).toLocaleString()}
                        </span>
                        {request.expiresAt && (
                          <span className="text-amber-400/70">
                            Expires: {new Date(request.expiresAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="ml-4">
                      <Badge variant="outline" className={getStatusColor(request.status)}>
                        {request.status === "pending" ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> PENDING
                          </span>
                        ) : request.status === "approved" ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> APPROVED
                          </span>
                        ) : request.status === "rejected" ? (
                          <span className="flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> REJECTED
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> EXPIRED
                          </span>
                        )}
                      </Badge>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>

      {/* Approval Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="bg-card border-foreground/10 text-foreground max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-500/20">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-xl">Approval Required</DialogTitle>
                <p className="text-sm text-foreground/50">Review the request before approving or rejecting</p>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-background/40 space-y-3">
                <div>
                  <p className="text-xs text-foreground/40 uppercase tracking-wider">Request</p>
                  <p className="text-lg font-medium text-foreground">{selectedRequest?.title}</p>
                </div>

                {selectedRequest?.description && (
                  <div>
                    <p className="text-xs text-foreground/40 uppercase tracking-wider">Description</p>
                    <p className="text-foreground/70">{selectedRequest.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-foreground/40 uppercase tracking-wider">Requester</p>
                    <p className="text-foreground flex items-center gap-2">
                      <User className="h-4 w-4 text-foreground/30" />
                      {selectedRequest?.requester.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/40 uppercase tracking-wider">Type</p>
                    <p className="text-foreground flex items-center gap-2">
                      {getTypeIcon(selectedRequest?.type || "")}
                      {selectedRequest?.type.replace("_", " ")}
                    </p>
                  </div>
                </div>

                {selectedRequest?.context?.parameters && (
                  <div>
                    <p className="text-xs text-foreground/40 uppercase tracking-wider mb-2">Parameters</p>
                    <div className="bg-background/60 rounded p-3 font-mono text-xs text-foreground/70 overflow-x-auto">
                      <pre>{JSON.stringify(selectedRequest.context.parameters, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-foreground/70">Comment (optional)</label>
                <Textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add a comment about your decision..."
                  className="bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/30"
                  rows={3}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setSelectedRequest(null)}
              className="text-foreground/50 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={actionLoading}
              className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              Reject
            </Button>
            <Button
              onClick={handleApprove}
              disabled={actionLoading}
              className="bg-emerald-500 hover:bg-emerald-400 text-foreground"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
