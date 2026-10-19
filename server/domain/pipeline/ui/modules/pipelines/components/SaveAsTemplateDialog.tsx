import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Loader2 } from "lucide-react";

interface SaveAsTemplateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: { name: string; description: string; category: string }) => Promise<void>;
    defaultName?: string;
}

export function SaveAsTemplateDialog({ open, onOpenChange, onSave, defaultName }: SaveAsTemplateDialogProps) {
    const [name, setName] = useState(defaultName || "");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("general");
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!name) return;
        setIsSaving(true);
        try {
            await onSave({ name, description, category });
            onOpenChange(false);
        } catch (error) {
            // Error handling should be done by parent or toast
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Save as Template</DialogTitle>
                    <DialogDescription>
                        Create a reusable blueprint from this pipeline.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Template Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Daily Data Sync"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>
                        <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="general">General</SelectItem>
                                <SelectItem value="maintenance">Maintenance</SelectItem>
                                <SelectItem value="data">Data Processing</SelectItem>
                                <SelectItem value="qa">QA / Testing</SelectItem>
                                <SelectItem value="marketing">Marketing</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="description">Description (Optional)</Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe what this template does..."
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!name || isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Template
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
