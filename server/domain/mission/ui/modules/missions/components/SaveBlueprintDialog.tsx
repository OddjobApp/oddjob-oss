
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";

interface SaveBlueprintDialogProps {
    mission: any;
}

export function SaveBlueprintDialog({ mission }: SaveBlueprintDialogProps) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const { toast } = useToast();

    const mutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/missions/${mission.id}/template`, {
                name,
                description,
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/missions/templates"] });
            toast({
                title: "Blueprint Saved",
                description: "This mission configuration has been saved as a blueprint.",
            });
            setOpen(false);
            setName("");
            setDescription("");
        },
        onError: (error: any) => {
            toast({
                title: "Failed to save blueprint",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 border-primary/30 hover:bg-primary/10 hover:text-primary">
                    <Save className="w-4 h-4" />
                    Save as Blueprint
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Save Mission Blueprint</DialogTitle>
                    <DialogDescription>
                        Create a reusable blueprint from this mission's configuration (Objective, Roles, Members).
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Blueprint Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Standard Triage Unit"
                            className="bg-card border-border focus:ring-primary"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe the purpose of this blueprint..."
                            className="bg-card border-border focus:ring-primary"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button
                        onClick={() => mutation.mutate()}
                        disabled={mutation.isPending || !name}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        {mutation.isPending ? "Saving..." : "Save Blueprint"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
