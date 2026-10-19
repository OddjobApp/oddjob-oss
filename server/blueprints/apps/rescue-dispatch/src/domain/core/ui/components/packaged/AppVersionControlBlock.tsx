/**
 * AppVersionControlBlock
 * 
 * Self-wiring platform block for viewing and managing app version history.
 * Git-like interface with commit history, diffs, and rollback capabilities.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitCommit, GitBranch, Tag, RotateCcw, Code2, User,
  Calendar, FileText, Plus, Minus, ChevronRight, X,
  GitCompare, Download, Copy, CheckCircle, AlertTriangle,
  Clock, Hash
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js';

interface AppVersion {
  id: string;
  appId: number;
  versionNumber: number;
  commitHash: string;
  message: string;
  author: string;
  branch: string;
  tags: string[];
  fileCount: number;
  linesChanged: { added: number; removed: number };
  createdAt: string;
}

interface DiffResult {
  filesChanged: FileChange[];
  stats: { added: number; removed: number; modified: number };
}

interface FileChange {
  path: string;
  status: "added" | "removed" | "modified";
  additions: number;
  deletions: number;
}

interface AppVersionControlBlockProps {
  appId?: number;
  appSlug?: string;
  showDiff?: boolean;
  maxVersions?: number;
  onRollback?: (versionId: string) => void;
}

export default function AppVersionControlBlock({
  appId,
  appSlug,
  showDiff = true,
  maxVersions = 20,
  onRollback
}: AppVersionControlBlockProps) {
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<AppVersion | null>(null);
  const [compareVersion, setCompareVersion] = useState<AppVersion | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  // Fetch version history
  const fetchVersions = useCallback(async () => {
    if (!appId && !appSlug) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appId) params.append("appId", String(appId));
      if (appSlug) params.append("appSlug", appSlug);
      if (selectedBranch !== "all") params.append("branch", selectedBranch);
      params.append("limit", String(maxVersions));

      const response = await fetch(`/api/versions?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setVersions(data.versions || []);
      }
    } catch (err) {
      console.error("[VersionControl] Failed to fetch versions:", err);
    } finally {
      setLoading(false);
    }
  }, [appId, appSlug, selectedBranch, maxVersions]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // Fetch diff when comparing versions
  const fetchDiff = useCallback(async (v1: AppVersion, v2: AppVersion) => {
    if (!showDiff) return;

    try {
      const response = await fetch(
        `/api/versions/diff?from=${v1.id}&to=${v2.id}`
      );
      if (response.ok) {
        const data = await response.json();
        setDiff(data);
      }
    } catch (err) {
      console.error("[VersionControl] Failed to fetch diff:", err);
    }
  }, [showDiff]);

  useEffect(() => {
    if (selectedVersion && compareVersion) {
      fetchDiff(selectedVersion, compareVersion);
    }
  }, [selectedVersion, compareVersion, fetchDiff]);

  const handleRollback = async () => {
    if (!selectedVersion || (!appId && !appSlug)) return;

    try {
      const response = await fetch(`/api/versions/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          appSlug,
          targetVersionId: selectedVersion.id
        })
      });

      if (response.ok) {
        onRollback?.(selectedVersion.id);
        await fetchVersions();
      }
    } catch (err) {
      console.error("[VersionControl] Rollback failed:", err);
    } finally {
      setRollbackDialogOpen(false);
    }
  };

  const handleTag = async () => {
    if (!selectedVersion || !newTag.trim()) return;

    try {
      await fetch(`/api/versions/${selectedVersion.id}/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: newTag.trim() })
      });

      await fetchVersions();
      setNewTag("");
      setTagDialogOpen(false);
    } catch (err) {
      console.error("[VersionControl] Tag failed:", err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added": return "text-emerald-400";
      case "removed": return "text-rose-400";
      case "modified": return "text-amber-400";
      default: return "text-white/40";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "added": return <Plus className="h-3 w-3 text-emerald-400" />;
      case "removed": return <Minus className="h-3 w-3 text-rose-400" />;
      case "modified": return <GitCommit className="h-3 w-3 text-amber-400" />;
      default: return null;
    }
  };

  const branches = [...new Set(versions.map(v => v.branch))];
  const filteredVersions = selectedBranch === "all" 
    ? versions 
    : versions.filter(v => v.branch === selectedBranch);

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitCommit className="h-5 w-5 text-indigo-400" />
            <CardTitle className="text-lg font-bold text-white">Version History</CardTitle>
            <Badge variant="outline" className="bg-white/10 text-white/60">
              {versions.length} commits
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-white/5 border-white/10 text-white text-sm rounded px-2 py-1"
            >
              <option value="all">All Branches</option>
              {branches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchVersions}
              className="border-white/10 text-white/60"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-12 text-white/30">
            <GitCommit className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No version history</p>
            <p className="text-sm mt-1">Versions will appear when the app is committed</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Version List */}
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredVersions.map((version, index) => (
                  <motion.div
                    key={version.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedVersion?.id === version.id
                        ? "bg-indigo-500/10 border-indigo-500/30"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <GitCommit className="h-4 w-4 text-white/40" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-indigo-400">
                            #{version.versionNumber}
                          </span>
                          <span className="font-mono text-xs text-white/40">
                            {version.commitHash.slice(0, 7)}
                          </span>
                          {version.branch !== "main" && (
                            <Badge variant="outline" className="text-xs border-white/20 text-white/60">
                              <GitBranch className="h-3 w-3 mr-1" />
                              {version.branch}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-white mt-1 truncate">{version.message}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {version.author}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(version.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {version.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {version.tags.map(tag => (
                              <Badge key={tag} variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                                <Tag className="h-3 w-3 mr-1" />
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        <div className="text-emerald-400">+{version.linesChanged.added}</div>
                        <div className="text-rose-400">-{version.linesChanged.removed}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </ScrollArea>

            {/* Version Details / Diff */}
            {selectedVersion && (
              <div className="bg-white/5 rounded-lg border border-white/10 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <GitCommit className="h-5 w-5 text-indigo-400" />
                    <span className="font-bold text-white">Version #{selectedVersion.versionNumber}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setTagDialogOpen(true)}
                          >
                            <Tag className="h-4 w-4 text-white/60" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add Tag</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setRollbackDialogOpen(true)}
                          >
                            <RotateCcw className="h-4 w-4 text-amber-400" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Rollback to this version</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCompareVersion(selectedVersion)}
                          >
                            <GitCompare className="h-4 w-4 text-white/60" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Compare with another version</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                <Tabs defaultValue="details">
                  <TabsList className="bg-white/5 border-white/10">
                    <TabsTrigger value="details" className="data-[state=active]:bg-white/10">
                      Details
                    </TabsTrigger>
                    {showDiff && (
                      <TabsTrigger value="changes" className="data-[state=active]:bg-white/10">
                        Changes
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="details" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Commit</span>
                        <span className="font-mono text-white">{selectedVersion.commitHash}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Author</span>
                        <span className="text-white">{selectedVersion.author}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Date</span>
                        <span className="text-white">{new Date(selectedVersion.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Files Changed</span>
                        <span className="text-white">{selectedVersion.fileCount}</span>
                      </div>
                    </div>

                    <div className="bg-black/40 rounded p-3">
                      <p className="text-xs text-white/40 mb-1">Commit Message</p>
                      <p className="text-sm text-white">{selectedVersion.message}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-emerald-500/10 rounded p-3 text-center">
                        <div className="text-2xl font-bold text-emerald-400">+{selectedVersion.linesChanged.added}</div>
                        <div className="text-xs text-white/40">Lines Added</div>
                      </div>
                      <div className="bg-rose-500/10 rounded p-3 text-center">
                        <div className="text-2xl font-bold text-rose-400">-{selectedVersion.linesChanged.removed}</div>
                        <div className="text-xs text-white/40">Lines Removed</div>
                      </div>
                    </div>
                  </TabsContent>

                  {showDiff && (
                    <TabsContent value="changes" className="mt-4">
                      {compareVersion && selectedVersion.id !== compareVersion.id ? (
                        diff ? (
                          <div className="space-y-2">
                            <p className="text-xs text-white/40 mb-2">
                              Comparing #{compareVersion.versionNumber} → #{selectedVersion.versionNumber}
                            </p>
                            {diff.filesChanged.map((file, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-2 p-2 bg-black/40 rounded text-sm"
                              >
                                {getStatusIcon(file.status)}
                                <span className={`flex-1 truncate ${getStatusColor(file.status)}`}>
                                  {file.path}
                                </span>
                                <span className="text-xs text-emerald-400">+{file.additions}</span>
                                <span className="text-xs text-rose-400">-{file.deletions}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center py-8">
                            <div className="animate-spin h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
                          </div>
                        )
                      ) : (
                        <div className="text-center py-8 text-white/30">
                          <GitCompare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">Select another version to compare</p>
                        </div>
                      )}
                    </TabsContent>
                  )}
                </Tabs>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Rollback Dialog */}
      <Dialog open={rollbackDialogOpen} onOpenChange={setRollbackDialogOpen}>
        <DialogContent className="bg-zinc-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Rollback to Version #{selectedVersion?.versionNumber}
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/60">
            This will restore the app to version <strong className="text-white">#{selectedVersion?.versionNumber}</strong>.
            A new version will be created to track this rollback.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRollbackDialogOpen(false)}
              className="text-white/60"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRollback}
              className="bg-amber-500 hover:bg-amber-400 text-white"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Confirm Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="bg-zinc-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-amber-400" />
              Add Tag to Version #{selectedVersion?.versionNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Enter tag name (e.g., v1.0, release)"
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white placeholder:text-white/30"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTagDialogOpen(false)}
              className="text-white/60"
            >
              Cancel
            </Button>
            <Button
              onClick={handleTag}
              disabled={!newTag.trim()}
              className="bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              <Tag className="h-4 w-4 mr-2" />
              Add Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
