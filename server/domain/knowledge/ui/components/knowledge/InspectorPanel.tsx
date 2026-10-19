/**
 * Inspector Panel Component
 * 
 * Slide-out drawer showing node details, properties, and actions.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X, Expand, Edit, Trash2, ExternalLink, Search, Database, ArrowRightCircle, Network, FileText } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@domain-ui/core/ui/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@domain-ui/core/ui/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

interface KnowledgeNode {
  id: number;
  label: string;
  name: string;
  externalId?: string | null;
  data: Record<string, any>;
  knowledgeDocumentId?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface InspectorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: KnowledgeNode | null;
  onExpand?: () => void;
  onFindRelated?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPivot?: (value: string) => void;
  onAnalyzeImpact?: () => void;
  expansionDepth?: number;
  onDepthChange?: (depth: number) => void;
}

// Helper to safely render complex values
function SafeValue({ value }: { value: any }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/50 italic">null</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span>{value}</span>;
  if (typeof value === 'string') {
    if (value.startsWith('http')) return <a href={value} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">{value.substring(0, 30)}... <ExternalLink className="w-3 h-3" /></a>;
    return <span className="break-all">{value}</span>;
  }
  if (Array.isArray(value)) return <Badge variant="secondary" className="text-[10px] font-mono">Array[{value.length}]</Badge>;
  if (typeof value === 'object') {
    // Deep properties might crash direct stringify if circular
    try {
      const keys = Object.keys(value);
      return (
        <Badge variant="outline" className="text-[10px] font-mono bg-muted">
          Object ({keys.length} keys)
        </Badge>
      );
    } catch (e) {
      return <span className="text-red-400">[Complex Object]</span>;
    }
  }
  return <span>{String(value)}</span>;
}

export default function InspectorPanel({
  open,
  onOpenChange,
  node,
  onExpand,
  onFindRelated,
  onEdit,
  onDelete,
  onPivot,
  onAnalyzeImpact,
  expansionDepth = 1,
  onDepthChange,
}: InspectorPanelProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("details");
  const [filterQuery, setFilterQuery] = useState("");

  // Data Explorer Query
  const isSchemaField = node?.label === "Schema" || (node?.data && (node.data as any).dataType);
  // Refined check: In our graph, Schema Nodes usually have label="Schema". 
  // If we selected a specific field node (hypothetically), we'd check that too.
  // For now, let's assume if it's a Schema node, we might want to explore values of fields defined in it? 
  // Actually, per spec, we select a "SchemaFieldNode". 
  // Let's support exploring values if the node represents a Field.
  // Since we haven't fully wired the "Click Field -> Select Field Node" logic yet in the parent,
  // we will allow this on ANY node for now to test, filtering by its name as the field key.

  const { data: uniqueValues, refetch: loadValues, isLoading: isLoadingValues, isFetched } = useQuery({
    queryKey: ["/api/knowledge-graph/values", node?.name],
    queryFn: async () => {
      if (!node?.name) return [];
      const res = await apiRequest("GET", `/api/knowledge-graph/values?field=${encodeURIComponent(node.name)}`);
      return res.json();
    },
    enabled: false, // Wait for user click
  });

  if (!node) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader className="mb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Node Inspector</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <SheetDescription>
            {node.name} <Badge variant="outline" className="ml-2">{node.label}</Badge>
          </SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details">Details & Actions</TabsTrigger>
            <TabsTrigger value="explorer">Data Explorer</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="flex-1 overflow-auto">
            <ScrollArea className="h-full">
              <div className="space-y-6 p-1">
                {/* Properties */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Properties</h3>
                  <div className="space-y-2">
                    {node.data && typeof node.data === "object" ? (
                      Object.entries(node.data).map(([key, value]) => (
                        <div key={key} className="flex justify-between items-start text-sm border-b border-border pb-2 last:border-0 pt-1">
                          <span className="text-muted-foreground capitalize shrink-0 mr-4 font-medium">
                            {key.replace(/([A-Z])/g, " $1").trim()}:
                          </span>
                          <div className="text-right max-w-[240px] overflow-hidden">
                            <SafeValue value={value} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No properties</div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Actions */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Actions</h3>
                  <div className="flex flex-col gap-2">
                    {onExpand && (
                      <Button variant="outline" onClick={onExpand}>
                        <Expand className="w-4 h-4 mr-2" />
                        <Expand className="w-4 h-4 mr-2" />
                        Expand Neighbors
                      </Button>
                    )}
                    {onExpand && onDepthChange && (
                      <div className="px-1 py-2 space-y-3 border rounded-md bg-muted">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-muted-foreground">Impact Depth</span>
                          <span className="text-xs font-bold text-indigo-600">{expansionDepth} hops</span>
                        </div>
                        <Slider
                          defaultValue={[expansionDepth]}
                          max={5}
                          min={1}
                          step={1}
                          onValueChange={(vals) => onDepthChange(vals[0])}
                          className="py-1"
                        />
                      </div>
                    )}
                    {onFindRelated && (
                      <Button variant="outline" onClick={onFindRelated}>
                        <Search className="w-4 h-4 mr-2" />
                        Find Related
                      </Button>
                    )}
                    {onEdit && (
                      <Button variant="outline" onClick={onEdit}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Properties
                      </Button>
                    )}
                    {onDelete && (
                      <Button variant="destructive" onClick={onDelete}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Node
                      </Button>
                    )}
                    {onAnalyzeImpact && (
                      <Button variant="outline" onClick={onAnalyzeImpact} className="border-blue-200 text-blue-600 hover:bg-blue-50">
                        <Network className="w-4 h-4 mr-2" />
                        Analyze Impact
                      </Button>
                    )}
                    {node.knowledgeDocumentId && (
                      <Button
                        variant="outline"
                        className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                        onClick={() => {
                          setLocation('/knowledge/store');
                        }}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        View Source Document
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="explorer" className="flex-1 overflow-auto flex flex-col">
            <div className="space-y-4 p-1">
              <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <Database className="w-4 h-4 text-pink-500" />
                  Value Distribution
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Analyze unique values for the field <strong>"{node.name}"</strong> across the entire knowledge graph.
                </p>

                {!isFetched ? (
                  <Button size="sm" className="mt-4 w-full" onClick={() => loadValues()} disabled={isLoadingValues}>
                    {isLoadingValues ? "Scanning Database..." : "Load Unique Values"}
                  </Button>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Found {(uniqueValues as any)?.length || 0} unique values</span>
                      <Button variant="ghost" size="sm" className="h-6" onClick={() => loadValues()}>Refresh</Button>
                    </div>
                    <Input
                      placeholder="Filter values..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
              </div>

              {isFetched && (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Value</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((uniqueValues as any[]) || [])
                        .filter(row => String(row.value).toLowerCase().includes(filterQuery.toLowerCase()))
                        .map((row, i) => (
                          <TableRow key={i} className="group cursor-pointer hover:bg-muted/50">
                            <TableCell className="font-medium text-xs break-all">
                              {String(row.value).slice(0, 50)}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              <Badge variant="secondary">{row.count}</Badge>
                            </TableCell>
                            <TableCell>
                              {onPivot && (
                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => onPivot(String(row.value))}>
                                  <ArrowRightCircle className="w-4 h-4 text-indigo-600" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      {(!uniqueValues || (uniqueValues as any[]).length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                            No values found or field does not exist on nodes.
                          </TableCell>
                        </TableRow>
                      )}

                      {/* Empty state for filter */}
                      {uniqueValues && (uniqueValues as any[]).length > 0 &&
                        ((uniqueValues as any[]) || []).filter(row => String(row.value).toLowerCase().includes(filterQuery.toLowerCase())).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                              No values match "{filterQuery}"
                            </TableCell>
                          </TableRow>
                        )}

                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

      </SheetContent>
    </Sheet>
  );
}

