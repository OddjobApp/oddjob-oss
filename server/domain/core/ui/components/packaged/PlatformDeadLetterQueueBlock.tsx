/**
 * PlatformDeadLetterQueueBlock
 * 
 * Self-wiring platform block for viewing and managing failed jobs/pipelines
 * in the dead letter queue. Supports filtering, retry, bulk actions, and 
 * detailed error inspection.
 */
import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Clock,
  X,
  Filter,
  RefreshCw,
  CheckCircle,
  XCircle,
  MoreHorizontal
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { Checkbox } from '../ui/checkbox.js';
import { useEventStream } from '../../hooks/useEventStream.js';

interface DeadLetterItem {
  id: string;
  jobId?: string;
  pipelineExecutionId?: number;
  missionRunId?: number;
  type: "job" | "pipeline" | "mission";
  error: string;
  stackTrace?: string;
  payload?: any;
  createdAt: string;
  retryCount: number;
  maxRetries: number;
  status: "failed" | "retrying" | "discarded";
  source?: string;
  stepName?: string;
}

interface PlatformDeadLetterQueueBlockProps {
  title?: string;
  filterType?: "all" | "job" | "pipeline" | "mission";
  maxItems?: number;
  showRetry?: boolean;
  showDiscard?: boolean;
  showBulkActions?: boolean;
  autoRefresh?: boolean;
  onRetry?: (item: DeadLetterItem) => void;
  onDiscard?: (item: DeadLetterItem) => void;
}

export default function PlatformDeadLetterQueueBlock({
  title = "Dead Letter Queue",
  filterType = "all",
  maxItems = 50,
  showRetry = true,
  showDiscard = true,
  showBulkActions = true,
  autoRefresh = true,
  onRetry,
  onDiscard
}: PlatformDeadLetterQueueBlockProps) {
  const [items, setItems] = useState<DeadLetterItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>(filterType);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [selectedForAction, setSelectedForAction] = useState<DeadLetterItem | null>(null);

  // Subscribe to DLQ events
  const { events, isConnected, reconnect } = useEventStream({
    type: ["dlq.*", "job.failed", "pipeline.failed", "mission.failed"],
    autoConnect: autoRefresh
  });

  // Process incoming DLQ events
  React.useEffect(() => {
    events.forEach(event => {
      const payload = event.payload as DeadLetterItem;
      
      setItems(prev => {
        // Update existing or add new
        const existingIndex = prev.findIndex(i => i.id === payload.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...payload };
          return updated;
        }
        return [payload, ...prev].slice(0, maxItems);
      });
    });
  }, [events, maxItems]);

  // Fetch initial DLQ items
  const fetchDLQ = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType !== "all") params.append("type", filterType);
      params.append("limit", String(maxItems));
      
      const response = await fetch(`/api/dlq/items?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error("[DLQ] Failed to fetch items:", err);
    }
  }, [filterType, maxItems]);

  // Initial fetch
  React.useEffect(() => {
    fetchDLQ();
  }, [fetchDLQ]);

  const handleRetry = async (item: DeadLetterItem) => {
    setIsRetrying(item.id);
    
    try {
      // Call custom handler if provided
      if (onRetry) {
        await onRetry(item);
      } else {
        // Default retry API call
        const response = await fetch(`/api/dlq/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            id: item.id, 
            type: item.type,
            jobId: item.jobId,
            pipelineExecutionId: item.pipelineExecutionId,
            missionRunId: item.missionRunId
          })
        });
        
        if (!response.ok) throw new Error("Retry failed");
      }
      
      // Update local state
      setItems(prev => prev.map(i => 
        i.id === item.id ? { ...i, status: "retrying" as const } : i
      ));
    } catch (err) {
      console.error("[DLQ] Retry failed:", err);
    } finally {
      setIsRetrying(null);
      setRetryDialogOpen(false);
    }
  };

  const handleDiscard = async (item: DeadLetterItem) => {
    try {
      if (onDiscard) {
        await onDiscard(item);
      } else {
        await fetch(`/api/dlq/discard`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id })
        });
      }
      
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      console.error("[DLQ] Discard failed:", err);
    }
  };

  const handleBulkRetry = async () => {
    const selected = items.filter(i => selectedItems.has(i.id));
    await Promise.all(selected.map(item => handleRetry(item)));
    setSelectedItems(new Set());
  };

  const handleBulkDiscard = async () => {
    const selected = items.filter(i => selectedItems.has(i.id));
    await Promise.all(selected.map(item => handleDiscard(item)));
    setSelectedItems(new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.id)));
    }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = 
      item.error.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.source?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "failed":
        return <Badge className="bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
      case "retrying":
        return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 animate-pulse"><RotateCcw className="h-3 w-3 mr-1" /> Retrying</Badge>;
      case "discarded":
        return <Badge className="bg-muted/20 text-foreground border-border/30"><Trash2 className="h-3 w-3 mr-1" /> Discarded</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "job":
        return <Terminal className="h-4 w-4 text-indigo-400" />;
      case "pipeline":
        return <ChevronRight className="h-4 w-4 text-emerald-400" />;
      case "mission":
        return <Clock className="h-4 w-4 text-amber-400" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-rose-400" />;
    }
  };

  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            <CardTitle className="text-lg font-bold text-foreground">{title}</CardTitle>
            <Badge 
              variant="outline" 
              className={isConnected 
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" 
                : "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30"
              }
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Badge>
            <Badge variant="outline" className="bg-foreground/10 text-foreground/60">
              {items.length} items
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchDLQ()}
              className="text-foreground/40 hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reconnect()}
              className="text-foreground/40 hover:text-foreground"
            >
              Reconnect
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Input
              placeholder="Search errors, IDs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/30"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[130px] bg-foreground/5 border-foreground/10 text-foreground">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="job">Jobs</SelectItem>
              <SelectItem value="pipeline">Pipelines</SelectItem>
              <SelectItem value="mission">Missions</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] bg-foreground/5 border-foreground/10 text-foreground">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="retrying">Retrying</SelectItem>
              <SelectItem value="discarded">Discarded</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk Actions */}
        {showBulkActions && selectedItems.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20"
          >
            <span className="text-sm text-indigo-700 dark:text-indigo-300">
              {selectedItems.size} selected
            </span>
            <div className="flex-1" />
            {showRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkRetry}
                className="border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Retry All
              </Button>
            )}
            {showDiscard && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDiscard}
                className="border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
              >
                <Trash2 className="h-3 w-3 mr-1.5" />
                Discard All
              </Button>
            )}
          </motion.div>
        )}
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-12 text-foreground/30">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Dead letter queue is empty</p>
            <p className="text-sm mt-1">Failed jobs will appear here for review and retry</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-foreground/30">
            <Filter className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No items match your filters</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-2">
              {/* Header with select all */}
              {showBulkActions && (
                <div className="flex items-center gap-3 px-3 py-2 text-xs text-foreground/40 border-b border-foreground/5">
                  <Checkbox
                    checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                    onCheckedChange={toggleAll}
                  />
                  <span className="flex-1">Select All</span>
                  <span className="w-20">Type</span>
                  <span className="w-24">Status</span>
                  <span className="w-24">Retry Count</span>
                  <span className="w-32">Time</span>
                </div>
              )}

              {filteredItems.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`rounded-lg border transition-colors ${
                    expandedItem === item.id 
                      ? "bg-foreground/10 border-foreground/20" 
                      : "bg-foreground/5 border-foreground/10 hover:bg-foreground/10"
                  }`}
                >
                  {/* Item Header */}
                  <div 
                    className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                  >
                    {showBulkActions && (
                      <Checkbox
                        checked={selectedItems.has(item.id)}
                        onCheckedChange={() => toggleSelection(item.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    
                    <div className="flex items-center gap-2">
                      {getTypeIcon(item.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate font-mono">
                        {item.id.slice(0, 8)}...{item.id.slice(-8)}
                      </p>
                      <p className="text-xs text-foreground/40 truncate">
                        {item.error.slice(0, 60)}{item.error.length > 60 ? "..." : ""}
                      </p>
                    </div>

                    <div className="w-20">
                      <Badge variant="outline" className="text-xs capitalize">
                        {item.type}
                      </Badge>
                    </div>

                    <div className="w-24">
                      {getStatusBadge(item.status)}
                    </div>

                    <div className="w-24 text-center">
                      <span className={`text-sm ${item.retryCount >= item.maxRetries ? "text-rose-400" : "text-foreground/60"}`}>
                        {item.retryCount}/{item.maxRetries}
                      </span>
                    </div>

                    <div className="w-32 text-xs text-foreground/40">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>

                    <div className="flex items-center gap-1">
                      {expandedItem === item.id ? (
                        <ChevronDown className="h-4 w-4 text-foreground/40" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-foreground/40" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {expandedItem === item.id && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="border-t border-foreground/5"
                      >
                        <div className="p-4 space-y-4">
                          {/* Error Details */}
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Terminal className="h-4 w-4 text-rose-400" />
                              Error Details
                            </h4>
                            <div className="bg-background/40 rounded-lg p-3 font-mono text-xs text-rose-700 dark:text-rose-300 overflow-x-auto">
                              <p className="whitespace-pre-wrap">{item.error}</p>
                              {item.stackTrace && (
                                <pre className="mt-2 text-foreground/40 text-[10px] whitespace-pre-wrap">
                                  {item.stackTrace}
                                </pre>
                              )}
                            </div>
                          </div>

                          {/* Payload Preview */}
                          {item.payload && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-medium text-foreground">
                                Failed Payload
                              </h4>
                              <div className="bg-background/40 rounded-lg p-3 font-mono text-xs text-foreground/60 overflow-x-auto max-h-32">
                                <pre className="whitespace-pre-wrap">
                                  {JSON.stringify(item.payload, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}

                          {/* Metadata */}
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            {item.source && (
                              <div>
                                <span className="text-foreground/40">Source:</span>
                                <span className="text-foreground ml-2">{item.source}</span>
                              </div>
                            )}
                            {item.stepName && (
                              <div>
                                <span className="text-foreground/40">Step:</span>
                                <span className="text-foreground ml-2">{item.stepName}</span>
                              </div>
                            )}
                            {item.jobId && (
                              <div>
                                <span className="text-foreground/40">Job ID:</span>
                                <span className="text-foreground ml-2 font-mono">{item.jobId}</span>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2 pt-2">
                            {showRetry && item.status !== "retrying" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedForAction(item);
                                  setRetryDialogOpen(true);
                                }}
                                disabled={isRetrying === item.id}
                                className="flex-1 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20"
                              >
                                {isRetrying === item.id ? (
                                  <RotateCcw className="h-4 w-4 mr-1.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-4 w-4 mr-1.5" />
                                )}
                                {isRetrying === item.id ? "Retrying..." : "Retry"}
                              </Button>
                            )}
                            {showDiscard && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDiscard(item)}
                                className="border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
                              >
                                <Trash2 className="h-4 w-4 mr-1.5" />
                                Discard
                              </Button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      {/* Retry Confirmation Dialog */}
      <Dialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
        <DialogContent className="bg-card border-foreground/10 text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-indigo-400" />
              Retry Failed Item
            </DialogTitle>
            <DialogDescription className="text-foreground/60">
              Are you sure you want to retry this failed {selectedForAction?.type}?
              This will attempt execution again with the same payload.
            </DialogDescription>
          </DialogHeader>
          
          {selectedForAction && (
            <div className="bg-background/40 rounded-lg p-3 font-mono text-xs">
              <p className="text-foreground/40">ID: {selectedForAction.id}</p>
              <p className="text-rose-700 dark:text-rose-300 mt-1">{selectedForAction.error}</p>
              <p className="text-foreground/40 mt-1">
                Retry {selectedForAction.retryCount + 1} of {selectedForAction.maxRetries}
              </p>
            </div>
          )}
          
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRetryDialogOpen(false)}
              className="text-foreground/60"
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedForAction && handleRetry(selectedForAction)}
              className="bg-indigo-500 hover:bg-indigo-400 text-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Confirm Retry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
