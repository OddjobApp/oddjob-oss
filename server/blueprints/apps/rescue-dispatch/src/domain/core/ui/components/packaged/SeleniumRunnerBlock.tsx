/**
 * SeleniumRunnerBlock
 * 
 * Self-wiring platform block for viewing Selenium browser test results.
 * Real-time updates via SSE.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Monitor,
  Clock,
  ChevronDown,
  ChevronRight,
  Image,
  Bug,
  Layout,
  MousePointer,
  RotateCcw,
  ExternalLink,
  Terminal
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { useEventStream } from '../../hooks/useEventStream.js';

interface SeleniumAuditResult {
  runId: string;
  appId: number;
  appSlug: string;
  url: string;
  status: "running" | "passed" | "failed";
  results: SeleniumTestResult[];
  startTime: number;
  endTime?: number;
  currentStep?: string;
}

interface SeleniumTestResult {
  success: boolean;
  url: string;
  pageTitle?: string;
  consoleErrors: ConsoleError[];
  brokenImages: BrokenImage[];
  layoutIssues: LayoutIssue[];
  screenshot?: string;
  duration: number;
  error?: string;
  metadata?: any;
}

interface ConsoleError {
  level: "SEVERE" | "WARNING" | "INFO";
  message: string;
  timestamp: number;
}

interface BrokenImage {
  src: string;
  alt?: string;
  selector?: string;
}

interface LayoutIssue {
  type: "zero-size" | "overflow" | "overlap" | "hidden";
  element: string;
  details: string;
}

interface SeleniumRunnerBlockProps {
  appId?: number;
  appSlug?: string;
  autoRun?: boolean;
  showHistory?: boolean;
  maxHistory?: number;
}

export default function SeleniumRunnerBlock({
  appId,
  appSlug,
  autoRun = false,
  showHistory = true,
  maxHistory = 5
}: SeleniumRunnerBlockProps) {
  const [audits, setAudits] = useState<SeleniumAuditResult[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<SeleniumAuditResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  // Subscribe to Selenium events
  const { events, isConnected } = useEventStream({
    type: ["selenium.audit.*"],
    autoConnect: true
  });

  // Process incoming events
  useEffect(() => {
    events.forEach(event => {
      const { runId, appId: eventAppId, appSlug: eventAppSlug, status, ...data } = event.payload;
      
      // Filter if appId/appSlug specified
      if (appId && eventAppId !== appId) return;
      if (appSlug && eventAppSlug !== appSlug) return;

      setAudits(prev => {
        const existingIndex = prev.findIndex(a => a.runId === runId);
        
        if (existingIndex >= 0) {
          // Update existing
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...data, status: status || updated[existingIndex].status };
          
          if (data.message) {
            updated[existingIndex].currentStep = data.message;
          }
          
          return updated;
        } else {
          // Add new
          return [{
            runId,
            appId: eventAppId,
            appSlug: eventAppSlug,
            url: data.url || "",
            status: status || "running",
            results: [],
            startTime: event.timestamp,
            currentStep: data.message || "Initializing..."
          }, ...prev].slice(0, maxHistory);
        }
      });
    });
  }, [events, appId, appSlug, maxHistory]);

  // Fetch initial history
  const fetchHistory = useCallback(async () => {
    if (!appId && !appSlug) return;
    
    try {
      const params = new URLSearchParams();
      if (appId) params.append("appId", String(appId));
      if (appSlug) params.append("appSlug", appSlug);
      params.append("limit", String(maxHistory));
      
      const response = await fetch(`/api/selenium/audits?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAudits(data.audits || []);
      }
    } catch (err) {
      console.error("[SeleniumRunner] Failed to fetch history:", err);
    }
  }, [appId, appSlug, maxHistory]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const runAudit = async () => {
    if (!appId && !appSlug) {
      console.error("[SeleniumRunner] No appId or appSlug provided");
      return;
    }

    setIsRunning(true);
    
    try {
      const response = await fetch("/api/selenium/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          appSlug,
          options: {
            browser: "chrome",
            headless: true
          }
        })
      });

      if (!response.ok) {
        throw new Error("Failed to start audit");
      }

      const data = await response.json();
      console.log("[SeleniumRunner] Audit started:", data.runId);

    } catch (err) {
      console.error("[SeleniumRunner] Failed to run audit:", err);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <CheckCircle className="h-5 w-5 text-emerald-400" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-rose-400" />;
      case "running":
        return <Monitor className="h-5 w-5 text-indigo-400 animate-pulse" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-amber-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "passed":
        return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Passed</Badge>;
      case "failed":
        return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">Failed</Badge>;
      case "running":
        return <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 animate-pulse">Running</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-bold text-white">Selenium QA Audit</CardTitle>
            <Badge 
              variant="outline" 
              className={isConnected 
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" 
                : "bg-rose-500/20 text-rose-300 border-rose-500/30"
              }
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Badge>
          </div>
          <Button
            onClick={runAudit}
            disabled={isRunning || (!appId && !appSlug)}
            className="bg-indigo-500 hover:bg-indigo-400 text-white"
          >
            {isRunning ? (
              <>
                <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Monitor className="h-4 w-4 mr-2" />
                Run Audit
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {audits.length === 0 ? (
          <div className="text-center py-12 text-white/30">
            <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No audit history</p>
            <p className="text-sm mt-1">Run a Selenium browser audit to see results here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {audits.map((audit) => (
              <motion.div
                key={audit.runId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-lg border p-4 cursor-pointer transition-colors ${
                  selectedAudit?.runId === audit.runId
                    ? "bg-white/10 border-white/20"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
                onClick={() => setSelectedAudit(audit)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(audit.status)}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white font-mono">
                          {audit.runId.slice(0, 16)}...
                        </p>
                        {getStatusBadge(audit.status)}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">
                        {audit.url || audit.appSlug}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-white/40">
                    <p>{formatDuration(audit.endTime ? audit.endTime - audit.startTime : Date.now() - audit.startTime)}</p>
                    <p>{new Date(audit.startTime).toLocaleTimeString()}</p>
                  </div>
                </div>

                {audit.status === "running" && audit.currentStep && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-indigo-300">
                    <RotateCcw className="h-3 w-3 animate-spin" />
                    {audit.currentStep}
                  </div>
                )}

                {audit.results.length > 0 && (
                  <div className="mt-3 flex items-center gap-4 text-xs">
                    {audit.results[0]?.consoleErrors && (
                      <span className={audit.results[0].consoleErrors.length > 0 ? "text-amber-400" : "text-emerald-400"}>
                        <Bug className="h-3 w-3 inline mr-1" />
                        {audit.results[0].consoleErrors.length} console errors
                      </span>
                    )}
                    {audit.results[0]?.brokenImages && (
                      <span className={audit.results[0].brokenImages.length > 0 ? "text-rose-400" : "text-emerald-400"}>
                        <Image className="h-3 w-3 inline mr-1" />
                        {audit.results[0].brokenImages.length} broken images
                      </span>
                    )}
                    {audit.results[0]?.layoutIssues && (
                      <span className={audit.results[0].layoutIssues.length > 0 ? "text-amber-400" : "text-emerald-400"}>
                        <Layout className="h-3 w-3 inline mr-1" />
                        {audit.results[0].layoutIssues.length} layout issues
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Detailed Audit View Dialog */}
      <Dialog open={!!selectedAudit} onOpenChange={() => setSelectedAudit(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] bg-zinc-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedAudit && getStatusIcon(selectedAudit.status)}
              Audit Results
            </DialogTitle>
          </DialogHeader>

          {selectedAudit && (
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="bg-white/5 border-white/10">
                <TabsTrigger value="summary" className="data-[state=active]:bg-white/10">
                  Summary
                </TabsTrigger>
                <TabsTrigger value="console" className="data-[state=active]:bg-white/10">
                  Console ({selectedAudit.results[0]?.consoleErrors?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="images" className="data-[state=active]:bg-white/10">
                  Images ({selectedAudit.results[0]?.brokenImages?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="layout" className="data-[state=active]:bg-white/10">
                  Layout ({selectedAudit.results[0]?.layoutIssues?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="screenshot" className="data-[state=active]:bg-white/10">
                  Screenshot
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[60vh] mt-4">
                <TabsContent value="summary" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 rounded-lg p-4">
                      <p className="text-sm text-white/40">Status</p>
                      <div className="mt-1">{getStatusBadge(selectedAudit.status)}</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-4">
                      <p className="text-sm text-white/40">Duration</p>
                      <p className="text-lg font-medium text-white">
                        {selectedAudit.endTime 
                          ? formatDuration(selectedAudit.endTime - selectedAudit.startTime)
                          : "Running..."
                        }
                      </p>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-lg p-4">
                    <p className="text-sm text-white/40 mb-2">Test Results</p>
                    <div className="space-y-2">
                      {selectedAudit.results.map((result, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-white/5 rounded">
                          <div className="flex items-center gap-2">
                            {result.success 
                              ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                              : <XCircle className="h-4 w-4 text-rose-400" />
                            }
                            <span className="text-sm text-white">Test {idx + 1}</span>
                          </div>
                          <span className="text-xs text-white/40">{formatDuration(result.duration)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedAudit.results[0]?.pageTitle && (
                    <div className="bg-white/5 rounded-lg p-4">
                      <p className="text-sm text-white/40">Page Title</p>
                      <p className="text-white">{selectedAudit.results[0].pageTitle}</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="console" className="space-y-2">
                  {selectedAudit.results[0]?.consoleErrors?.length === 0 ? (
                    <div className="text-center py-8 text-emerald-400">
                      <CheckCircle className="h-12 w-12 mx-auto mb-2" />
                      <p>No console errors detected</p>
                    </div>
                  ) : (
                    selectedAudit.results[0]?.consoleErrors?.map((err, idx) => (
                      <div key={idx} className="bg-black/40 rounded-lg p-3 font-mono text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={err.level === "SEVERE" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"}>
                            {err.level}
                          </Badge>
                          <span className="text-white/40">
                            {new Date(err.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-white/80 whitespace-pre-wrap">{err.message}</p>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="images" className="space-y-2">
                  {selectedAudit.results[0]?.brokenImages?.length === 0 ? (
                    <div className="text-center py-8 text-emerald-400">
                      <CheckCircle className="h-12 w-12 mx-auto mb-2" />
                      <p>All images loaded correctly</p>
                    </div>
                  ) : (
                    selectedAudit.results[0]?.brokenImages?.map((img, idx) => (
                      <div key={idx} className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                        <p className="font-mono text-xs text-rose-300 break-all">{img.src}</p>
                        {img.selector && (
                          <p className="text-xs text-white/40 mt-1">{img.selector}</p>
                        )}
                        {img.alt && (
                          <p className="text-xs text-white/40">Alt: {img.alt}</p>
                        )}
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="layout" className="space-y-2">
                  {selectedAudit.results[0]?.layoutIssues?.length === 0 ? (
                    <div className="text-center py-8 text-emerald-400">
                      <CheckCircle className="h-12 w-12 mx-auto mb-2" />
                      <p>No layout issues detected</p>
                    </div>
                  ) : (
                    selectedAudit.results[0]?.layoutIssues?.map((issue, idx) => (
                      <div key={idx} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Layout className="h-4 w-4 text-amber-400" />
                          <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                            {issue.type}
                          </Badge>
                        </div>
                        <p className="text-sm text-white mt-1">{issue.element}</p>
                        <p className="text-xs text-white/40">{issue.details}</p>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="screenshot">
                  {selectedAudit.results[0]?.screenshot ? (
                    <div className="space-y-4">
                      <img
                        src={selectedAudit.results[0].screenshot}
                        alt="Selenium screenshot"
                        className="w-full rounded-lg border border-white/10"
                      />
                      <div className="flex justify-center">
                        <Button
                          variant="outline"
                          onClick={() => setSelectedScreenshot(selectedAudit.results[0]?.screenshot || null)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Full Size
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-white/30">
                      <Image className="h-12 w-12 mx-auto mb-2" />
                      <p>No screenshot available</p>
                    </div>
                  )}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Full Screenshot Modal */}
      <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] bg-black border-white/10 p-0">
          {selectedScreenshot && (
            <img
              src={selectedScreenshot}
              alt="Full screenshot"
              className="w-full h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
