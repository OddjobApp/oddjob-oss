import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Search, Sparkles, Loader2, TrendingUp, ExternalLink } from "lucide-react";
import { SimilaritySlider } from './SimilaritySlider.js';
import { SearchModeToggle } from './SearchModeToggle.js';
import { Link } from "wouter";

type SearchMode = "semantic" | "keyword" | "hybrid";

interface SearchResult {
    id: number;
    type: "document" | "node" | "job" | "pipeline";
    title: string;
    description?: string;
    url?: string;
    similarity?: number;
    score?: number;
    metadata?: Record<string, any>;
}

interface SemanticSearchProps {
    defaultMode?: SearchMode;
    defaultThreshold?: number;
    organizationId?: number | null;
}

export function SemanticSearch({
    defaultMode = "semantic",
    defaultThreshold = 0.7,
    organizationId
}: SemanticSearchProps) {
    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [searchMode, setSearchMode] = useState<SearchMode>(defaultMode);
    const [similarityThreshold, setSimilarityThreshold] = useState(defaultThreshold);
    const [maxResults, setMaxResults] = useState(10);
    const [beforeDate, setBeforeDate] = useState("");
    const [afterDate, setAfterDate] = useState("");
    const [useUpdatedDate, setUseUpdatedDate] = useState(false);

    const { data, isLoading, error } = useQuery({
        queryKey: ["semantic-search", activeQuery, searchMode, similarityThreshold, maxResults, organizationId, beforeDate, afterDate, useUpdatedDate],
        queryFn: async () => {
            if (!activeQuery) return null;

            const temporalParams: any = {};
            if (useUpdatedDate) {
                if (beforeDate) temporalParams.updated_before = beforeDate;
                if (afterDate) temporalParams.updated_after = afterDate;
            } else {
                if (beforeDate) temporalParams.before = beforeDate;
                if (afterDate) temporalParams.after = afterDate;
            }

            const res = await apiRequest("POST", "/api/search/semantic", {
                query: activeQuery,
                mode: searchMode,
                similarityThreshold,
                maxResults,
                organizationId,
                ...temporalParams
            });

            return res.json();
        },
        enabled: !!activeQuery
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            setActiveQuery(query.trim());
        }
    };

    const handleFindSimilar = async (result: SearchResult) => {
        try {
            const res = await apiRequest("POST", "/api/search/find-similar", {
                id: result.id,
                type: result.type,
                limit: maxResults,
                threshold: similarityThreshold
            });

            const similarResults = await res.json();
            // Update query to show similar results
            setQuery(`Similar to: ${result.title}`);
            setActiveQuery(`similar:${result.id}`);
        } catch (err) {
            console.error("Failed to find similar items:", err);
        }
    };

    const getSimilarityColor = (similarity: number) => {
        if (similarity >= 0.9) return "bg-green-100 text-green-800 border-green-200";
        if (similarity >= 0.7) return "bg-blue-100 text-blue-800 border-blue-200";
        if (similarity >= 0.5) return "bg-yellow-100 text-yellow-800 border-yellow-200";
        return "bg-muted text-foreground border-border";
    };

    return (
        <div className="space-y-6">
            {/* Search Controls */}
            <Card>
                <CardContent className="pt-6 space-y-4">
                    <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Search using natural language..."
                                className="pl-10"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Sparkles className="h-4 w-4 mr-2" />
                            )}
                            Search
                        </Button>
                    </form>

                    {/* Search Mode Toggle */}
                    <SearchModeToggle value={searchMode} onChange={setSearchMode} />

                    {/* Temporal Filters */}
                    <div className="space-y-3 pt-2 border-t">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm font-medium">Temporal Filters</span>
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <span className="text-xs text-muted-foreground">Use Modification Date</span>
                                    <input 
                                        type="checkbox" 
                                        checked={useUpdatedDate} 
                                        onChange={(e) => setUseUpdatedDate(e.target.checked)}
                                        className="h-4 w-4 rounded border-border"
                                        aria-label="Use modification date instead of creation date"
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground">After</span>
                                <Input 
                                    type="date" 
                                    value={afterDate} 
                                    onChange={(e) => setAfterDate(e.target.value)}
                                    className="h-9"
                                    aria-label="Filter results after this date"
                                />
                            </div>
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground">Before</span>
                                <Input 
                                    type="date" 
                                    value={beforeDate} 
                                    onChange={(e) => setBeforeDate(e.target.value)}
                                    className="h-9"
                                    aria-label="Filter results before this date"
                                />
                            </div>
                        </div>
                        {(afterDate || beforeDate) && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-7 text-xs px-2"
                                onClick={() => { setAfterDate(""); setBeforeDate(""); }}
                            >
                                Clear Temporal Filters
                            </Button>
                        )}
                    </div>

                    {/* Similarity Threshold (only for semantic/hybrid) */}
                    {(searchMode === "semantic" || searchMode === "hybrid") && (
                        <SimilaritySlider
                            value={similarityThreshold}
                            onChange={setSimilarityThreshold}
                        />
                    )}

                    {/* Max Results */}
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Max Results:</span>
                        <select
                            value={maxResults}
                            onChange={(e) => setMaxResults(Number(e.target.value))}
                            className="border rounded px-2 py-1"
                            aria-label="Maximum number of search results"
                        >
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                        </select>
                    </div>
                </CardContent>
            </Card>

            {/* Results */}
            {error && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="pt-6">
                        <p className="text-sm text-red-600">
                            Failed to search: {error instanceof Error ? error.message : "Unknown error"}
                        </p>
                    </CardContent>
                </Card>
            )}

            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="ml-3 text-muted-foreground">Searching...</span>
                </div>
            )}

            {data?.results && data.results.length > 0 && (
                <div className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-sm font-medium text-muted-foreground">
                            Found {data.results.length} result{data.results.length !== 1 ? 's' : ''}
                        </h3>
                        {data.queryType && (
                            <Badge variant="outline">
                                Query Type: {data.queryType}
                            </Badge>
                        )}
                    </div>

                    {data.results.map((result: SearchResult) => (
                        <Card key={`${result.type}-${result.id}`} className="hover:border-primary/50 transition-colors">
                            <CardHeader className="pb-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                    <div className="flex-1">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            {result.url ? (
                                                <Link href={result.url} className="hover:underline flex items-center gap-2">
                                                    {result.title}
                                                    <ExternalLink className="h-4 w-4" />
                                                </Link>
                                            ) : (
                                                result.title
                                            )}
                                        </CardTitle>
                                        <Badge variant="outline" className="mt-1 text-xs">
                                            {result.type}
                                        </Badge>
                                    </div>
                                    <div className="flex flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
                                        {(result.similarity !== undefined || result.score !== undefined) && (
                                            <Badge
                                                className={getSimilarityColor(result.similarity || result.score || 0)}
                                            >
                                                {((result.similarity || result.score || 0) * 100).toFixed(0)}% match
                                            </Badge>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleFindSimilar(result)}
                                            title="Find similar items"
                                            className="shrink-0"
                                        >
                                            <TrendingUp className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            {result.description && (
                                <CardContent>
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        {result.description}
                                    </p>
                                    {result.metadata && Object.keys(result.metadata).length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {Object.entries(result.metadata).slice(0, 3).map(([key, value]) => (
                                                <Badge key={key} variant="secondary" className="text-xs">
                                                    {key}: {String(value)}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            {activeQuery && data?.results && data.results.length === 0 && !isLoading && (
                <Card>
                    <CardContent className="pt-6 text-center">
                        <p className="text-muted-foreground">
                            No results found. Try adjusting your search query or lowering the similarity threshold.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
