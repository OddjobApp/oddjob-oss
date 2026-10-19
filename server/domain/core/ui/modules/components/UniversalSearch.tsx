/**
 * Universal Analyst Search - Command Bar Component
 * 
 * A unified search interface (Cmd+K) that intelligently routes queries
 * to the appropriate search backend: Keyword, Vector/RAG, or Graph.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Search,
    Loader2,
    FileText,
    Network,
    BookOpen,
    ArrowRight,
    Sparkles,
    X,
    ExternalLink,
    Clock,
    Zap,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { MiniGraphVisualization } from "@domain-ui/knowledge/ui/components/knowledge/MiniGraphVisualization";

// Query classification types
type QueryType = "keyword" | "vector" | "graph" | "unknown";

interface SearchResult {
    id: string | number;
    type: "document" | "node" | "job" | "pipeline";
    title: string;
    description?: string;
    url?: string;
    metadata?: Record<string, any>;
    score?: number;
}

interface ClassificationResult {
    queryType: QueryType;
    confidence: number;
    explanation?: string;
    searchResults: SearchResult[];
    graphData?: {
        nodes: Array<{ id: number; label: string; name: string }>;
        edges: Array<{ sourceId: number; targetId: number; relation: string }>;
    };
}

interface UniversalSearchProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// Recent searches stored in localStorage
const RECENT_SEARCHES_KEY = "oddjob_recent_searches";
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): string[] {
    try {
        const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function addRecentSearch(query: string) {
    const recent = getRecentSearches().filter(q => q !== query);
    recent.unshift(query);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
}

export function UniversalSearch({ open, onOpenChange }: UniversalSearchProps) {
    const { toast } = useToast();
    const [, setLocation] = useLocation();
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load recent searches on mount
    useEffect(() => {
        setRecentSearches(getRecentSearches());
    }, [open]);

    // Focus input when dialog opens
    useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    // Debounce query
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query.trim().length >= 2) {
                setDebouncedQuery(query.trim());
            } else {
                setDebouncedQuery("");
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Search mutation
    const searchMutation = useMutation({
        mutationFn: async (searchQuery: string): Promise<ClassificationResult> => {
            const res = await apiRequest("POST", "/api/search/universal", {
                query: searchQuery,
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || "Search failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            if (query.trim()) {
                addRecentSearch(query.trim());
                setRecentSearches(getRecentSearches());
            }
        },
        onError: (error: any) => {
            toast({
                title: "Search Error",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    // Trigger search when debounced query changes
    useEffect(() => {
        if (debouncedQuery) {
            searchMutation.mutate(debouncedQuery);
        }
    }, [debouncedQuery, searchMutation]);

    const handleSearch = useCallback(() => {
        if (query.trim().length >= 2) {
            searchMutation.mutate(query.trim());
        }
    }, [query, searchMutation]);

    const handleResultClick = (result: SearchResult) => {
        if (result.url) {
            setLocation(result.url);
            onOpenChange(false);
            setQuery("");
        }
    };

    const handleRecentClick = (recentQuery: string) => {
        setQuery(recentQuery);
        searchMutation.mutate(recentQuery);
    };

    const getQueryTypeIcon = (type: QueryType) => {
        switch (type) {
            case "keyword":
                return <Search className="w-4 h-4 text-blue-500" />;
            case "vector":
                return <BookOpen className="w-4 h-4 text-purple-500" />;
            case "graph":
                return <Network className="w-4 h-4 text-green-500" />;
            default:
                return <Sparkles className="w-4 h-4 text-muted-foreground" />;
        }
    };

    const getQueryTypeBadge = (type: QueryType, confidence?: number) => {
        const config = {
            keyword: { label: "Keyword Search", color: "bg-blue-100 text-blue-700" },
            vector: { label: "Semantic Search", color: "bg-purple-100 text-purple-700" },
            graph: { label: "Graph Query", color: "bg-green-100 text-green-700" },
            unknown: { label: "Mixed Search", color: "bg-muted text-foreground" },
        };
        const c = config[type];
        return (
            <div className="flex items-center gap-2">
                {getQueryTypeIcon(type)}
                <Badge variant="secondary" className={cn("text-xs", c.color)}>
                    {c.label}
                </Badge>
                {confidence && confidence > 0 && (
                    <span className="text-xs text-muted-foreground">
                        {Math.round(confidence * 100)}% match
                    </span>
                )}
            </div>
        );
    };

    const getResultIcon = (type: SearchResult["type"]) => {
        switch (type) {
            case "document":
                return <FileText className="w-4 h-4 text-orange-500" />;
            case "node":
                return <Network className="w-4 h-4 text-green-500" />;
            case "job":
                return <Zap className="w-4 h-4 text-blue-500" />;
            case "pipeline":
                return <ArrowRight className="w-4 h-4 text-indigo-500" />;
            default:
                return <FileText className="w-4 h-4 text-muted-foreground" />;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSearch();
                            if (e.key === "Escape") onOpenChange(false);
                        }}
                        placeholder="Search jobs, documents, knowledge graph..."
                        className="border-0 shadow-none focus-visible:ring-0 text-base placeholder:text-muted-foreground/60"
                    />
                    {searchMutation.isPending && (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    )}
                    {query && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setQuery("")}
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    )}
                </div>

                {/* Results Area */}
                <ScrollArea className="max-h-[400px]">
                    {/* Show classification and results */}
                    {searchMutation.data && (
                        <div className="p-4 space-y-4">
                            {/* Query Type Indicator */}
                            <div className="flex items-center justify-between">
                                {getQueryTypeBadge(searchMutation.data.queryType, searchMutation.data.confidence)}
                                {searchMutation.data.explanation && (
                                    <span className="text-xs text-muted-foreground italic">
                                        {searchMutation.data.explanation}
                                    </span>
                                )}
                            </div>

                            <Separator />

                            {/* Results List */}
                            {searchMutation.data.searchResults.length > 0 ? (
                                <div className="space-y-2">
                                    {searchMutation.data.searchResults.map((result, idx) => (
                                        <div
                                            key={`${result.type}-${result.id}-${idx}`}
                                            onClick={() => handleResultClick(result)}
                                            className={cn(
                                                "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                                                "hover:bg-gray-50 dark:hover:bg-gray-800",
                                                "group"
                                            )}
                                        >
                                            <div className="mt-0.5">{getResultIcon(result.type)}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium truncate group-hover:text-primary transition-colors">
                                                        {result.title}
                                                    </span>
                                                    <Badge variant="outline" className="text-[10px] shrink-0">
                                                        {result.type}
                                                    </Badge>
                                                </div>
                                                {result.description && (
                                                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                                                        {result.description}
                                                    </p>
                                                )}
                                                {result.score !== undefined && (
                                                    <div className="flex items-center gap-1 mt-1">
                                                        <div className="h-1 w-16 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${Math.round(result.score * 100)}%` }}
                                                                transition={{ duration: 0.5, ease: "easeOut" }}
                                                                className="h-full bg-primary rounded-full"
                                                            />
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {Math.round(result.score * 100)}%
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p>No results found for "{query}"</p>
                                    <p className="text-xs mt-1">Try different keywords or check your spelling</p>
                                </div>
                            )}

                            {/* Graph Visualization for Graph Queries */}
                            {searchMutation.data.queryType === "graph" && searchMutation.data.graphData && (
                                <div className="mt-4 pt-4 border-t">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Network className="w-4 h-4 text-green-500" />
                                        <span className="text-sm font-medium">Graph View</span>
                                        <span className="text-xs text-muted-foreground">
                                            Click a node to view details
                                        </span>
                                    </div>
                                    <MiniGraphVisualization
                                        nodes={searchMutation.data.graphData.nodes}
                                        edges={searchMutation.data.graphData.edges}
                                        width={580}
                                        height={200}
                                        onNodeClick={(nodeId) => {
                                            setLocation(`/knowledge/graph?highlight=${nodeId}`);
                                            onOpenChange(false);
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty State - Recent Searches */}
                    {!searchMutation.data && !searchMutation.isPending && (
                        <div className="p-4 space-y-4">
                            {recentSearches.length > 0 && (
                                <>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                        <Clock className="w-3 h-3" />
                                        Recent Searches
                                    </div>
                                    <div className="space-y-1">
                                        {recentSearches.map((recent, idx) => (
                                            <div
                                                key={idx}
                                                onClick={() => handleRecentClick(recent)}
                                                className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
                                            >
                                                <Search className="w-4 h-4 text-muted-foreground" />
                                                <span>{recent}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <Separator />
                                </>
                            )}

                            {/* Quick Actions */}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                <Zap className="w-3 h-3" />
                                Quick Actions
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    variant="outline"
                                    className="justify-start h-auto py-3"
                                    onClick={() => {
                                        setLocation("/jobs");
                                        onOpenChange(false);
                                    }}
                                >
                                    <Zap className="w-4 h-4 mr-2 text-blue-500" />
                                    <div className="text-left">
                                        <div className="text-sm font-medium">Jobs</div>
                                        <div className="text-xs text-muted-foreground">View all jobs</div>
                                    </div>
                                </Button>
                                <Button
                                    variant="outline"
                                    className="justify-start h-auto py-3"
                                    onClick={() => {
                                        setLocation("/pipelines");
                                        onOpenChange(false);
                                    }}
                                >
                                    <ArrowRight className="w-4 h-4 mr-2 text-indigo-500" />
                                    <div className="text-left">
                                        <div className="text-sm font-medium">Pipelines</div>
                                        <div className="text-xs text-muted-foreground">Automation flows</div>
                                    </div>
                                </Button>
                                <Button
                                    variant="outline"
                                    className="justify-start h-auto py-3"
                                    onClick={() => {
                                        setLocation("/knowledge/graph");
                                        onOpenChange(false);
                                    }}
                                >
                                    <Network className="w-4 h-4 mr-2 text-green-500" />
                                    <div className="text-left">
                                        <div className="text-sm font-medium">Knowledge Graph</div>
                                        <div className="text-xs text-muted-foreground">Explore entities</div>
                                    </div>
                                </Button>
                                <Button
                                    variant="outline"
                                    className="justify-start h-auto py-3"
                                    onClick={() => {
                                        setLocation("/knowledge/store");
                                        onOpenChange(false);
                                    }}
                                >
                                    <BookOpen className="w-4 h-4 mr-2 text-purple-500" />
                                    <div className="text-left">
                                        <div className="text-sm font-medium">Knowledge Store</div>
                                        <div className="text-xs text-muted-foreground">Documents & RAG</div>
                                    </div>
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Loading State */}
                    {searchMutation.isPending && (
                        <div className="p-8 text-center">
                            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-2" />
                            <p className="text-sm text-muted-foreground">Analyzing your query...</p>
                        </div>
                    )}
                </ScrollArea>

                {/* Footer */}
                <div className="border-t px-4 py-2 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] font-mono">↵</kbd>
                            to select
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] font-mono">esc</kbd>
                            to close
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>AI-powered search</span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// Hook to manage global search
export function useUniversalSearch() {
    const [isOpen, setIsOpen] = useState(false);

    // Global keyboard shortcut (Cmd+K / Ctrl+K)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setIsOpen(true);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    return {
        isOpen,
        setIsOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen(prev => !prev),
    };
}

export default UniversalSearch;

