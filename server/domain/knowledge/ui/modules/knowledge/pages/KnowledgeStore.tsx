import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { KnowledgeDocument, KnowledgeTopic } from "@shared/schema/knowledge-base";
import { KnowledgeExtractionProgress } from '@domain-ui/knowledge/ui/components/knowledge/KnowledgeExtractionProgress';
import { KnowledgeBatchList } from '@domain-ui/knowledge/ui/components/knowledge/KnowledgeBatchList';
import { FileDropzone } from '@domain-ui/core/ui/components/ui/file-dropzone.tsx';
import { Network, FileText, Upload, Link as LinkIcon, Filter, Sparkles, Trash2, Wand2, Download, Presentation, Bell, BellRing, Hash } from 'lucide-react';
import { KnowledgeTopicGraph } from '@domain-ui/knowledge/ui/components/knowledge/graph/KnowledgeTopicGraph';

type TopicWithCount = KnowledgeTopic & { documentCount?: number };
type DocumentWithTopics = KnowledgeDocument & {
  topics?: Array<{ id: number; name: string }>;
  extractionStatus?: string | null;
  extractionProgress?: number | null;
};

const FILE_LIMIT = 10 * 1024 * 1024;

const topicQueryKey = ['/api/knowledge/topics'] as const;
const documentQueryKey = ['/api/knowledge/documents'] as const;
const subscriptionQueryKey = ['/api/knowledge/topics/subscriptions/mine'] as const;
const activityQueryKey = ['/api/knowledge/topics/subscriptions/activity'] as const;

interface TopicSubscriptionRow {
  subscriptionId: number;
  topicId: number;
  name: string;
  projectId: number | null;
  subscribedAt: string;
}

interface TopicActivityRow {
  topicId: number;
  topicName: string;
  label: string;
  turnTopicId: number;
  turnId: number;
  sessionId: number;
  sessionKey: string;
  source: string;
  speakerName: string;
  createdAt: string;
}

const defaultDocForm = {
  title: '',
  summary: '',
  sourceType: 'upload' as 'text' | 'upload' | 'link',
  textContent: '',
  url: '',
};

export default function KnowledgeStorePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [topicForm, setTopicForm] = useState({ name: '', description: '', parentTopicId: '' });
  const [docForm, setDocForm] = useState(defaultDocForm);
  const [docTopicSelections, setDocTopicSelections] = useState<string[]>([]);
  const [docFileState, setDocFileState] = useState<{ fileData?: string; contentType?: string; fileSize?: number; fileName?: string }>({});
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const linkedDocumentId = Number(new URLSearchParams(window.location.search).get('documentId')) || null;

  const { data: topicsData, isLoading: topicsLoading } = useQuery<{ topics: TopicWithCount[] }>({
    queryKey: topicQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/topics');
      return res.json();
    },
  });

  const { data: documentsData, isLoading: documentsLoading } = useQuery<{ documents: DocumentWithTopics[] }>({
    queryKey: documentQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/documents');
      return res.json();
    },
  });

  const { data: subscriptionsData } = useQuery<{ subscriptions: TopicSubscriptionRow[] }>({
    queryKey: subscriptionQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/topics/subscriptions/mine');
      return res.json();
    },
  });

  const { data: activityData, isLoading: activityLoading } = useQuery<{ activity: TopicActivityRow[] }>({
    queryKey: activityQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/topics/subscriptions/activity');
      return res.json();
    },
  });

  const followedTopicIds = new Set((subscriptionsData?.subscriptions ?? []).map((s) => s.topicId));

  const followTopicMutation = useMutation({
    mutationFn: async ({ topicId, follow }: { topicId: number; follow: boolean }) => {
      if (follow) {
        await apiRequest('POST', `/api/knowledge/topics/${topicId}/subscribe`);
      } else {
        await apiRequest('DELETE', `/api/knowledge/topics/${topicId}/subscribe`);
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKey });
      queryClient.invalidateQueries({ queryKey: activityQueryKey });
      toast({ title: vars.follow ? 'Following topic' : 'Unfollowed topic' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update follow', description: error.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (documentsLoading || linkedDocumentId === null) return;
    document.getElementById(`knowledge-document-${linkedDocumentId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [documentsLoading, linkedDocumentId]);

  const createTopicMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: topicForm.name.trim(),
        description: topicForm.description.trim() || undefined,
        parentTopicId: topicForm.parentTopicId ? Number(topicForm.parentTopicId) : undefined,
      };
      const res = await apiRequest('POST', '/api/knowledge/topics', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: topicQueryKey });
      setTopicForm({ name: '', description: '', parentTopicId: '' });
      toast({ title: 'Topic created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create topic', description: error.message, variant: 'destructive' });
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: async (topicId: number) => {
      await apiRequest('DELETE', `/api/knowledge/topics/${topicId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: topicQueryKey });
      toast({ title: 'Topic removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete topic', description: error.message, variant: 'destructive' });
    },
  });

  const createDocumentMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: docForm.title.trim(),
        summary: docForm.summary.trim() || undefined,
        sourceType: docForm.sourceType,
        topicIds: docTopicSelections.map((id) => Number(id)),
      };

      if (docForm.sourceType === 'text') {
        payload.textContent = docForm.textContent;
      } else if (docForm.sourceType === 'link') {
        payload.url = docForm.url.trim();
      } else if (docForm.sourceType === 'upload') {
        payload.fileData = docFileState.fileData;
        payload.fileSize = docFileState.fileSize;
        payload.contentType = docFileState.contentType;
      }

      const res = await apiRequest('POST', '/api/knowledge/documents', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentQueryKey });
      setDocForm(defaultDocForm);
      setDocTopicSelections([]);
      setDocFileState({});
      toast({ title: 'Document created', description: 'The document has been added successfully.' });
    },
    onError: (error: Error) => {
      let errorMessage = error.message || 'Failed to create document';

      // Parse error message format: "STATUS_CODE: MESSAGE"
      if (errorMessage.includes(':')) {
        const parts = errorMessage.split(':');
        if (parts.length > 1) {
          errorMessage = parts.slice(1).join(':').trim();
        }
      }

      toast({
        title: 'Failed to create document',
        description: errorMessage,
        variant: 'destructive',
        duration: 5000,
      });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest('DELETE', `/api/knowledge/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentQueryKey });
      toast({ title: 'Document removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete document', description: error.message, variant: 'destructive' });
    },
  });

  const handleDocTopicToggle = (topicId: string, checked: boolean) => {
    setDocTopicSelections((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, topicId]));
      }
      return prev.filter((id) => id !== topicId);
    });
  };

  const handleDocFileSelect = async (file: File) => {
    if (file.size > FILE_LIMIT) {
      toast({
        title: 'File too large',
        description: 'Maximum file size is 10MB.',
        variant: 'destructive',
      });
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    setDocFileState({
      fileData: dataUrl,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
    });

    setDocForm((prev) => {
      if (!prev.title.trim()) {
        const titleWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        return { ...prev, title: titleWithoutExt };
      }
      return prev;
    });
  };

  const { data: schemas = [] } = useQuery<any[]>({
    queryKey: ['/api/knowledge/schema'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/schema');
      return res.json();
    }
  });

  // Batch Extraction State
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({ name: '', schemaId: '' });

  const createBatchMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: batchForm.name || `Batch Extraction ${new Date().toLocaleDateString()}`,
        schemaId: parseInt(batchForm.schemaId) || 0,
        documentIds: selectedDocIds,
        priority: 0
      };

      const res = await apiRequest('POST', '/api/knowledge-extraction/batch', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge-extraction/batch'] });
      setIsBatchDialogOpen(false);
      setSelectedDocIds([]);
      setBatchForm({ name: '', schemaId: '' });
      toast({ title: 'Batch extraction started', description: 'Switch to the Extractions tab to view progress.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to start batch', description: error.message, variant: 'destructive' });
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (docIds: number[]) => {
      await Promise.all(docIds.map(id => apiRequest('DELETE', `/api/knowledge/documents/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentQueryKey });
      setSelectedDocIds([]);
      toast({ title: 'Documents deleted', description: `${selectedDocIds.length} document(s) removed.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete documents', description: error.message, variant: 'destructive' });
    }
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/knowledge/documents/import/okf', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        let msg = 'Import failed';
        try {
          const err = await res.json();
          msg = err.message || err.error?.message || msg;
        } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: documentQueryKey });
      toast({ title: 'Import successful', description: `Imported ${data.count} documents.` });
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
    }
  });

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      importMutation.mutate(e.target.files[0]);
    }
  };

  const handleExport = () => {
    window.location.href = '/api/knowledge/documents/export/okf';
  };

  const discoverTopicsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/knowledge/topics/discover', {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: topicQueryKey });
      toast({
        title: 'Topics discovered',
        description: `Successfully identified ${data.discovered} topics (${data.created} new). Documents are being auto-tagged in the background.`
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Discovery failed', description: error.message, variant: 'destructive' });
    }
  });

  const handleDocSelection = (docId: number, checked: boolean) => {
    setSelectedDocIds(prev => checked ? [...prev, docId] : prev.filter(id => id !== docId));
  };

  const topicOptions = topicsData?.topics ?? [];
  const allDocuments = documentsData?.documents ?? [];
  const documentRows = allDocuments.filter(doc =>
    sourceFilter === 'all' || doc.sourceType === sourceFilter
  );

  const handleSelectAllDocs = (checked: boolean) => {
    if (checked) {
      setSelectedDocIds(documentRows.map(d => d.id));
    } else {
      setSelectedDocIds([]);
    }
  };

  const handleSelectNonExtracted = () => {
    const nonExtractedIds = documentRows
      .filter(doc => !doc.extractionStatus || doc.extractionStatus === 'failed')
      .map(doc => doc.id);
    setSelectedDocIds(nonExtractedIds);
    if (nonExtractedIds.length === 0) {
      toast({ title: 'No documents to select', description: 'All filtered documents are either queued, processing, or already extracted.' });
    } else {
      toast({ title: 'Selected non-extracted', description: `${nonExtractedIds.length} document(s) selected.` });
    }
  };

  return (
    <div className="space-y-6 pb-24 sm:space-y-8 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Knowledge Store</h1>
          <p className="text-sm text-muted-foreground">
            Organize reusable knowledge topics and documents for RAG-enabled jobs.
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap">
          <input
            type="file"
            ref={importFileInputRef}
            className="hidden"
            accept=".zip"
            onChange={handleImportChange}
          />
          <Button
            variant="outline"
            className="flex-1 gap-2 sm:flex-none"
            onClick={() => importFileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{importMutation.isPending ? 'Importing...' : 'Import OKF'}</span>
            <span className="sm:hidden">{importMutation.isPending ? 'Importing...' : 'Import'}</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2 sm:flex-none"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export OKF</span>
            <span className="sm:hidden">Export</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2 sm:flex-none"
            onClick={() => window.dispatchEvent(new CustomEvent('agent-assist-request'))}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Ask AI</span>
            <span className="sm:hidden">AI</span>
          </Button>
        </div>
      </div>

      <Dialog open={isBatchDialogOpen} onOpenChange={setIsBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Batch Extraction</DialogTitle>
            <DialogDescription>
              Extract knowledge from {selectedDocIds.length} selected documents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Batch Name</Label>
              <Input
                placeholder={`Batch ${new Date().toLocaleDateString()}`}
                value={batchForm.name}
                onChange={e => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Extraction Schema</Label>
              <Select
                value={batchForm.schemaId}
                onValueChange={val => setBatchForm(prev => ({ ...prev, schemaId: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Schema" />
                </SelectTrigger>
                <SelectContent position="popper" className="z-popover">
                  {schemas.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBatchDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createBatchMutation.mutate()}
              disabled={createBatchMutation.isPending || !batchForm.schemaId}
            >
              {createBatchMutation.isPending ? 'Starting...' : 'Start Extraction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Create Topic</CardTitle>
            <CardDescription>Group related documents into reusable topics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={topicForm.name}
                onChange={(e) => setTopicForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Example: Onboarding Guides"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={topicForm.description}
                onChange={(e) => setTopicForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional summary of what fits in this topic."
              />
            </div>
            <div className="space-y-2">
              <Label>Parent Topic</Label>
              <Select
                value={topicForm.parentTopicId || "none"}
                onValueChange={(value) => setTopicForm((prev) => ({ ...prev, parentTopicId: value === "none" ? "" : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {topicOptions.map((topic) => (
                    <SelectItem key={topic.id} value={String(topic.id)}>
                      {topic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => {
                if (!topicForm.name.trim()) {
                  toast({ title: 'Topic name required', variant: 'destructive' });
                  return;
                }
                createTopicMutation.mutate();
              }}
              disabled={createTopicMutation.isPending}
            >
              {createTopicMutation.isPending ? 'Creating…' : 'Create Topic'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Document</CardTitle>
            <CardDescription>Upload or link new resources for reuse.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={docForm.title}
                onChange={(e) => setDocForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Policy Handbook"
              />
            </div>
            <div className="space-y-2">
              <Label>Summary</Label>
              <Textarea
                rows={3}
                value={docForm.summary}
                onChange={(e) => setDocForm((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="Brief description for other teammates."
              />
            </div>
            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select
                value={docForm.sourceType}
                onValueChange={(value) => setDocForm((prev) => ({ ...prev, sourceType: value as 'text' | 'upload' | 'link' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text Snippet</SelectItem>
                  <SelectItem value="upload">Upload File</SelectItem>
                  <SelectItem value="link">External Link</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {docForm.sourceType === 'text' && (
              <div className="space-y-2">
                <Label>Text Content</Label>
                <Textarea
                  rows={6}
                  value={docForm.textContent}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, textContent: e.target.value }))}
                  placeholder="Paste the text you want available for retrieval."
                />
              </div>
            )}

            {docForm.sourceType === 'link' && (
              <div className="space-y-2">
                <Label>Source URL</Label>
                <Input
                  value={docForm.url}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com/resource"
                />
              </div>
            )}

            {docForm.sourceType === 'upload' && (
              <div className="space-y-2">
                <Label>Upload File</Label>
                <FileDropzone
                  onFileSelect={handleDocFileSelect}
                  maxSize={FILE_LIMIT}
                  accept=".pdf,.txt,.csv,.md,.json"
                  label={docFileState.fileName || "Click or drag file here to upload"}
                  description="PDF, TXT, CSV, MD, JSON supported (Max 10MB)"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Assign Topics</Label>
              <div className="grid gap-2 max-h-32 overflow-y-auto border rounded p-3">
                {topicOptions.length === 0 && <p className="text-xs text-muted-foreground">No topics yet.</p>}
                {topicOptions.map((topic) => (
                  <label key={topic.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={docTopicSelections.includes(String(topic.id))}
                      onCheckedChange={(checked) => handleDocTopicToggle(String(topic.id), Boolean(checked))}
                    />
                    <span>{topic.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!docForm.title.trim()) {
                  toast({ title: 'Document title required', variant: 'destructive' });
                  return;
                }
                if (docForm.sourceType === 'text') {
                  if (!docForm.textContent || !docForm.textContent.trim()) {
                    toast({ title: 'Text content required for text documents', variant: 'destructive' });
                    return;
                  }
                } else if (docForm.sourceType === 'link') {
                  if (!docForm.url || !docForm.url.trim()) {
                    toast({ title: 'URL required for link documents', variant: 'destructive' });
                    return;
                  }
                } else if (docForm.sourceType === 'upload') {
                  if (!docFileState.fileData) {
                    toast({ title: 'Select a file to upload', variant: 'destructive' });
                    return;
                  }
                }
                createDocumentMutation.mutate();
              }}
              disabled={createDocumentMutation.isPending}
            >
              {createDocumentMutation.isPending ? 'Saving…' : 'Save Document'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="library" className="w-full">
        <TabsList className="flex h-11 w-full justify-start overflow-x-auto rounded-lg p-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="following" className="gap-2">
            <BellRing className="h-4 w-4" />
            Following{followedTopicIds.size > 0 ? ` (${followedTopicIds.size})` : ''}
          </TabsTrigger>
          <TabsTrigger value="extractions">Batch Extractions</TabsTrigger>
          <TabsTrigger value="visualizer" className="gap-2">
            <Presentation className="h-4 w-4" />
            Visual Explorer
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
            <div className="w-full shrink-0 lg:w-64">
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Topics</CardTitle>
                    <CardDescription className="text-xs">Filter by topic</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Discover topics from document content"
                    className="h-8 w-8 text-indigo-600"
                    onClick={() => discoverTopicsMutation.mutate()}
                    disabled={discoverTopicsMutation.isPending}
                  >
                    {discoverTopicsMutation.isPending ? "..." : <Wand2 className="h-4 w-4" />}
                  </Button>
                </CardHeader>
                <CardContent className="max-h-56 space-y-1 overflow-y-auto lg:max-h-[400px]">
                  {topicsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : topicOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No topics yet.</p>
                  ) : (
                    topicOptions.map((topic) => (
                      <div
                        key={topic.id}
                        className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/50 group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                          <span className="text-sm truncate">{topic.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            ({topic.documentCount ?? 0})
                          </span>
                        </div>
                        <div className="flex items-center shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                            title={followedTopicIds.has(topic.id) ? 'Unfollow topic' : 'Follow topic — see new #[tag] activity'}
                            onClick={() => followTopicMutation.mutate({ topicId: topic.id, follow: !followedTopicIds.has(topic.id) })}
                            disabled={followTopicMutation.isPending}
                            data-testid={`topic-follow-${topic.id}`}
                          >
                            {followedTopicIds.has(topic.id)
                              ? <BellRing className="h-3.5 w-3.5 text-indigo-600" />
                              : <Bell className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                            onClick={() => deleteTopicMutation.mutate(topic.id)}
                            disabled={deleteTopicMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 min-w-0">
              <Card>
                <CardHeader className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Documents</CardTitle>
                    <CardDescription>{documentRows.length} document{documentRows.length !== 1 ? 's' : ''}</CardDescription>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
                    <Select value={sourceFilter} onValueChange={setSourceFilter}>
                      <SelectTrigger className="h-8 min-w-32 flex-1 text-xs sm:flex-none">
                        <Filter className="w-3 h-3 mr-2" />
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-popover">
                        <SelectItem value="all">All Sources</SelectItem>
                        <SelectItem value="upload">Uploads</SelectItem>
                        <SelectItem value="text">Text Snippets</SelectItem>
                        <SelectItem value="link">Links</SelectItem>
                        <SelectItem value="integration">Integrations</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button size="sm" variant="outline" onClick={handleSelectNonExtracted} className="h-8 flex-1 text-xs sm:flex-none">
                      {selectedDocIds.length > 0 ? "Reset Selection" : "Select Non-Extracted"}
                    </Button>

                    {selectedDocIds.length > 0 && (
                      <div className="flex w-full gap-2 sm:w-auto">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => bulkDeleteMutation.mutate(selectedDocIds)}
                          disabled={bulkDeleteMutation.isPending}
                          className="h-8 flex-1 text-xs sm:flex-none"
                        >
                          {bulkDeleteMutation.isPending ? 'Deleting...' : `Delete (${selectedDocIds.length})`}
                        </Button>
                        <Button size="sm" variant="default" onClick={() => setIsBatchDialogOpen(true)} className="h-8 flex-1 text-xs sm:flex-none">
                          Extract ({selectedDocIds.length})
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {documentsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading documents…</p>
                  ) : documentRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No documents added yet.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="hidden items-center gap-2 px-3 py-2 bg-muted/30 rounded-md text-xs font-medium text-muted-foreground md:flex">
                        <Checkbox
                          checked={selectedDocIds.length === documentRows.length && documentRows.length > 0}
                          onCheckedChange={(c) => handleSelectAllDocs(Boolean(c))}
                        />
                        <span className="flex-1">Title</span>
                        <span className="w-16 text-center">Type</span>
                        <span className="w-24 text-center">Topics</span>
                        <span className="w-36 text-right">Actions</span>
                      </div>
                      {documentRows.map((doc) => (
                        <div
                          key={doc.id}
                          id={`knowledge-document-${doc.id}`}
                          className={`flex flex-col gap-3 rounded-md border px-3 py-3 transition-colors hover:bg-muted/20 md:flex-row md:items-center md:gap-2 md:py-2 ${linkedDocumentId === doc.id ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : ''}`}
                        >
                          <div className="flex items-start gap-3 md:contents">
                            <Checkbox
                              checked={selectedDocIds.includes(doc.id)}
                              onCheckedChange={(c) => handleDocSelection(doc.id, Boolean(c))}
                              className="mt-1 md:mt-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{doc.title}</p>
                              {doc.summary && (
                                <p className="text-xs text-muted-foreground line-clamp-2 md:truncate">{doc.summary}</p>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant={doc.sourceType === 'integration' ? 'secondary' : 'outline'}
                            className="w-fit justify-center gap-1 text-xs md:w-24"
                          >
                            {doc.sourceType === 'integration' ? (
                              <>
                                <Network className="w-3 h-3 text-indigo-500" />
                                <span className="text-indigo-700">INTEGRATION</span>
                              </>
                            ) : (
                              doc.sourceType?.toUpperCase() || 'TEXT'
                            )}
                          </Badge>
                          <div className="flex flex-wrap gap-1 md:w-24 md:justify-center">
                            {doc.topics?.slice(0, 2).map((topic) => (
                              <Badge key={topic.id} variant="secondary" className="text-xs px-1">
                                {topic.name}
                              </Badge>
                            ))}
                            {(doc.topics?.length ?? 0) > 2 && (
                              <span className="text-xs text-muted-foreground">+{(doc.topics?.length ?? 0) - 2}</span>
                            )}
                          </div>
                          <div className="flex justify-end gap-1 border-t pt-2 md:w-36 md:border-t-0 md:pt-0">
                            <KnowledgeExtractionProgress 
                              documentId={doc.id} 
                              compact 
                              initialStatus={doc.extractionStatus}
                              initialProgress={doc.extractionProgress}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                              title="View in Knowledge Explorer"
                              onClick={() => {
                                setLocation(`/knowledge/graph?documentId=${doc.id}`);
                              }}
                            >
                              <Network className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => deleteDocumentMutation.mutate(doc.id)}
                              disabled={deleteDocumentMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="following">
          <Card>
            <CardHeader>
              <CardTitle>Followed Topic Activity</CardTitle>
              <CardDescription>
                New #[tag] declarations on topics you follow, across the organization's rooms.
                Follow a topic from the Library tab to start tracking it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {followedTopicIds.size === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You aren't following any topics yet — click the bell on a topic in the Library tab.
                </p>
              ) : activityLoading ? (
                <p className="text-sm text-muted-foreground">Loading activity…</p>
              ) : (activityData?.activity ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tagged activity yet on your followed topics.</p>
              ) : (
                <div className="divide-y">
                  {(activityData?.activity ?? []).map((item) => (
                    <div key={item.turnTopicId} className="flex items-center justify-between gap-3 py-2.5" data-testid={`topic-activity-${item.turnTopicId}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Hash className="h-4 w-4 shrink-0 text-indigo-500" />
                        <div className="min-w-0">
                          <p className="text-sm truncate">
                            <span className="font-medium">{item.speakerName}</span>
                            <span className="text-muted-foreground"> tagged </span>
                            <span className="font-medium">#{item.topicName}</span>
                            {item.label !== item.topicName && (
                              <span className="text-muted-foreground"> ({item.label})</span>
                            )}
                            <span className="text-muted-foreground"> in a {item.source} turn</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setLocation(`/workspace/chat/${item.sessionKey}`)}
                      >
                        Open room
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="extractions">
          <Card>
            <CardHeader>
              <CardTitle>Batch Extractions</CardTitle>
              <CardDescription>View and manage bulk extraction jobs.</CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeBatchList />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="visualizer" className="h-[800px]">
          <Card className="h-full flex flex-col">
            <CardHeader className="flex-none">
              <CardTitle>Visual Explorer</CardTitle>
              <CardDescription>Explore your topics and documents as a visual graph.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <KnowledgeTopicGraph />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

