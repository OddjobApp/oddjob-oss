import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Plus, Trash2, Pencil, RefreshCw } from "lucide-react";

export default function SchemaManager() {
    const { toast } = useToast();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [currentSchema, setCurrentSchema] = useState<any>(null);

    // Form State
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        entityTypes: "{}",
        relationshipTypes: "{}",
    });

    const { data: schemas = [], isLoading, refetch } = useQuery<any[]>({
        queryKey: ["/api/knowledge/schemas"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/knowledge/schema");
            return res.json();
        },
    });

    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            const payload = {
                name: data.name,
                description: data.description,
                entityTypes: JSON.parse(data.entityTypes),
                relationshipTypes: JSON.parse(data.relationshipTypes),
            };
            const res = await apiRequest("PUT", "/api/knowledge/schema", payload);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge/schemas"] });
            setIsCreateOpen(false);
            resetForm();
            toast({ title: "Schema Created", description: "New schema added successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Creation Failed", description: error.message, variant: "destructive" });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (data: any) => {
            const payload = {
                id: currentSchema.id,
                name: data.name,
                description: data.description,
                entityTypes: JSON.parse(data.entityTypes),
                relationshipTypes: JSON.parse(data.relationshipTypes),
            };
            const res = await apiRequest("PUT", "/api/knowledge/schema", payload);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge/schemas"] });
            setIsEditOpen(false);
            resetForm();
            toast({ title: "Schema Updated", description: "Changes saved successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/knowledge/schema/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge/schemas"] });
            toast({ title: "Schema Deleted", description: "Schema removed successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
        },
    });

    function resetForm() {
        setFormData({
            name: "",
            description: "",
            entityTypes: "{\n  \"Person\": {\n    \"name\": \"string\"\n  }\n}",
            relationshipTypes: "{\n  \"KNOWS\": {\n    \"source\": \"Person\",\n    \"target\": \"Person\"\n  }\n}",
        });
        setCurrentSchema(null);
    }

    function handleEdit(schema: any) {
        setCurrentSchema(schema);
        setFormData({
            name: schema.name,
            description: schema.description || "",
            entityTypes: JSON.stringify(schema.entityTypes, null, 2),
            relationshipTypes: JSON.stringify(schema.relationshipTypes, null, 2),
        });
        setIsEditOpen(true);
    }

    function handleSave() {
        try {
            JSON.parse(formData.entityTypes);
            JSON.parse(formData.relationshipTypes);
        } catch (e) {
            toast({ title: "Invalid JSON", description: "Please check your JSON syntax.", variant: "destructive" });
            return;
        }

        if (isEditOpen) {
            updateMutation.mutate(formData);
        } else {
            createMutation.mutate(formData);
        }
    }

    return (
        <div className="space-y-6 p-4 pb-24 sm:space-y-8 sm:p-8 sm:pb-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">Schema Manager</h1>
                    <p className="text-sm text-muted-foreground">
                        Define domain models for Knowledge Graph extraction.
                    </p>
                </div>
                <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Schema
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Schemas</CardTitle>
                    <CardDescription>
                        {schemas.length} schema(s) defined.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3 md:hidden">
                        {isLoading ? (
                            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Loading...</div>
                        ) : schemas.length === 0 ? (
                            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No schemas found.</div>
                        ) : (
                            schemas.map((schema) => (
                                <div key={schema.id} className="rounded-lg border p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-medium">{schema.name}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">ID {schema.id}</p>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(schema)}>
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(schema.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    {schema.description && (
                                        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{schema.description}</p>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    <div className="hidden md:block">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-4">Loading...</TableCell>
                                </TableRow>
                            ) : schemas.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No schemas found.</TableCell>
                                </TableRow>
                            ) : (
                                schemas.map((schema) => (
                                    <TableRow key={schema.id}>
                                        <TableCell>{schema.id}</TableCell>
                                        <TableCell className="font-medium">{schema.name}</TableCell>
                                        <TableCell>{schema.description}</TableCell>
                                        <TableCell className="text-right space-x-2">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(schema)}>
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(schema.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(open) => {
                if (!open) {
                    setIsCreateOpen(false);
                    setIsEditOpen(false);
                }
            }}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{isEditOpen ? "Edit Schema" : "Create Schema"}</DialogTitle>
                        <DialogDescription>
                            Define the entities and relationships for this domain.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., IT Operations"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Input
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Optional description"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Entity Types (JSON)</Label>
                            <Textarea
                                className="font-mono text-xs h-32"
                                value={formData.entityTypes}
                                onChange={(e) => setFormData({ ...formData, entityTypes: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Relationship Types (JSON)</Label>
                            <Textarea
                                className="font-mono text-xs h-32"
                                value={formData.relationshipTypes}
                                onChange={(e) => setFormData({ ...formData, relationshipTypes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); }}>Cancel</Button>
                        <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                            {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Schema"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

