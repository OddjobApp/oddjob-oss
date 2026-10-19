import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { GripVertical, Plus, X, Loader2, ShieldCheck, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { KnowledgeDocument, KnowledgeTopic } from "@shared/schema/knowledge-base";
import type { RagAsset } from "@shared/schema/knowledge/assets";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@domain-ui/core/ui/components/ui/tooltip';

type RagAssetWithMetadata = RagAsset & { documentMetadata?: Record<string, any> };

interface RagAssetManagerProps {
  jobId: number;
  organizationId?: number | null;
}

type AssetType = RagAsset['assetType'];
type SourceType = RagAsset['sourceType'];
type AttachmentMode = 'custom' | 'topic' | 'document';

interface FormState {
  name: string;
  assetType: AssetType;
  sourceType: SourceType;
  url: string;
  textContent: string;
  fileData?: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
}

const MAX_ASSETS = 3;
const FILE_LIMIT = 10 * 1024 * 1024;

const defaultForm: FormState = {
  name: '',
  assetType: 'PDF',
  sourceType: 'upload',
  url: '',
  textContent: '',
};

const assetQueryKey = (jobId: number) => [`/api/rag-assets?jobId=${jobId}`] as const;

export default function RagAssetManager({ jobId, organizationId }: RagAssetManagerProps) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<FormState>(defaultForm);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachmentMode, setAttachmentMode] = useState<AttachmentMode>('custom');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // Debug: Log when component receives jobId
  console.log('RagAssetManager rendered with jobId:', jobId, 'organizationId:', organizationId);

  const { data: response, isLoading } = useQuery<{ assets: RagAssetWithMetadata[] }>({
    queryKey: assetQueryKey(jobId),
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/rag-assets?jobId=${jobId}`);
      return res.json();
    },
  });

  const assets = response?.assets || [];

  const { data: topicsResponse } = useQuery<{ topics: Array<KnowledgeTopic & { documentCount?: number }> }>({
    queryKey: ['/api/knowledge/topics'],
    enabled: showForm,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/topics');
      return res.json();
    },
  });

  const { data: documentsResponse } = useQuery<{ documents: Array<KnowledgeDocument & { topics?: Array<{ id: number; name: string }> }> }>({
    queryKey: ['/api/knowledge/documents'],
    enabled: showForm,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/documents');
      return res.json();
    },
  });

  const knowledgeTopicsList = topicsResponse?.topics ?? [];
  const knowledgeDocumentsList = documentsResponse?.documents ?? [];

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      console.log('Creating RAG asset with payload:', { jobId, body });

      const res = await apiRequest('POST', '/api/rag-assets', {
        jobId,
        organizationId: organizationId ?? undefined,
        ...body,
      });
      const data = await res.json();
      console.log('RAG asset created successfully:', data);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assetQueryKey(jobId) });
      setFormState(defaultForm);
      setShowForm(false);
      setIsSubmitting(false);
      setAttachmentMode('custom');
      setSelectedTopicId(null);
      setSelectedDocumentId(null);
      toast({
        title: 'Success',
        description: 'RAG asset added successfully',
      });
    },
    onError: (error: Error) => {
      console.error('Error adding RAG asset:', error);
      setIsSubmitting(false);
      // Try to parse error message from response
      let errorMessage = error.message;
      try {
        if (error.message.includes(':')) {
          const parts = error.message.split(':');
          if (parts.length > 1) {
            const jsonPart = parts.slice(1).join(':').trim();
            const errorData = JSON.parse(jsonPart);
            errorMessage = errorData.message || errorMessage;
          }
        }
      } catch (e) {
        // Use original error message if parsing fails
      }

      // Handle specific error codes
      if (errorMessage.includes('413') || errorMessage.includes('Payload Too Large')) {
        errorMessage = 'File is too large. Maximum size is 10MB.';
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage = 'Authentication required. Please log in again.';
      }

      toast({
        title: 'Failed to add asset',
        description: errorMessage || 'An error occurred while adding the asset',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetId: number) => {
      await apiRequest('DELETE', `/api/rag-assets/${assetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assetQueryKey(jobId) });
      toast({ title: 'Asset removed' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to remove asset',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (assetIds: number[]) => {
      await apiRequest('POST', '/api/rag-assets/reorder', { assetIds });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: assetQueryKey(jobId) });
      toast({
        title: 'Failed to reorder assets',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async ({ documentId, verified }: { documentId: number, verified: boolean }) => {
      await apiRequest('PUT', `/api/knowledge/documents/${documentId}`, {
        metadata: {
          verificationStatus: verified ? 'verified' : 'unverified'
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assetQueryKey(jobId) });
      toast({ title: 'Document verification status updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const handleFileSelect = async (file: File) => {
    if (file.size > FILE_LIMIT) {
      toast({
        title: 'File too large',
        description: 'Maximum file size is 10MB',
        variant: 'destructive',
      });
      return;
    }

    console.log('File selected:', { name: file.name, size: file.size, type: file.type });

    try {
      // Read file as base64 data URL directly
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          console.log('File read successfully, data URL length:', result.length);
          resolve(result);
        };
        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          reject(error);
        };
        reader.readAsDataURL(file);
      });

      // Extract base64 data (remove data:type;base64, prefix if present)
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      console.log('Setting file data in form state');
      setFormState((prev) => ({
        ...prev,
        fileData: base64Data, // Store just the base64 data
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
        fileName: file.name,
      }));

      toast({
        title: 'File ready',
        description: `${file.name} is ready to upload`,
      });
    } catch (error) {
      console.error('Error reading file:', error);
      toast({
        title: 'File read failed',
        description: error instanceof Error ? error.message : 'Unable to read file',
        variant: 'destructive',
      });
    }
  };

  const handleReorder = (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const currentAssets = [...assets];
    const fromIndex = currentAssets.findIndex((a) => a.id === fromId);
    const toIndex = currentAssets.findIndex((a) => a.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const updated = [...currentAssets];
    const [removed] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, removed);

    queryClient.setQueryData(assetQueryKey(jobId), updated);
    reorderMutation.mutate(updated.map((asset) => asset.id));
  };

  const canAddMore = assets.length < MAX_ASSETS;

  const metadataFor = (asset: RagAsset) => {
    if (asset.selectionType === 'topic') {
      return 'Knowledge Topic';
    }
    if (asset.selectionType === 'document') {
      return 'Knowledge Document';
    }
    if (asset.assetType === 'Text' && asset.textContent) {
      return `${asset.assetType} • ${asset.textContent.length} chars`;
    }
    if (asset.sourceType === 'link' && asset.url) {
      return `${asset.assetType} • Link`;
    }
    if (asset.fileSize) {
      return `${asset.assetType} • ${(asset.fileSize / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${asset.assetType}`;
  };

  const isSubmittingForm = isSubmitting || createMutation.isPending;

  const contextHelp = useMemo(() => {
    if (!canAddMore) {
      return 'Maximum of 3 assets reached';
    }
    return 'Attach up to 3 resources (custom uploads, knowledge documents, or topics)';
  }, [canAddMore]);

  const handleAttachmentModeChange = (mode: AttachmentMode) => {
    setAttachmentMode(mode);
    setSelectedTopicId(null);
    setSelectedDocumentId(null);
    if (mode === 'custom') {
      setFormState(defaultForm);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();

    console.log('handleSubmit called', { attachmentMode, jobId });

    if (isSubmitting || createMutation.isPending) {
      console.log('Form submission already in progress, ignoring duplicate submit');
      return;
    }

    if (!jobId || jobId <= 0) {
      toast({
        title: 'Validation error',
        description: 'Invalid job ID. Please save the job first.',
        variant: 'destructive',
      });
      return;
    }

    if (attachmentMode === 'topic') {
      if (!selectedTopicId) {
        toast({
          title: 'Validation error',
          description: 'Please choose a knowledge topic to attach.',
          variant: 'destructive',
        });
        return;
      }
      const topicIdNum = parseInt(selectedTopicId, 10);
      if (Number.isNaN(topicIdNum)) {
        toast({
          title: 'Validation error',
          description: 'Invalid topic selected.',
          variant: 'destructive',
        });
        return;
      }
      setIsSubmitting(true);
      createMutation.mutate(
        {
          selectionType: 'topic',
          knowledgeTopicId: topicIdNum,
        },
        {
          onSettled: () => setIsSubmitting(false),
        }
      );
      return;
    }

    if (attachmentMode === 'document') {
      if (!selectedDocumentId) {
        toast({
          title: 'Validation error',
          description: 'Please choose a knowledge document to attach.',
          variant: 'destructive',
        });
        return;
      }
      const documentIdNum = parseInt(selectedDocumentId, 10);
      if (Number.isNaN(documentIdNum)) {
        toast({
          title: 'Validation error',
          description: 'Invalid document selected.',
          variant: 'destructive',
        });
        return;
      }
      setIsSubmitting(true);
      createMutation.mutate(
        {
          selectionType: 'document',
          knowledgeDocumentId: documentIdNum,
        },
        {
          onSettled: () => setIsSubmitting(false),
        }
      );
      return;
    }

    if (!formState.name.trim()) {
      toast({
        title: 'Validation error',
        description: 'Asset name is required',
        variant: 'destructive',
      });
      return;
    }

    if (formState.assetType === 'Text') {
      if (!formState.textContent.trim()) {
        toast({
          title: 'Validation error',
          description: 'Text content is required for Text assets',
          variant: 'destructive',
        });
        return;
      }
    } else if (formState.sourceType === 'upload') {
      if (!formState.fileData) {
        toast({
          title: 'Validation error',
          description: 'Please select a file to upload',
          variant: 'destructive',
        });
        return;
      }
    } else if (formState.sourceType === 'link') {
      if (!formState.url.trim()) {
        toast({
          title: 'Validation error',
          description: 'URL is required for link assets',
          variant: 'destructive',
        });
        return;
      }
    }

    setIsSubmitting(true);
    const payload: Record<string, unknown> = {
      selectionType: 'custom',
      name: formState.name.trim(),
      assetType: formState.assetType,
      sourceType: formState.sourceType,
      textContent: formState.textContent,
      fileData: formState.fileData,
      contentType: formState.contentType,
      fileSize: formState.fileSize,
    };

    if (formState.sourceType === 'link') {
      payload.url = formState.url.trim();
    }

    createMutation.mutate(payload, {
      onSettled: () => {
        setIsSubmitting(false);
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>RAG Assets ({assets.length}/{MAX_ASSETS})</CardTitle>
            <CardDescription>{contextHelp}</CardDescription>
          </div>
          {canAddMore && (
            <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="w-4 h-4 mr-2" />
              {showForm ? 'Cancel' : 'Add Asset'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Loading RAG assets…</p>
          </div>
        ) : assets.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
            No RAG assets attached yet.
          </div>
        ) : (
          <div className="space-y-3">
            {assets.map((asset) => (
              <div
                key={asset.id}
                draggable
                onDragStart={() => setDraggedId(asset.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedId !== null) {
                    handleReorder(draggedId, asset.id);
                  }
                  setDraggedId(null);
                }}
                onDragEnd={() => setDraggedId(null)}
                className="flex items-center gap-3 rounded border p-3 bg-card"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{asset.name}</p>
                    {asset.selectionType !== 'custom' && (
                      <Badge variant="outline" className="text-xs">
                        {asset.selectionType === 'topic' ? 'Topic' : 'Document'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{metadataFor(asset)}</p>
                </div>
                {asset.selectionType === 'document' && asset.knowledgeDocumentId && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const isVerified = asset.documentMetadata?.verificationStatus === 'verified';
                            verificationMutation.mutate({
                              documentId: asset.knowledgeDocumentId!,
                              verified: !isVerified
                            });
                          }}
                          disabled={verificationMutation.isPending}
                        >
                          {asset.documentMetadata?.verificationStatus === 'verified' ? (
                            <ShieldCheck className="w-4 h-4 text-green-600" />
                          ) : (
                            <Shield className="w-4 h-4 text-muted-foreground opacity-50" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{asset.documentMetadata?.verificationStatus === 'verified' ? 'Verified Document (Boosted)' : 'Unverified Document'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(asset.id)}
                  disabled={deleteMutation.isPending}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {showForm && canAddMore && (
          <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4" noValidate>
            <div className="space-y-2">
              <Label>Attachment Source</Label>
              <Select value={attachmentMode} onValueChange={(value) => handleAttachmentModeChange(value as AttachmentMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose attachment source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom upload or link</SelectItem>
                  <SelectItem value="document">Knowledge document</SelectItem>
                  <SelectItem value="topic">Knowledge topic</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Manage documents and topics from the <a href="/knowledge/store" className="text-indigo-600 underline">Knowledge Store</a>.
              </p>
            </div>

            {attachmentMode === 'custom' && (
              <>
                <div className="space-y-2">
                  <Label>Asset Name</Label>
                  <Input
                    value={formState.name}
                    onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Product Manual"
                  />
                </div>
                <div className="flex gap-4 flex-wrap">
                  <div className="space-y-2 flex-1 min-w-[200px]">
                    <Label>Asset Type</Label>
                    <Select
                      value={formState.assetType}
                      onValueChange={(value) =>
                        setFormState((prev) => ({
                          ...prev,
                          assetType: value as AssetType,
                          sourceType: value === 'Text' ? 'upload' : prev.sourceType,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['PDF', 'Text', 'Embeddings', 'Datasources', 'URLs'].map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 flex-1 min-w-[200px]">
                    <Label>Source</Label>
                    <Select
                      value={formState.sourceType}
                      onValueChange={(value) =>
                        setFormState((prev) => ({
                          ...prev,
                          sourceType: value as SourceType,
                        }))
                      }
                      disabled={formState.assetType === 'Text'}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upload">Upload</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {formState.assetType === 'Text' ? (
                  <div className="space-y-2">
                    <Label>Text Content</Label>
                    <Textarea
                      rows={5}
                      value={formState.textContent}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, textContent: e.target.value }))
                      }
                      placeholder="Paste relevant content here…"
                    />
                    <p className="text-xs text-muted-foreground">
                      {formState.textContent.length} characters
                    </p>
                  </div>
                ) : formState.sourceType === 'upload' ? (
                  <div className="space-y-2">
                    <Label>Upload File</Label>
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileSelect(file);
                        }
                      }}
                      className="text-sm"
                      accept=".pdf,.txt,.csv,.json,.md"
                    />
                    {formState.fileName && (
                      <Badge variant="secondary">
                        {formState.fileName} • {(formState.fileSize! / (1024 * 1024)).toFixed(2)} MB
                      </Badge>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>External URL</Label>
                    <Input
                      value={formState.url}
                      onChange={(e) => setFormState((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="https://example.com/resource.pdf"
                    />
                  </div>
                )}
              </>
            )}

            {attachmentMode === 'document' && (
              <div className="space-y-2">
                <Label>Knowledge Document</Label>
                {knowledgeDocumentsList.length > 0 ? (
                  <Select
                    value={selectedDocumentId ?? undefined}
                    onValueChange={(value) => setSelectedDocumentId(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a document" />
                    </SelectTrigger>
                    <SelectContent>
                      {knowledgeDocumentsList.map((doc) => (
                        <SelectItem key={doc.id} value={String(doc.id)}>
                          {doc.title}
                          {doc.topics?.length ? ` • ${doc.topics.map((t) => t.name).join(', ')}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No knowledge documents yet. Visit the{' '}
                    <a href="/knowledge/store" className="text-indigo-600 underline">
                      Knowledge Store
                    </a>{' '}
                    to add one.
                  </p>
                )}
              </div>
            )}

            {attachmentMode === 'topic' && (
              <div className="space-y-2">
                <Label>Knowledge Topic</Label>
                {knowledgeTopicsList.length > 0 ? (
                  <Select
                    value={selectedTopicId ?? undefined}
                    onValueChange={(value) => setSelectedTopicId(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {knowledgeTopicsList.map((topic) => (
                        <SelectItem key={topic.id} value={String(topic.id)}>
                          {topic.name}
                          {typeof topic.documentCount === 'number' ? ` • ${topic.documentCount} docs` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No topics yet. Visit the{' '}
                    <a href="/knowledge/store" className="text-indigo-600 underline">
                      Knowledge Store
                    </a>{' '}
                    to create one.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Attaches all documents grouped under the selected topic.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setFormState(defaultForm);
                  setAttachmentMode('custom');
                  setSelectedTopicId(null);
                  setSelectedDocumentId(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmittingForm}>
                {isSubmittingForm ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Asset
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}


