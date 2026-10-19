import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
    FileText,
    Database,
    Plus,
    X,
    BookOpen,
    Lightbulb,
    Layers,
    Info,
    FileCode,
    Wrench,
    BookMarked,
    Upload,
    Trash2,
    Paperclip,
    File,
    Loader2,
    ShieldCheck,
    Clock3,
} from "lucide-react";

interface MissionResourcesProps {
    missionId: number;
}

interface RagAssetAttachment {
    id: number;
    missionId: number;
    ragAssetId: number;
    purpose: string;
    addedBy: string | null;
    createdAt: string;
    assetName: string | null;
    assetType: string | null;
    sourceType: string | null;
}

interface DocTemplateAttachment {
    id: number;
    missionId: number;
    documentTemplateId: number;
    role: string;
    addedBy: string | null;
    createdAt: string;
    templateName: string | null;
    templateType: string | null;
    templateCategory: string | null;
}

interface RagAsset {
    id: number;
    name: string;
    assetType: string;
    sourceType: string;
}

interface DocTemplate {
    id: number;
    name: string;
    type: string;
    category: string | null;
}

const purposeIcons: Record<string, typeof Lightbulb> = {
    example: Lightbulb,
    template: Layers,
    reference: BookOpen,
    context: Info,
};

const purposeColors: Record<string, string> = {
    example: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    template: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    reference: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    context: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

const roleIcons: Record<string, typeof FileCode> = {
    output_standard: FileCode,
    tool: Wrench,
    reference: BookMarked,
};

const roleColors: Record<string, string> = {
    output_standard: "bg-primary/10 text-primary border-primary/20",
    tool: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    reference: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

type ConfidenceBrief = {
    level: "high" | "medium" | "review";
    label: string;
    className: string;
    reasons: string[];
};

function getAgeDays(createdAt?: string | null) {
    if (!createdAt) return null;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
}

function buildConfidenceBrief(input: {
    sourceType?: string | null;
    assetType?: string | null;
    purpose?: string | null;
    createdAt?: string | null;
}): ConfidenceBrief {
    const ageDays = getAgeDays(input.createdAt);
    const source = String(input.sourceType || "").toLowerCase();
    const assetType = String(input.assetType || "").toLowerCase();
    const purpose = String(input.purpose || "").toLowerCase();
    const reasons: string[] = [];
    let score = 50;

    if (["upload", "document", "text"].includes(source)) {
        score += 20;
        reasons.push("curated source");
    } else if (source === "link" || source === "url") {
        score += 5;
        reasons.push("linked source");
    } else if (!source) {
        reasons.push("source type unknown");
    }

    if (["pdf", "docx", "markdown", "text"].some((type) => assetType.includes(type))) {
        score += 10;
        reasons.push("document-like asset");
    }

    if (["reference", "context", "output_standard"].includes(purpose)) {
        score += 10;
        reasons.push(`${purpose.replace("_", " ")} purpose`);
    }

    if (ageDays === null) {
        score -= 5;
        reasons.push("age unknown");
    } else if (ageDays <= 30) {
        score += 10;
        reasons.push("recent");
    } else if (ageDays > 180) {
        score -= 15;
        reasons.push("older than 180 days");
    } else {
        reasons.push(`${ageDays} days old`);
    }

    if (score >= 80) {
        return { level: "high", label: "high confidence", className: "border-green-500/30 text-green-600 bg-green-500/10", reasons };
    }
    if (score >= 60) {
        return { level: "medium", label: "medium confidence", className: "border-amber-500/30 text-amber-600 bg-amber-500/10", reasons };
    }
    return { level: "review", label: "review source", className: "border-red-500/30 text-red-600 bg-red-500/10", reasons };
}

function KnowledgeConfidenceBrief({ brief }: { brief: ConfidenceBrief }) {
    return (
        <div className="mt-2 rounded-md border border-border/70 bg-background/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`h-5 text-[9px] uppercase ${brief.className}`}>
                    <ShieldCheck className="mr-1 h-2.5 w-2.5" />
                    {brief.label}
                </Badge>
                {brief.reasons.slice(0, 3).map((reason) => (
                    <span key={reason} className="text-[10px] text-muted-foreground">
                        {reason}
                    </span>
                ))}
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Before acting, Copilot should cite this source, check recency, and call out conflicts or gaps.
            </p>
        </div>
    );
}

export function MissionResources({ missionId }: MissionResourcesProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedAssetId, setSelectedAssetId] = useState<string>("");
    const [selectedPurpose, setSelectedPurpose] = useState<string>("reference");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
    const [selectedRole, setSelectedRole] = useState<string>("output_standard");
    const [isDragging, setIsDragging] = useState(false);
    const [uploadPurpose, setUploadPurpose] = useState<string>("reference");

    // Fetch attached assets
    const { data: attachedAssets = [] } = useQuery<RagAssetAttachment[]>({
        queryKey: [`/api/missions/${missionId}/assets`],
    });

    // Fetch attached templates
    const { data: attachedTemplates = [] } = useQuery<DocTemplateAttachment[]>({
        queryKey: [`/api/missions/${missionId}/document-templates`],
    });

    // Fetch direct file attachments
    const { data: fileAttachments = [] } = useQuery<any[]>({
        queryKey: [`/api/missions/${missionId}/file-attachments`],
    });

    // Fetch available RAG assets for picker
    const { data: availableAssets = [] } = useQuery<RagAsset[]>({
        queryKey: ["/api/missions/available/rag-assets"],
    });

    // Fetch available document templates for picker
    const { data: availableTemplates = [] } = useQuery<DocTemplate[]>({
        queryKey: ["/api/document-templates"],
    });

    // Attach RAG asset mutation
    const attachAsset = useMutation({
        mutationFn: async ({ ragAssetId, purpose }: { ragAssetId: number; purpose: string }) => {
            const res = await apiRequest("POST", `/api/missions/${missionId}/assets`, { ragAssetId, purpose });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to attach asset");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/assets`] });
            setSelectedAssetId("");
            toast({ title: "Asset Attached", description: "RAG asset linked to mission." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        },
    });

    // Detach RAG asset mutation
    const detachAsset = useMutation({
        mutationFn: async (attachmentId: number) => {
            const res = await apiRequest("DELETE", `/api/missions/${missionId}/assets/${attachmentId}`);
            if (!res.ok) throw new Error("Failed to detach asset");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/assets`] });
            toast({ title: "Asset Detached" });
        },
    });

    // Attach document template mutation
    const attachTemplate = useMutation({
        mutationFn: async ({ documentTemplateId, role }: { documentTemplateId: number; role: string }) => {
            const res = await apiRequest("POST", `/api/missions/${missionId}/document-templates`, { documentTemplateId, role });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to attach template");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/document-templates`] });
            setSelectedTemplateId("");
            toast({ title: "Template Attached", description: "Document template linked to mission." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        },
    });

    // Detach document template mutation
    const detachTemplate = useMutation({
        mutationFn: async (attachmentId: number) => {
            const res = await apiRequest("DELETE", `/api/missions/${missionId}/document-templates/${attachmentId}`);
            if (!res.ok) throw new Error("Failed to detach template");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/document-templates`] });
            toast({ title: "Template Detached" });
        },
    });

    // Upload file mutation
    const uploadFile = useMutation({
        mutationFn: async (file: File) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async () => {
                    try {
                        const base64Content = (reader.result as string).split(',')[1];
                        const res = await apiRequest("POST", `/api/missions/${missionId}/file-attachments`, {
                            fileName: file.name,
                            contentType: file.type,
                            fileSize: file.size,
                            fileData: base64Content,
                            purpose: uploadPurpose,
                        });
                        if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error || "Upload failed");
                        }
                        resolve(await res.json());
                    } catch (e) {
                        reject(e);
                    }
                };
                reader.onerror = () => reject(new Error("File reading failed"));
                reader.readAsDataURL(file);
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/file-attachments`] });
            toast({ title: "File Uploaded", description: "Attachment added to mission." });
        },
        onError: (err: any) => {
            toast({ title: "Upload Error", description: err.message, variant: "destructive" });
        },
    });

    // Delete file mutation
    const deleteFile = useMutation({
        mutationFn: async (attachmentId: number) => {
            const res = await apiRequest("DELETE", `/api/missions/${missionId}/file-attachments/${attachmentId}`);
            if (!res.ok) throw new Error("Failed to delete attachment");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/file-attachments`] });
            toast({ title: "Attachment Removed" });
        },
    });

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            files.forEach(file => uploadFile.mutate(file));
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            files.forEach(file => uploadFile.mutate(file));
        }
    };

    // Filter out already-attached assets from the picker
    const attachedAssetIds = new Set(attachedAssets.map(a => a.ragAssetId));
    const unattachedAssets = availableAssets.filter(a => !attachedAssetIds.has(a.id));

    const attachedTemplateIds = new Set(attachedTemplates.map(t => t.documentTemplateId));
    const unattachedTemplates = availableTemplates.filter(t => !attachedTemplateIds.has(t.id));

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-primary">Knowledge Confidence</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Confidence labels are transparent heuristics from source type, purpose, asset type, and age. Copilot should still cite sources and call out stale or conflicting evidence before acting.
                        </p>
                    </div>
                </div>
            </div>

            {/* RAG Assets Section */}
            <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg font-bold tracking-tight">Knowledge Assets</CardTitle>
                        <Badge variant="outline" className="ml-auto text-xs border-border/50">
                            {attachedAssets.length} attached
                        </Badge>
                    </div>
                    <CardDescription>
                        RAG assets injected into every agent's context during mission execution.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Attach picker */}
                    <div className="flex items-center gap-2">
                        <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                            <SelectTrigger className="flex-1 bg-muted/20 border-border/50 h-9 text-sm">
                                <SelectValue placeholder="Select a knowledge asset..." />
                            </SelectTrigger>
                            <SelectContent>
                                {unattachedAssets.length === 0 ? (
                                    <SelectItem value="__none" disabled>No assets available</SelectItem>
                                ) : (
                                    unattachedAssets.map(a => (
                                         <SelectItem key={a.id} value={String(a.id)}>
                                            <span className="flex items-center gap-2">
                                                <Database className="w-3 h-3 text-muted-foreground" />
                                                {a.name}
                                                <span className="text-muted-foreground text-xs">({a.assetType})</span>
                                            </span>
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                        <Select value={selectedPurpose} onValueChange={setSelectedPurpose}>
                            <SelectTrigger className="w-[140px] bg-muted/20 border-border/50 h-9 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="example">Example</SelectItem>
                                <SelectItem value="template">Template</SelectItem>
                                <SelectItem value="reference">Reference</SelectItem>
                                <SelectItem value="context">Context</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            size="sm"
                            className="h-9"
                            disabled={!selectedAssetId || selectedAssetId === "__none" || attachAsset.isPending}
                            onClick={() => attachAsset.mutate({ ragAssetId: parseInt(selectedAssetId), purpose: selectedPurpose })}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Attached list */}
                    {attachedAssets.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-sm">
                            No knowledge assets attached. Attach assets to provide context, examples, or references to mission agents.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {attachedAssets.map(asset => {
                                const PurposeIcon = purposeIcons[asset.purpose] || Info;
                                const colorClass = purposeColors[asset.purpose] || "bg-muted text-muted-foreground border-border";
                                const confidence = buildConfidenceBrief({
                                    sourceType: asset.sourceType,
                                    assetType: asset.assetType,
                                    purpose: asset.purpose,
                                    createdAt: asset.createdAt,
                                });
                                const ageDays = getAgeDays(asset.createdAt);
                                return (
                                    <div
                                        key={asset.id}
                                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/10 border border-border hover:border-primary/20 transition-all group"
                                    >
                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${colorClass}`}>
                                            <PurposeIcon className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{asset.assetName || `Asset #${asset.ragAssetId}`}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass}`}>
                                                    {asset.purpose}
                                                </Badge>
                                                {asset.assetType && (
                                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{asset.assetType}</span>
                                                )}
                                                {ageDays !== null && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                        <Clock3 className="h-2.5 w-2.5" />
                                                        {ageDays === 0 ? "today" : `${ageDays}d old`}
                                                    </span>
                                                )}
                                            </div>
                                            <KnowledgeConfidenceBrief brief={confidence} />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => detachAsset.mutate(asset.id)}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Document Templates Section */}
            <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg font-bold tracking-tight">Document Templates</CardTitle>
                        <Badge variant="outline" className="ml-auto text-xs border-border/50">
                            {attachedTemplates.length} attached
                        </Badge>
                    </div>
                    <CardDescription>
                        Output standards and tools applied to all agents in this mission.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Attach picker */}
                    <div className="flex items-center gap-2">
                        <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                            <SelectTrigger className="flex-1 bg-muted/20 border-border/50 h-9 text-sm">
                                <SelectValue placeholder="Select a document template..." />
                            </SelectTrigger>
                            <SelectContent>
                                {unattachedTemplates.length === 0 ? (
                                    <SelectItem value="__none" disabled>No templates available</SelectItem>
                                ) : (
                                    unattachedTemplates.map(t => (
                                        <SelectItem key={t.id} value={String(t.id)}>
                                            <span className="flex items-center gap-2">
                                                <FileText className="w-3 h-3 text-muted-foreground" />
                                                {t.name}
                                                {t.category && <span className="text-muted-foreground text-xs">({t.category})</span>}
                                            </span>
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                        <Select value={selectedRole} onValueChange={setSelectedRole}>
                            <SelectTrigger className="w-[160px] bg-muted/20 border-border/50 h-9 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="output_standard">Output Standard</SelectItem>
                                <SelectItem value="tool">Mission Tool</SelectItem>
                                <SelectItem value="reference">Reference</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            size="sm"
                            className="h-9"
                            disabled={!selectedTemplateId || selectedTemplateId === "__none" || attachTemplate.isPending}
                            onClick={() => attachTemplate.mutate({ documentTemplateId: parseInt(selectedTemplateId), role: selectedRole })}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Attached list */}
                    {attachedTemplates.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-sm">
                            No document templates attached. Templates define output formats and tools for mission agents.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {attachedTemplates.map(template => {
                                const RoleIcon = roleIcons[template.role] || FileCode;
                                const colorClass = roleColors[template.role] || "bg-muted text-muted-foreground border-border";
                                const confidence = buildConfidenceBrief({
                                    sourceType: "document",
                                    assetType: template.templateType,
                                    purpose: template.role,
                                    createdAt: template.createdAt,
                                });
                                const ageDays = getAgeDays(template.createdAt);
                                return (
                                    <div
                                        key={template.id}
                                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/10 border border-border hover:border-primary/20 transition-all group"
                                    >
                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${colorClass}`}>
                                            <RoleIcon className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{template.templateName || `Template #${template.documentTemplateId}`}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass}`}>
                                                    {template.role === "output_standard" ? "output standard" : template.role}
                                                </Badge>
                                                {template.templateType && (
                                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{template.templateType}</span>
                                                )}
                                                {ageDays !== null && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                        <Clock3 className="h-2.5 w-2.5" />
                                                        {ageDays === 0 ? "today" : `${ageDays}d old`}
                                                    </span>
                                                )}
                                            </div>
                                            <KnowledgeConfidenceBrief brief={confidence} />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => detachTemplate.mutate(template.id)}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* File Attachments Section */}
            <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <Paperclip className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg font-bold tracking-tight">Direct Attachments</CardTitle>
                        <Badge variant="outline" className="ml-auto text-xs border-border/50">
                            {fileAttachments.length} uploaded
                        </Badge>
                    </div>
                    <CardDescription>
                        Drag and drop files from your desktop to provide unique mission context.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Upload Zone */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Select value={uploadPurpose} onValueChange={setUploadPurpose}>
                                <SelectTrigger className="w-full bg-muted/20 border-border/50 h-9 text-sm">
                                    <SelectValue placeholder="Attachment Purpose..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="example">Example</SelectItem>
                                    <SelectItem value="template">Template</SelectItem>
                                    <SelectItem value="reference">Reference</SelectItem>
                                    <SelectItem value="context">Context</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            className={`
                                relative border-2 border-dashed rounded-xl p-8 transition-all duration-300
                                flex flex-col items-center justify-center gap-3 text-center
                                ${isDragging ? "border-primary bg-primary/5 scale-[0.98]" : "border-border bg-muted/5 hover:border-primary/20"}
                            `}
                        >
                            <input
                                type="file"
                                id="mission-file-upload"
                                className="hidden"
                                multiple
                                onChange={handleFileChange}
                            />
                            <div className={`
                                w-12 h-12 rounded-full flex items-center justify-center mb-1
                                ${uploadFile.isPending ? "bg-primary/10" : "bg-muted"}
                            `}>
                                {uploadFile.isPending ? (
                                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                                ) : (
                                    <Upload className={`w-6 h-6 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                                )}
                            </div>
                            <div>
                                <label
                                    htmlFor="mission-file-upload"
                                    className="text-sm font-bold text-foreground hover:text-primary cursor-pointer transition-colors"
                                >
                                    Click to browse
                                </label>
                                <span className="text-sm text-muted-foreground ml-1">or drag files here</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                                Max 10MB per file
                            </p>
                        </div>
                    </div>

                    {/* File List */}
                    {fileAttachments.length > 0 && (
                        <div className="space-y-2 pt-2">
                            {fileAttachments.map(file => {
                                const PurposeIcon = purposeIcons[file.purpose] || Info;
                                const colorClass = purposeColors[file.purpose] || "bg-muted text-muted-foreground border-border";
                                const confidence = buildConfidenceBrief({
                                    sourceType: "upload",
                                    assetType: file.contentType || file.fileName,
                                    purpose: file.purpose,
                                    createdAt: file.createdAt,
                                });
                                const ageDays = getAgeDays(file.createdAt);
                                return (
                                    <div
                                        key={file.id}
                                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/10 border border-border hover:border-primary/20 transition-all group"
                                    >
                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${colorClass}`}>
                                            <File className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{file.fileName}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass}`}>
                                                    <PurposeIcon className="w-2.5 h-2.5 mr-1" />
                                                    {file.purpose}
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {(file.fileSize / 1024).toFixed(1)} KB
                                                </span>
                                                {ageDays !== null && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                        <Clock3 className="h-2.5 w-2.5" />
                                                        {ageDays === 0 ? "today" : `${ageDays}d old`}
                                                    </span>
                                                )}
                                            </div>
                                            <KnowledgeConfidenceBrief brief={confidence} />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => deleteFile.mutate(file.id)}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

