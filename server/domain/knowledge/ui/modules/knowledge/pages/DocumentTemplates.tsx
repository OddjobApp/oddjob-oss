import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { FileText, Plus, Trash2, Edit2, Search, Bot } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import type { DocumentTemplate } from "@shared/schema/document-templates";

export default function DocumentTemplatesPage() {
    const { toast } = useToast();
    const [, setLocation] = useLocation();
    const { selectedOrgId } = useOrgContext();
    const [isCreating, setIsCreating] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        source: 'direct',
        type: 'markdown',
        content: '',
        knowledgeDocumentId: null as number | null,
        category: 'general'
    });

    const { data: knowledgeDocs } = useQuery<any[]>({
        queryKey: ['/api/knowledge-documents'],
    });

    const { data: templates, isLoading } = useQuery<DocumentTemplate[]>({
        queryKey: ['/api/document-templates'],
    });

    const filteredTemplates = templates?.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const createMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            const res = await apiRequest('POST', '/api/document-templates', data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/document-templates'] });
            setIsCreating(false);
            setFormData({ name: '', description: '', source: 'direct', type: 'markdown', content: '', knowledgeDocumentId: null, category: 'general' });
            toast({ title: 'Template created successfully' });
        },
        onError: (error: Error) => {
            toast({ title: 'Failed to create template', description: error.message, variant: 'destructive' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number, data: Partial<typeof formData> }) => {
            const res = await apiRequest('PATCH', `/api/document-templates/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/document-templates'] });
            setEditingTemplate(null);
            toast({ title: 'Template updated successfully' });
        },
        onError: (error: Error) => {
            toast({ title: 'Failed to update template', description: error.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest('DELETE', `/api/document-templates/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/document-templates'] });
            toast({ title: 'Template deleted' });
        },
    });

    const handleEdit = (template: DocumentTemplate) => {
        setEditingTemplate(template);
        setFormData({
            name: template.name,
            description: template.description || '',
            source: (template as any).source || 'direct',
            type: (template as any).type || 'markdown',
            content: template.content || '',
            knowledgeDocumentId: (template as any).knowledgeDocumentId || null,
            category: template.category || 'general'
        });
    };

    const handleSubmit = () => {
        if (editingTemplate) {
            updateMutation.mutate({ id: editingTemplate.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const handleCreateFormAgent = async (template: DocumentTemplate) => {
        console.log('Creating form agent for template:', template);

        toast({
            title: "Converting to Form Agent",
            description: "Extracting schema fields using AI...",
        });

        try {
            // First, extract fields from the template
            console.log('Extracting fields from template...');
            const orgQuery = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const extractionRes = await apiRequest('POST', `/api/form-agents/extract-fields${orgQuery}`, {
                templateId: template.id,
                templateContent: template.content || ''
            });

            const extractionData = await extractionRes.json();
            console.log('Field extraction response data:', extractionData);

            const extractedFields = extractionData.data?.fields || [];
            console.log('Extracted fields:', extractedFields);

            console.log('Creating form agent job...');
            const orgQuery2 = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const createRes = await apiRequest('POST', `/api/form-agents${orgQuery2}`, {
                documentTemplateId: template.id,
                name: `${template.name} Form Agent`,
                description: `Form agent based on ${template.name} template`,
                config: {
                    documentTemplateId: template.id,
                    formSchema: {
                        fields: extractedFields.map((field: any) => ({
                            key: field.name,
                            type: field.type,
                            label: field.label,
                            required: field.required,
                            options: field.options,
                            defaultValue: field.defaultValue
                        }))
                    },
                    outputDataset: '',
                    variableMappings: {},
                    timeoutMinutes: 15,
                    retryOnFailure: false
                }
            });

            const createData = await createRes.json();
            console.log('Create agent response data:', createData);

            toast({
                title: "Form Agent Created",
                description: `Created form agent from template "${template.name}". You can find it in the Activities section.`,
            });

            // Navigate to activities page
            setLocation('/jobs');
        } catch (error: any) {
            console.error('Form Agent Creation Error:', error);
            console.error('Error details:', {
                message: error.message,
                status: error.status,
                statusText: error.statusText,
                url: error.url,
                stack: error.stack
            });

            // More specific error messages
            let errorMessage = "An unexpected error occurred while creating the form agent";

            if (error.message?.includes('fetch')) {
                errorMessage = "Network error: Unable to connect to the server. Please check your connection.";
            } else if (error.status === 401) {
                errorMessage = "Authentication required. Please log in and try again.";
            } else if (error.status === 403) {
                errorMessage = "You don't have permission to create form agents.";
            } else if (error.status === 404) {
                errorMessage = "Document template not found or you don't have access to it.";
            } else if (error.message) {
                errorMessage = error.message;
            }

            toast({
                title: "Failed to Create Form Agent",
                description: errorMessage,
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        Document Templates
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Define standardized output formats and structures for AI Agents.
                    </p>
                </div>
                {!isCreating && !editingTemplate && (
                    <Button onClick={() => setIsCreating(true)}>
                        <Plus className="w-4 h-4 mr-2" /> New Template
                    </Button>
                )}
            </div>

            {(isCreating || editingTemplate) && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardHeader>
                        <CardTitle className="text-lg">
                            {editingTemplate ? 'Edit Template' : 'Create New Document Template'}
                        </CardTitle>
                        <CardDescription>
                            Agents will use this as a reference for formatting their output.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Template Name</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Technical Specification"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Input
                                    id="category"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    placeholder="e.g. engineering, reporting"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Template Source</Label>
                                <div className="flex gap-2">
                                    <Button
                                        variant={formData.source === 'direct' ? 'default' : 'outline'}
                                        onClick={() => setFormData({ ...formData, source: 'direct' })}
                                        className="flex-1"
                                    >
                                        Direct Text
                                    </Button>
                                    <Button
                                        variant={formData.source === 'knowledge' ? 'default' : 'outline'}
                                        onClick={() => setFormData({ ...formData, source: 'knowledge' })}
                                        className="flex-1"
                                    >
                                        Knowledge Doc
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Template Type</Label>
                                <select
                                    className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Template Type"
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                                >
                                    <option value="markdown">Markdown / Text</option>
                                    <option value="word">Word Document</option>
                                    <option value="pdf">PDF Structure</option>
                                    <option value="excel">Excel Structure</option>
                                    <option value="image">Image Vision</option>
                                    <option value="google_doc">Google Doc</option>
                                </select>
                            </div>
                        </div>

                        {formData.source === 'knowledge' && (
                            <div className="space-y-2">
                                <Label>Select Knowledge Document</Label>
                                <select
                                    className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Knowledge Document"
                                    value={formData.knowledgeDocumentId || ''}
                                    onChange={(e) => setFormData({ ...formData, knowledgeDocumentId: parseInt(e.target.value) })}
                                >
                                    <option value="">-- Choose a document --</option>
                                    {knowledgeDocs?.map(doc => (
                                        <option key={doc.id} value={doc.id}>{doc.title} ({doc.contentType})</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {formData.source === 'direct' && (
                            <div className="space-y-2">
                                <Label htmlFor="content">Template Content (Markdown)</Label>
                                <Textarea
                                    id="content"
                                    className="font-mono min-h-[300px]"
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    placeholder="# Document Title\n\n## Overview\n{The agent will fill this in...}"
                                />
                            </div>
                        )}
                    </CardContent>
                    <CardFooter className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => {
                            setIsCreating(false);
                            setEditingTemplate(null);
                            setFormData({ name: '', description: '', source: 'direct', type: 'markdown', content: '', knowledgeDocumentId: null, category: 'general' });
                        }}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={!formData.name || (formData.source === 'direct' && !formData.content) || (formData.source === 'knowledge' && !formData.knowledgeDocumentId) || createMutation.isPending || updateMutation.isPending}
                        >
                            {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingTemplate ? 'Update Template' : 'Create Template'}
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    className="pl-9"
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading templates...</div>
            ) : filteredTemplates?.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {searchQuery ? 'No templates match your search.' : 'No document templates found. Create your first one to standardize agent outputs.'}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredTemplates?.map((template) => (
                        <Card key={template.id} className="group relative overflow-hidden transition-all hover:shadow-md">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-base font-medium truncate pr-8" title={template.name}>
                                            {template.name}
                                        </CardTitle>
                                        <Badge variant="secondary" className="mt-1 text-[10px] h-4 px-1.5 uppercase tracking-wider">
                                            {template.category}
                                        </Badge>
                                    </div>
                                    <div className="flex gap-1 absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-blue-500"
                                            onClick={() => handleCreateFormAgent(template)}
                                            title="Create Form Agent"
                                        >
                                            <Bot className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground"
                                            onClick={() => handleEdit(template)}
                                            title="Edit Template"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-red-500"
                                            onClick={() => {
                                                if (confirm('Are you sure you want to delete this template?')) {
                                                    deleteMutation.mutate(template.id);
                                                }
                                            }}
                                            title="Delete Template"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                                <CardDescription className="line-clamp-2 min-h-[40px] mt-2">
                                    {template.description || "No description provided."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="text-[10px] text-muted-foreground bg-muted/30 p-2 rounded border border-muted/50 font-mono line-clamp-3">
                                    {template.content}
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-4">
                                    <span>ID: {template.id}</span>
                                    <span>{new Date(template.createdAt).toLocaleDateString()}</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

