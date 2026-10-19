import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Play, Save, Download, Upload, Trash2, Eye, Code, Plus, X, Network, Database as DatabaseIcon, ArrowRight, Sparkles, Table2, Clock, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import type { VisualQuery, QueryTemplate, SavedQuery, VisualQueryNode, VisualQueryRelationship } from './types.js';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@domain-ui/core/ui/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@domain-ui/core/ui/components/ui/dialog';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { ToastAction } from '@domain-ui/core/ui/components/ui/toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";

/**
 * Graph rows come back as knowledge_nodes rows, where the flexible payload lives
 * in `data`. Some callers hand us a already-mapped `properties` bag instead.
 */
const nodeProperties = (node: any): Record<string, any> =>
    (node?.data && typeof node.data === 'object' ? node.data : node?.properties) || {};

export default function QueryBuilder() {
    const [, setLocation] = useLocation();
    const [visualQuery, setVisualQuery] = useState<VisualQuery>({
        nodes: [],
        relationships: [],
        returnClause: { items: [] },
        limit: 50
    });
    const [templates, setTemplates] = useState<QueryTemplate[]>([]);
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [cypherPreview, setCypherPreview] = useState<string>('');
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [isExecuting, setIsExecuting] = useState(false);
    const [results, setResults] = useState<{ nodes: any[]; edges: any[]; executionTimeMs?: number; totalNodes?: number; truncated?: boolean } | null>(null);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [hasExecuted, setHasExecuted] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('cypher');
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const [showTemplates, setShowTemplates] = useState(false);
    const [showSavedQueries, setShowSavedQueries] = useState(false);
    const [nodeTypes, setNodeTypes] = useState<string[]>([]);
    const [relationshipTypes, setRelationshipTypes] = useState<string[]>([]);
    const [showDatasetDialog, setShowDatasetDialog] = useState(false);
    const [datasetAction, setDatasetAction] = useState<'new' | 'existing'>('new');
    const [newDatasetName, setNewDatasetName] = useState('');
    const [newDatasetDescription, setNewDatasetDescription] = useState('');
    const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
    const [existingDatasets, setExistingDatasets] = useState<any[]>([]);
    const [isSavingDataset, setIsSavingDataset] = useState(false);
    const [aiIntent, setAiIntent] = useState('');
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [saveDescription, setSaveDescription] = useState('');
    const [saveMode, setSaveMode] = useState<'new' | 'update'>('new');
    const [isSavingQuery, setIsSavingQuery] = useState(false);
    const [activeSavedQuery, setActiveSavedQuery] = useState<SavedQuery | null>(null);
    const { toast } = useToast();

    // Derived rather than tracked: any edit that moves the builder away from the
    // structure we loaded counts as unsaved.
    const isDirty = !!activeSavedQuery &&
        JSON.stringify(visualQuery) !== JSON.stringify(activeSavedQuery.queryStructure);

    // Load initial data
    useEffect(() => {
        loadTemplates();
        loadSavedQueries();
        loadSchemaInfo();
        loadExistingDatasets();
    }, []);

    // Validate query whenever it changes
    useEffect(() => {
        if (visualQuery.nodes.length > 0) {
            validateQuery();
        }
    }, [visualQuery]);

    const loadSchemaInfo = async () => {
        try {
            const [nodesRes, relsRes] = await Promise.all([
                apiRequest('GET', '/api/knowledge-graph/query-builder/node-types'),
                apiRequest('GET', '/api/knowledge-graph/query-builder/relationship-types')
            ]);
            const nodesData = await nodesRes.json();
            const relsData = await relsRes.json();

            setNodeTypes((nodesData.nodeTypes || []).sort((a: string, b: string) => a.localeCompare(b)));
            setRelationshipTypes((relsData.relationshipTypes || []).sort((a: string, b: string) => a.localeCompare(b)));
        } catch (error) {
            console.error('Failed to load schema info:', error);
        }
    };

    const loadExistingDatasets = async () => {
        try {
            const response = await apiRequest('GET', '/api/fine-tuning/datasets');
            const data = await response.json();
            setExistingDatasets((data || []).sort((a: any, b: any) => a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Failed to load datasets:', error);
        }
    };

    const loadTemplates = async () => {
        try {
            const response = await apiRequest('GET', '/api/knowledge-graph/query-builder/templates');
            const data = await response.json();
            setTemplates(data.templates || []);
        } catch (error) {
            console.error('Failed to load templates:', error);
        }
    };

    const loadSavedQueries = async () => {
        try {
            const response = await apiRequest('GET', '/api/knowledge-graph/query-builder/saved-queries');
            const data = await response.json();
            setSavedQueries(data.queries || []);
        } catch (error) {
            console.error('Failed to load saved queries:', error);
        }
    };

    const validateQuery = async () => {
        if (visualQuery.nodes.length === 0) {
            setValidationErrors(['Add at least one node to begin']);
            setCypherPreview('');
            return;
        }

        try {
            const response = await apiRequest('POST', '/api/knowledge-graph/query-builder/validate', {
                visualQuery
            });
            const data = await response.json();

            if (data.valid) {
                setValidationErrors([]);
                generatePreview();
            } else {
                setValidationErrors(data.errors || []);
                setCypherPreview('');
            }
        } catch (error) {
            console.error('Validation failed:', error);
        }
    };

    const generatePreview = () => {
        const { nodes, relationships, returnClause, limit } = visualQuery;

        let preview = 'MATCH ';

        if (relationships.length > 0) {
            preview += relationships.map((rel: VisualQueryRelationship) => {
                const source = nodes.find((n: VisualQueryNode) => n.id === rel.sourceNodeId);
                const target = nodes.find((n: VisualQueryNode) => n.id === rel.targetNodeId);
                const formatLabel = (label: string | undefined) => {
                    if (!label || label === '*') return '';
                    return (label.includes(' ') || label.includes(':')) ? `:\`${label}\`` : `:${label}`;
                };

                const sourceLabel = formatLabel(source?.label);
                const targetLabel = formatLabel(target?.label);
                const relType = formatLabel(rel.type);

                const formatVar = (node: VisualQueryNode | undefined) => {
                    if (!node) return 'unknown';
                    const name = node.alias || node.id;
                    return (name.includes(' ') || name.includes(':')) ? `\`${name}\`` : name;
                };

                const sourceVar = formatVar(source);
                const targetVar = formatVar(target);

                if (rel.direction === 'outgoing') {
                    return `(${sourceVar}${sourceLabel})-[${rel.id}${relType}]->(${targetVar}${targetLabel})`;
                } else if (rel.direction === 'incoming') {
                    return `(${sourceVar}${sourceLabel})<-[${rel.id}${relType}]-(${targetVar}${targetLabel})`;
                } else {
                    return `(${sourceVar}${sourceLabel})-[${rel.id}${relType}]-(${targetVar}${targetLabel})`;
                }
            }).join(', ');
        } else {
            preview += nodes.map((node: VisualQueryNode) => {
                const label = node.label !== '*' ? ((node.label.includes(' ') || node.label.includes(':')) ? `:\`${node.label}\`` : `:${node.label}`) : '';
                const nodeVar = (node.alias?.includes(' ') || node.alias?.includes(':')) ? `\`${node.alias}\`` : (node.alias || node.id);
                return `(${nodeVar}${label})`;
            }).join(', ');
        }

        if (returnClause.items.length > 0) {
            preview += '\nRETURN ' + returnClause.items.map((item: any) => {
                if (item.type === 'node' || item.type === 'relationship') {
                    const node = nodes.find((n: VisualQueryNode) => n.id === item.id);
                    const varName = node?.alias ? (node.alias.includes(' ') || node.alias.includes(':') ? `\`${node.alias}\`` : node.alias) : item.id;
                    return varName;
                } else if (item.type === 'property') {
                    const node = nodes.find((n: VisualQueryNode) => n.id === item.id);
                    const varName = node?.alias ? (node.alias.includes(' ') || node.alias.includes(':') ? `\`${node.alias}\`` : node.alias) : item.id;
                    return `${varName}.${item.property}`;
                }
                return item.id || '';
            }).filter(Boolean).join(', ');
        }

        if (limit) {
            preview += `\nLIMIT ${limit}`;
        }

        setCypherPreview(preview);
    };

    const executeQuery = async () => {
        if (validationErrors.length > 0) {
            toast({
                title: "Invalid Query",
                description: "Please fix validation errors before executing",
                variant: "destructive"
            });
            return;
        }

        setIsExecuting(true);
        setExecutionError(null);
        setExpandedRows({});
        setActiveTab('results');
        try {
            const response = await apiRequest('POST', '/api/knowledge-graph/query-builder/execute', {
                visualQuery,
                // Runs of a saved query are recorded against it (last run / run count).
                savedQueryId: activeSavedQuery && !isDirty ? activeSavedQuery.id : undefined
            });
            const data = await response.json();

            setResults({
                nodes: data.nodes || [],
                edges: data.edges || [],
                executionTimeMs: data.executionTimeMs,
                totalNodes: data.totalNodes,
                truncated: data.truncated
            });
            setHasExecuted(true);

            toast({
                title: "Query Executed Successfully",
                description: `${data.nodes?.length || 0} nodes, ${data.edges?.length || 0} relationships`,
            });
        } catch (error: any) {
            console.error('Query execution failed:', error);
            setResults(null);
            setHasExecuted(true);
            setExecutionError(error?.message || 'Query execution failed');
            toast({
                title: "Execution Failed",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsExecuting(false);
        }
    };

    const toggleRow = (key: string) => {
        setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleAiGenerate = async () => {
        if (!aiIntent.trim()) return;

        setIsGeneratingAi(true);
        try {
            const response = await apiRequest('POST', '/api/knowledge-graph/query-builder/generate', {
                intent: aiIntent,
                currentQuery: visualQuery.nodes.length > 0 ? visualQuery : undefined
            });
            const data = await response.json();

            if (data.visualQuery) {
                setVisualQuery(data.visualQuery);
                toast({
                    title: "AI Suggestion Applied",
                    description: "Graph structure updated based on your intent.",
                });
            }
        } catch (error: any) {
            console.error('AI Generation failed:', error);
            toast({
                title: "AI Generation Failed",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsGeneratingAi(false);
        }
    };

    const openSaveDialog = () => {
        // Editing something already saved defaults to updating it; otherwise a fresh save.
        setSaveMode(activeSavedQuery ? 'update' : 'new');
        setSaveName(activeSavedQuery?.name || '');
        setSaveDescription(activeSavedQuery?.description || '');
        setShowSaveDialog(true);
    };

    const saveQuery = async () => {
        const name = saveName.trim();
        if (!name) {
            toast({ title: "Name Required", description: "Give the query a name so you can find it again.", variant: "destructive" });
            return;
        }

        setIsSavingQuery(true);
        try {
            const isUpdate = saveMode === 'update' && typeof activeSavedQuery?.id === 'number';
            const response = isUpdate
                ? await apiRequest('PUT', `/api/knowledge-graph/query-builder/saved-queries/${activeSavedQuery!.id}`, {
                    name,
                    description: saveDescription.trim() || undefined,
                    queryStructure: visualQuery
                })
                : await apiRequest('POST', '/api/knowledge-graph/query-builder/saved-queries', {
                    name,
                    description: saveDescription.trim() || undefined,
                    queryStructure: visualQuery
                });

            const data = await response.json();
            if (data?.query) {
                setActiveSavedQuery(data.query);
            }
            setShowSaveDialog(false);

            toast({
                title: isUpdate ? "Query Updated" : "Query Saved",
                description: `"${name}" is in your saved queries.`
            });
            loadSavedQueries();
        } catch (error: any) {
            console.error('Failed to save query:', error);
            toast({ title: "Save Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSavingQuery(false);
        }
    };

    const loadSavedQuery = (query: SavedQuery) => {
        setVisualQuery(query.queryStructure);
        setActiveSavedQuery(query);
        setShowSavedQueries(false);
        setResults(null);
        setHasExecuted(false);
        setExecutionError(null);
        setActiveTab('cypher');
        toast({ title: "Query Loaded", description: query.name });
    };

    const deleteSavedQuery = async (query: SavedQuery, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete the saved query "${query.name}"?`)) return;

        try {
            await apiRequest('DELETE', `/api/knowledge-graph/query-builder/saved-queries/${query.id}`);
            if (activeSavedQuery?.id === query.id) {
                setActiveSavedQuery(null);
            }
            toast({ title: "Query Deleted", description: query.name });
            loadSavedQueries();
        } catch (error: any) {
            console.error('Failed to delete query:', error);
            toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
        }
    };

    const saveResultsAsDataset = async () => {
        if (!results || results.nodes.length === 0) return;

        setIsSavingDataset(true);
        try {
            let datasetId = selectedDatasetId;

            if (datasetAction === 'new') {
                if (!newDatasetName.trim()) {
                    toast({ title: "Name Required", variant: "destructive" });
                    setIsSavingDataset(false);
                    return;
                }

                const createResponse = await apiRequest('POST', '/api/fine-tuning/datasets', {
                    name: newDatasetName,
                    description: newDatasetDescription
                });
                const newDataset = await createResponse.json();
                datasetId = newDataset.id;
            }

            if (!datasetId) {
                toast({ title: "Dataset Required", variant: "destructive" });
                setIsSavingDataset(false);
                return;
            }

            const examples = results.nodes.map((node: any) => ({
                input: aiIntent || `Query: ${cypherPreview}`,
                output: JSON.stringify({
                    label: node.label,
                    properties: nodeProperties(node),
                    nodeId: node.id
                })
            }));

            await apiRequest('POST', `/api/fine-tuning/datasets/${datasetId}/examples/import`, { data: examples });

            toast({
                title: "Saved to Dataset",
                description: `Added ${examples.length} examples for training`,
                action: <ToastAction altText="View Dataset" onClick={() => setLocation(`/knowledge/fine-tuning/datasets/${datasetId}`)}>View</ToastAction>
            });

            setShowDatasetDialog(false);
            loadExistingDatasets();
        } catch (error: any) {
            console.error('Failed to save to dataset:', error);
            toast({ title: "Save Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsSavingDataset(false);
        }
    };

    const clearQuery = () => {
        if (confirm('Clear the current query?')) {
            setVisualQuery({
                nodes: [],
                relationships: [],
                returnClause: { items: [] },
                limit: 50
            });
            setResults(null);
            setExecutionError(null);
            setHasExecuted(false);
            setExpandedRows({});
            setActiveTab('cypher');
            setActiveSavedQuery(null);
        }
    };

    const addNode = () => {
        const newNode: VisualQueryNode = {
            id: `n${visualQuery.nodes.length + 1}`,
            label: '*',
            alias: `node${visualQuery.nodes.length + 1}`
        };
        setVisualQuery({
            ...visualQuery,
            nodes: [...visualQuery.nodes, newNode],
            returnClause: {
                items: [...visualQuery.returnClause.items, { type: 'node', id: newNode.id }]
            }
        });
    };

    const removeNode = (nodeId: string) => {
        setVisualQuery({
            ...visualQuery,
            nodes: visualQuery.nodes.filter((n: VisualQueryNode) => n.id !== nodeId),
            relationships: visualQuery.relationships.filter((r: VisualQueryRelationship) => r.sourceNodeId !== nodeId && r.targetNodeId !== nodeId),
            returnClause: {
                items: visualQuery.returnClause.items.filter((item: any) => item.id !== nodeId)
            }
        });
    };

    const updateNodeLabel = (nodeId: string, label: string) => {
        setVisualQuery({
            ...visualQuery,
            nodes: visualQuery.nodes.map((n: VisualQueryNode) => n.id === nodeId ? { ...n, label } : n)
        });
    };

    const addRelationship = () => {
        if (visualQuery.nodes.length < 2) return;

        const newRel: VisualQueryRelationship = {
            id: `r${visualQuery.relationships.length + 1}`,
            sourceNodeId: visualQuery.nodes[0].id,
            targetNodeId: visualQuery.nodes[1].id,
            type: relationshipTypes[0] || '*',
            direction: 'outgoing'
        };

        setVisualQuery({
            ...visualQuery,
            relationships: [...visualQuery.relationships, newRel]
        });
    };

    const removeRelationship = (relId: string) => {
        setVisualQuery({
            ...visualQuery,
            relationships: visualQuery.relationships.filter((r: VisualQueryRelationship) => r.id !== relId)
        });
    };

    const updateRelationship = (relId: string, updates: Partial<VisualQueryRelationship>) => {
        setVisualQuery({
            ...visualQuery,
            relationships: visualQuery.relationships.map((r: VisualQueryRelationship) =>
                r.id === relId ? { ...r, ...updates } as VisualQueryRelationship : r
            )
        });
    };

    return (
        <div className="min-h-screen bg-muted/30 flex flex-col pb-20 sm:pb-0">
            {/* Header */}
            <div className="border-b bg-background px-4 py-4 flex flex-col gap-3 sticky top-0 z-10 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-5">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                        <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-foreground">
                            Visual Query Builder
                        </h1>
                        {activeSavedQuery ? (
                            <p className="text-sm text-muted-foreground font-medium flex flex-wrap items-center gap-2">
                                <span className="truncate">Editing <span className="text-foreground">{activeSavedQuery.name}</span></span>
                                {isDirty && <Badge variant="outline" className="text-xs">Unsaved changes</Badge>}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground font-medium">
                                Build knowledge graph queries visually
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex w-full gap-2 overflow-x-auto pb-1 lg:w-auto lg:flex-wrap lg:items-center lg:overflow-visible lg:pb-0">
                    <Button variant="outline" onClick={() => setShowTemplates(!showTemplates)} className="shrink-0">
                        <Upload className="w-4 h-4 mr-2" />
                        Templates
                    </Button>
                    <Button variant="outline" onClick={() => setShowSavedQueries(!showSavedQueries)} className="shrink-0">
                        <Download className="w-4 h-4 mr-2" />
                        Saved {savedQueries.length > 0 ? `(${savedQueries.length})` : ''}
                    </Button>
                    <Button onClick={openSaveDialog} disabled={visualQuery.nodes.length === 0} variant="outline" className="shrink-0">
                        <Save className="w-4 h-4 mr-2" />
                        {activeSavedQuery && isDirty ? 'Save Changes' : 'Save'}
                    </Button>
                    <Button
                        onClick={executeQuery}
                        disabled={isExecuting || validationErrors.length > 0}
                        className="shrink-0"
                    >
                        <Play className="w-4 h-4 mr-2" />
                        {isExecuting ? 'Executing...' : 'Execute'}
                    </Button>
                    <Button variant="destructive" onClick={clearQuery} className="shrink-0">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear
                    </Button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden lg:flex-row">
                {/* Sidebar - Templates/Saved Queries */}
                {(showTemplates || showSavedQueries) && (
                    <div className="max-h-72 w-full bg-background border-b overflow-y-auto lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
                        {showTemplates && (
                            <div className="p-4">
                                <h3 className="text-lg font-semibold mb-4">Query Templates</h3>
                                <div className="space-y-2">
                                    {templates.map(template => (
                                        <Card key={template.id} onClick={() => { setVisualQuery(template.queryStructure); setShowTemplates(false); }} className="cursor-pointer hover:shadow-md">
                                            <CardHeader className="p-4">
                                                <CardTitle className="text-sm font-medium">{template.name}</CardTitle>
                                                {template.description && <CardDescription className="text-xs">{template.description}</CardDescription>}
                                            </CardHeader>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        )}
                        {showSavedQueries && (
                            <div className="p-4">
                                <h3 className="text-lg font-semibold mb-4">Saved Queries</h3>
                                {savedQueries.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        Nothing saved yet. Build a query and press <span className="font-medium text-foreground">Save</span> to keep it here.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {savedQueries.map(query => (
                                            <Card
                                                key={query.id}
                                                onClick={() => loadSavedQuery(query)}
                                                className={`cursor-pointer hover:shadow-md ${activeSavedQuery?.id === query.id ? 'border-primary' : ''}`}
                                            >
                                                <CardHeader className="p-4 space-y-2">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <CardTitle className="text-sm font-medium break-words">{query.name}</CardTitle>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                                                            onClick={(e) => deleteSavedQuery(query, e)}
                                                            aria-label={`Delete ${query.name}`}
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                    {query.description && (
                                                        <CardDescription className="text-xs">{query.description}</CardDescription>
                                                    )}
                                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                        <span>{query.queryStructure?.nodes?.length || 0} nodes</span>
                                                        <span>·</span>
                                                        <span>{query.queryStructure?.relationships?.length || 0} rels</span>
                                                        {!!query.runCount && (
                                                            <>
                                                                <span>·</span>
                                                                <span>run {query.runCount}×</span>
                                                            </>
                                                        )}
                                                        {query.lastRunAt && (
                                                            <>
                                                                <span>·</span>
                                                                <span>last {new Date(query.lastRunAt).toLocaleDateString()}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </CardHeader>
                                            </Card>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Center Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 px-4 md:px-6 py-8 overflow-auto">
                        <div className="max-w-[1600px] mx-auto space-y-6">
                            {/* AI Assist */}
                            <Card className="border-none shadow-xl bg-primary text-primary-foreground overflow-hidden">
                                <CardHeader>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Sparkles className="w-4 h-4 text-primary-foreground/80" />
                                        <span className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">AI Assistant</span>
                                    </div>
                                    <CardTitle className="text-xl font-bold text-primary-foreground">Describe your query intent</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col gap-3 sm:flex-row">
                                        <Input
                                            value={aiIntent}
                                            onChange={(e) => setAiIntent(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAiGenerate()}
                                            placeholder="e.g., Find all features connected to Infrastructure nodes"
                                            className="bg-background/20 border-background/20 text-primary-foreground placeholder:text-primary-foreground/50 h-12 focus:ring-background/30"
                                        />
                                        <Button variant="secondary" onClick={handleAiGenerate} disabled={isGeneratingAi || !aiIntent.trim()} className="h-12 px-6 sm:w-auto">
                                            {isGeneratingAi ? 'Thinking...' : 'Generate'}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Node Builder */}
                            <Card>
                                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <Network className="w-5 h-5 text-primary" />
                                            Nodes
                                        </CardTitle>
                                    </div>
                                    <Button onClick={addNode} size="sm" className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" />Add Node</Button>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {visualQuery.nodes.map((node: VisualQueryNode, idx: number) => (
                                        <div key={node.id} className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg border sm:flex-row sm:items-center">
                                            <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <div>
                                                    <Label className="text-xs mb-1">Alias</Label>
                                                    <Input
                                                        value={node.alias}
                                                        onChange={(e) => {
                                                            const newNodes = [...visualQuery.nodes];
                                                            newNodes[idx] = { ...node, alias: e.target.value };
                                                            setVisualQuery({ ...visualQuery, nodes: newNodes });
                                                        }}
                                                        className="h-9"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs mb-1">Type</Label>
                                                    <Select value={node.label} onValueChange={(val) => updateNodeLabel(node.id, val)}>
                                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="*">Any Type</SelectItem>
                                                            {nodeTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={() => removeNode(node.id)} className="w-full text-red-500 sm:w-auto"><X className="w-4 h-4" /></Button>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>

                            {/* Relationship Builder */}
                            <Card>
                                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <CardTitle className="flex items-center gap-2"><ArrowRight className="w-5 h-5 text-primary" />Relationships</CardTitle>
                                    <Button onClick={addRelationship} size="sm" disabled={visualQuery.nodes.length < 2} className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" />Add Relationship</Button>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {visualQuery.relationships.map((rel: VisualQueryRelationship) => (
                                        <div key={rel.id} className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg border sm:flex-row sm:items-center">
                                            <div className="flex-1 grid grid-cols-1 gap-3 md:grid-cols-3">
                                                <Select value={rel.sourceNodeId} onValueChange={(val) => updateRelationship(rel.id, { sourceNodeId: val })}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {visualQuery.nodes.map((n: VisualQueryNode) => <SelectItem key={n.id} value={n.id}>{n.alias || n.id}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <Select value={rel.type} onValueChange={(val) => updateRelationship(rel.id, { type: val })}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="*">Any Type</SelectItem>
                                                        {relationshipTypes.map((t: string) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <Select value={rel.targetNodeId} onValueChange={(val) => updateRelationship(rel.id, { targetNodeId: val })}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {visualQuery.nodes.map((n: VisualQueryNode) => <SelectItem key={n.id} value={n.id}>{n.alias || n.id}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={() => removeRelationship(rel.id)} className="w-full text-red-500 sm:w-auto"><X className="w-4 h-4" /></Button>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* Bottom Preview */}
                    <div className="h-[28rem] bg-background border-t flex flex-col sm:h-[32rem]">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full w-full outline-none">
                            <div className="border-b px-3 py-2 bg-muted/30 sm:px-6">
                                <TabsList className="flex h-10 w-full justify-start overflow-x-auto bg-transparent border sm:w-auto">
                                    <TabsTrigger value="cypher" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                                        Cypher Query
                                    </TabsTrigger>
                                    <TabsTrigger value="results" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                                        Results {results?.nodes?.length ? `(${results.nodes.length})` : ''}
                                    </TabsTrigger>
                                    <TabsTrigger value="dataset" disabled={!results?.nodes?.length} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                                        Dataset Preview {results?.nodes?.length ? `(${results.nodes.length})` : ''}
                                    </TabsTrigger>
                                </TabsList>
                            </div>
                            
                            <div className="flex-1 overflow-auto p-3 sm:p-6">
                                <TabsContent value="cypher" className="m-0 h-full">
                                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Code className="w-4 h-4 text-primary" />Cypher Preview</h3>
                                    {validationErrors.length > 0 ? (
                                        <div className="space-y-1">
                                            {validationErrors.map((err, i) => <div key={i} className="text-xs text-red-500">{err}</div>)}
                                        </div>
                                    ) : (
                                        <pre className="text-sm text-foreground bg-muted p-4 rounded-lg font-mono whitespace-pre-wrap overflow-x-auto flex-1">
                                            {cypherPreview || 'Build a query to see the preview'}
                                        </pre>
                                    )}
                                </TabsContent>
                                
                                <TabsContent value="results" className="m-0 h-full">
                                    <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                                        <h3 className="text-sm font-semibold flex items-center gap-2">
                                            <Table2 className="w-4 h-4 text-primary" />
                                            Query Results
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {results && (
                                                <>
                                                    <Badge variant="secondary">{results.nodes.length} nodes</Badge>
                                                    <Badge variant="secondary">{results.edges.length} relationships</Badge>
                                                    {typeof results.executionTimeMs === 'number' && (
                                                        <Badge variant="outline" className="gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {results.executionTimeMs} ms
                                                        </Badge>
                                                    )}
                                                    {results.truncated && (
                                                        <Badge variant="outline">
                                                            limited to {visualQuery.limit}
                                                            {typeof results.totalNodes === 'number' ? ` of ${results.totalNodes}` : ''}
                                                        </Badge>
                                                    )}
                                                </>
                                            )}
                                            {results && results.nodes.length > 0 && (
                                                <Button size="sm" variant="outline" onClick={() => setShowDatasetDialog(true)}>
                                                    <Save className="w-4 h-4 mr-2" />
                                                    Save as Dataset
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {isExecuting ? (
                                        <div className="text-sm text-muted-foreground">Executing query…</div>
                                    ) : executionError ? (
                                        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                            <span className="break-words">{executionError}</span>
                                        </div>
                                    ) : !hasExecuted ? (
                                        <div className="text-sm text-muted-foreground">
                                            Build a query and press <span className="font-medium text-foreground">Execute</span> to see matching nodes and relationships here.
                                        </div>
                                    ) : !results || results.nodes.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">
                                            No nodes matched this query. Try widening the node type to <span className="font-medium text-foreground">Any Type</span>, or removing a relationship constraint.
                                        </div>
                                    ) : (
                                        <div className="space-y-8">
                                            <div className="rounded-lg border overflow-x-auto">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="w-10" />
                                                            <TableHead className="w-24">ID</TableHead>
                                                            <TableHead className="w-44">Type</TableHead>
                                                            <TableHead>Name</TableHead>
                                                            <TableHead className="w-32">Properties</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {results.nodes.map((node: any, idx: number) => {
                                                            const key = `node-${node.id ?? idx}`;
                                                            const props = nodeProperties(node);
                                                            const propCount = Object.keys(props).length;
                                                            const isOpen = !!expandedRows[key];
                                                            return (
                                                                <React.Fragment key={key}>
                                                                    <TableRow
                                                                        className={propCount > 0 ? 'cursor-pointer' : undefined}
                                                                        onClick={() => propCount > 0 && toggleRow(key)}
                                                                    >
                                                                        <TableCell className="text-muted-foreground">
                                                                            {propCount > 0 && (isOpen
                                                                                ? <ChevronDown className="w-4 h-4" />
                                                                                : <ChevronRight className="w-4 h-4" />)}
                                                                        </TableCell>
                                                                        <TableCell className="font-mono text-xs text-muted-foreground">{node.id}</TableCell>
                                                                        <TableCell><Badge variant="outline">{node.label || '—'}</Badge></TableCell>
                                                                        <TableCell className="font-medium break-words">{node.name || '—'}</TableCell>
                                                                        <TableCell className="text-xs text-muted-foreground">
                                                                            {propCount > 0 ? `${propCount} field${propCount === 1 ? '' : 's'}` : '—'}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                    {isOpen && (
                                                                        <TableRow className="hover:bg-transparent">
                                                                            <TableCell colSpan={5} className="bg-muted/30">
                                                                                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                                                                                    {JSON.stringify(props, null, 2)}
                                                                                </pre>
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            {results.edges.length > 0 && (
                                                <div>
                                                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                                        <ArrowRight className="w-4 h-4 text-primary" />
                                                        Relationships
                                                    </h4>
                                                    <div className="rounded-lg border overflow-x-auto">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead>Source</TableHead>
                                                                    <TableHead className="w-52">Relation</TableHead>
                                                                    <TableHead>Target</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {results.edges.map((edge: any, idx: number) => {
                                                                    const findName = (id: any) =>
                                                                        results.nodes.find((n: any) => n.id === id)?.name || `#${id}`;
                                                                    return (
                                                                        <TableRow key={`edge-${edge.id ?? idx}`}>
                                                                            <TableCell className="break-words">{findName(edge.sourceId)}</TableCell>
                                                                            <TableCell><Badge variant="outline">{edge.relation || '—'}</Badge></TableCell>
                                                                            <TableCell className="break-words">{findName(edge.targetId)}</TableCell>
                                                                        </TableRow>
                                                                    );
                                                                })}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="dataset" className="m-0 h-full">
                                    <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                                        <h3 className="text-sm font-semibold flex items-center gap-2"><DatabaseIcon className="w-4 h-4 text-primary" />Dataset Training Examples</h3>
                                        {results?.nodes && results.nodes.length > 0 && (
                                            <Button size="sm" onClick={() => setShowDatasetDialog(true)} className="w-full sm:w-auto">
                                                <Save className="w-4 h-4 mr-2" />
                                                Save as Dataset
                                            </Button>
                                        )}
                                    </div>
                                    <div className="space-y-5">
                                        {results?.nodes?.slice(0, 50).map((node: any, idx: number) => (
                                            <div key={idx} className="bg-muted/10 p-5 rounded-xl border text-sm space-y-4">
                                                <div>
                                                    <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider block mb-2">User Input</span>
                                                    <div className="bg-background border border-muted-foreground/20 px-4 py-3 rounded-lg text-foreground shadow-sm">{aiIntent || `Query: ${cypherPreview}`}</div>
                                                </div>
                                                <div>
                                                    <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider block mb-2">Graph Output (JSON)</span>
                                                    <pre className="bg-card text-slate-50 p-4 rounded-lg overflow-x-auto text-xs font-mono shadow-sm">
                                                        {JSON.stringify({ label: node.label, properties: nodeProperties(node), nodeId: node.id }, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        ))}
                                        {results?.nodes && results.nodes.length > 50 && (
                                            <div className="text-center font-medium padding-4 text-sm text-muted-foreground pt-2">
                                                Showing 50 of {results.nodes.length} examples...
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>
                            </div>
                        </Tabs>
                    </div>
                </div>
            </div>

            {/* Dialogs */}
            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{saveMode === 'update' ? 'Update Saved Query' : 'Save Query'}</DialogTitle>
                        <DialogDescription>
                            Saved queries are stored for your organization and reload straight into the builder.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {activeSavedQuery && (
                            <div className="space-y-2">
                                <Label>Action</Label>
                                <Select value={saveMode} onValueChange={(v: any) => {
                                    setSaveMode(v);
                                    setSaveName(v === 'update' ? (activeSavedQuery.name || '') : '');
                                    setSaveDescription(v === 'update' ? (activeSavedQuery.description || '') : '');
                                }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="update">Update "{activeSavedQuery.name}"</SelectItem>
                                        <SelectItem value="new">Save as a new query</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="saved-query-name">Name</Label>
                            <Input
                                id="saved-query-name"
                                value={saveName}
                                onChange={e => setSaveName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveQuery(); }}
                                placeholder="e.g. Features linked to Infrastructure"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="saved-query-description">Description (optional)</Label>
                            <Textarea
                                id="saved-query-description"
                                value={saveDescription}
                                onChange={e => setSaveDescription(e.target.value)}
                                placeholder="What this query answers"
                                rows={3}
                            />
                        </div>
                        <div className="rounded-lg bg-muted/50 border p-3">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Saving</div>
                            <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                                {cypherPreview || 'Empty query'}
                            </pre>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
                        <Button onClick={saveQuery} disabled={isSavingQuery || !saveName.trim()}>
                            {isSavingQuery ? 'Saving...' : saveMode === 'update' ? 'Update' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showDatasetDialog} onOpenChange={setShowDatasetDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save Results as Dataset</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Action</Label>
                            <Select value={datasetAction} onValueChange={(v: any) => setDatasetAction(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="new">Create New</SelectItem>
                                    <SelectItem value="existing">Add to Existing</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {datasetAction === 'new' ? (
                            <div className="space-y-2">
                                <Label>Dataset Name</Label>
                                <Input value={newDatasetName} onChange={e => setNewDatasetName(e.target.value)} />
                            </div>
                        ) : (
                            <Select value={selectedDatasetId?.toString()} onValueChange={v => setSelectedDatasetId(parseInt(v))}>
                                <SelectTrigger><SelectValue placeholder="Select dataset" /></SelectTrigger>
                                <SelectContent>
                                    {existingDatasets.map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <DialogFooter>
                        <Button onClick={saveResultsAsDataset} disabled={isSavingDataset}>
                            {isSavingDataset ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

